/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { comparePassword, hashPassword } from './hash';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { successResponse } from 'src/utils/response';
import { UserRole } from '@prisma/client';
import Helper from 'src/utils/helpers';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const hashed = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashed,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
      },
    });

    const token = this.jwtService.sign({ id: user.id, role: user.role });
    return successResponse({ user, token }, 'Registration successful', 201);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await comparePassword(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const vendor = await this.prisma.vendor.findUnique({
      where: { userId: user.id },
    });

    if (user.role === UserRole.VENDOR && !vendor) {
      throw new UnauthorizedException('Vendor account not found');
    }
    if (vendor && vendor.isApproved === false) {
      throw new UnauthorizedException('Vendor account pending approval');
    }
    const token = this.jwtService.sign(
      { id: user.id, role: user.role },
      { expiresIn: '7d' },
    );

    const refreshToken = this.jwtService.sign(
      { id: user.id, role: user.role },
      { expiresIn: '14d' },
    );

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash, lastLogin: new Date(), isOnline: true },
    });
    return successResponse({ user, token }, 'Login successful');
  }

  async handleGoogleLoginOrRegister(
    profile: any,
    requestedRedirectUrl: string,
  ): Promise<any> {
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
      throw new UnauthorizedException('Refresh token expired or invalid');
    }
  }

  async resetPassword(
    email: string,
    newPassword: string,
    confirmPassword: string,
  ) {
    if (newPassword !== confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { email },
      data: { password: hash },
    });
    return successResponse(null, 'Password reset successfully');
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    confirmPassword: string,
  ) {
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
  }

  async verifyEmailOtp(body: { email: string; otp: string }) {
    const { email, otp } = body;

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    if (user.isVerified) throw new BadRequestException('User already verified');
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
  }

  async resendOtp(body: { email: string }) {
    const { email } = body;

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    if (user.isVerified) throw new BadRequestException('User already verified');

    const verificationCode = Helper.generateUniqueCharacters(6);
    const codeExpiresAt = Helper.set24HourExpiry();

    await this.prisma.user.update({
      where: { email },
      data: { verificationCode, codeExpiresAt },
    });

    // await this.mailService.sendTemplate(
    //   user.email,
    //   `Resend Verification Code Request`,
    //   'verification',
    //   {
    //     name: user.firstName,
    //     code: verificationCode,
    //   },
    // );

    return successResponse(null, 'Verification code resent successfully');
  }
}
