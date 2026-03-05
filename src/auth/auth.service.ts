/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { comparePassword, hashPassword } from './hash';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { successResponse } from 'src/utils/response';
import { UserRole } from '@prisma/client';
import Helper from 'src/utils/helpers';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private nodemailService: NodemailerService,
  ) {}

  async register(dto: RegisterDto) {
    try {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });

      if (existingUser) {
        throw new BadRequestException('Email already in use');
      }

      const otpGenerated = Helper.generateUniqueCharacters(6);
      console.log({ otpGenerated });

      const hashed = await hashPassword(dto.password);
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          password: hashed,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          role: dto.role,
          verificationCode: otpGenerated,
          codeExpiresAt: Helper.set24HourExpiry(),
        },
      });

      const token = this.jwtService.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      await this.nodemailService.sendOTP(dto.email, otpGenerated);

      return successResponse({ user, token }, 'Registration successful', 201);
    } catch (error) {
      throw new InternalServerErrorException(
        'Registration failed',
        error.message,
      );
    }
  }

  async login(dto: LoginDto) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });

      if (
        !user ||
        !(await comparePassword(dto.password, user.password ?? ''))
      ) {
        throw new UnauthorizedException('Invalid credentials');
      }

      const vendor = await this.prisma.vendor.findUnique({
        where: { userId: user.id },
      });

      if (user.role === UserRole.VENDOR && !vendor) {
        throw new UnauthorizedException('Vendor account not found');
      }

      // if (vendor && vendor.isApproved === false) {
      //   throw new UnauthorizedException('Vendor account pending approval');
      // }

      const token = this.jwtService.sign(
        { sub: user.id, email: user.email, role: user.role },
        { expiresIn: '7d' },
      );

      const refreshToken = this.jwtService.sign(
        { sub: user.id, email: user.email, role: user.role },
        { expiresIn: '14d' },
      );

      const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

      await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshTokenHash, lastLogin: new Date(), isOnline: true },
      });

      // const vendorStatus = await this.vendorServices.getPendingVendorsById(
      //   user.id,
      // );

      return successResponse({ user, token }, 'Login successful');
    } catch (error) {
      throw new InternalServerErrorException('Login failed', error.message);
    }
  }

  async handleGoogleLoginOrRegister(
    profile: any,
    requestedRedirectUrl: string,
  ): Promise<any> {
    try {
      const { email, firstname, lastname, password } = profile;

      let user = await this.prisma.user.findUnique({
        where: { email },
      });

      if (user && user.provider !== 'GOOGLE') {
        return new BadRequestException(
          'User already exists with a different provider',
        );
      }

      let isSignup = false;
      let alreadyExists = true;

      if (!user) {
        isSignup = true;
        alreadyExists = false;
        user = await this.prisma.user.create({
          data: {
            email,
            firstName: firstname,
            lastName: lastname,
            provider: 'GOOGLE',
            isVerified: true,
            role: 'CLIENT',
            password: password || null,
          },
        });
      }

      const token = await this.generateJwt(user);
      const refreshToken = await this.jwtService.signAsync(
        { id: user.id, role: user.role },
        { expiresIn: '14d' },
      );

      const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

      await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshTokenHash, lastLogin: new Date(), isOnline: true },
      });

      return successResponse(
        {
          user,
          token,
          refreshToken,
          alreadyExists,
        },
        isSignup ? 'Sign-up successful' : 'Login successful',
        HttpStatus.OK,
        { isSignup, requestedRedirectUrl, alreadyExists },
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Google Login/Register failed',
        error.message,
      );
    }
  }

  async generateJwt(user: any): Promise<string> {
    return await this.jwtService.signAsync(
      { id: user.id, role: user.role },
      { expiresIn: '7d' },
    );
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.refreshTokenHash) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const isValid = await bcrypt.compare(refreshToken, user.refreshTokenHash);

      if (!isValid) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const accessToken = this.jwtService.sign(
        { id: user.id, role: user.role },
        { expiresIn: '15m' },
      );

      return {
        accessToken,
      };
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException(
        'Refresh token expired or invalid',
        error.message,
      );
    }
  }

  async resetPassword(
    email: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    try {
      if (newPassword !== confirmPassword) {
        throw new BadRequestException('Passwords do not match');
      }

      const hash = await bcrypt.hash(newPassword, 10);
      await this.prisma.user.update({
        where: { email },
        data: { password: hash },
      });
      return successResponse(null, 'Password reset successfully');
    } catch (error) {
      throw new InternalServerErrorException(
        'Password reset failed',
        error.message,
      );
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      const valid = await bcrypt.compare(currentPassword, user.password || '');

      if (!valid) {
        throw new BadRequestException('Current password is incorrect');
      }

      if (newPassword !== confirmPassword) {
        throw new BadRequestException('New passwords do not match');
      }

      const hash = await bcrypt.hash(newPassword, 10);

      await this.prisma.user.update({
        where: { id: userId },
        data: { password: hash },
      });
      return successResponse(null, 'Password changed successfully');
    } catch (error) {
      throw new InternalServerErrorException(
        'Change password failed',
        error.message,
      );
    }
  }

  async verifyEmailOtp(body: { email: string; otp: string }) {
    try {
      const { email, otp } = body;

      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) throw new BadRequestException('User not found');
      if (user.isVerified)
        throw new BadRequestException('User already verified');
      if (user.verificationCode !== otp)
        throw new BadRequestException('Invalid verification code');

      const now = new Date();
      if (!user.codeExpiresAt || user.codeExpiresAt < now) {
        throw new BadRequestException('Verification code expired');
      }

      await this.prisma.user.update({
        where: { email },
        data: {
          isVerified: true,
          verificationCode: null,
          codeExpiresAt: null,
        },
      });

      return successResponse(null, 'Email verified successfully');
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to verify email',
        error.message,
      );
    }
  }

  async resendOtp(body: { email: string }) {
    try {
      const { email } = body;

      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) throw new BadRequestException('User not found');
      if (user.isVerified)
        throw new BadRequestException('User already verified');

      const verificationCode = Helper.generateUniqueCharacters(6);
      const codeExpiresAt = Helper.set24HourExpiry();

      await this.prisma.user.update({
        where: { email },
        data: { verificationCode, codeExpiresAt },
      });

      await this.nodemailService.sendOTP(user.email, verificationCode);

      return successResponse(null, 'Verification code resent successfully');
    } catch (error) {
      throw new InternalServerErrorException(
        'Resend OTP failed',
        error.message,
      );
    }
  }
}
