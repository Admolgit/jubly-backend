/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import * as authDto from './dto/auth.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() dto: authDto.RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: authDto.LoginDto) {
    return this.authService.login(dto);
  }

  @Get('google/login')
  @UseGuards(AuthGuard('google-login'))
  async googleLogin() {}

  @Get('google/callback')
  @UseGuards(AuthGuard('google-login'))
  async googleCallback(@Req() req: Request & { user: any }, @Res() res: any) {
    const googleProfileInfo = req.user;
    const requestedRedirectUrl = googleProfileInfo.requestedRedirectUrl;

    if (!requestedRedirectUrl) {
      throw new BadRequestException('Missing redirect URL in OAuth state');
    }

    const authResult = await this.authService.handleGoogleLoginOrRegister(
      googleProfileInfo,
      requestedRedirectUrl,
    );

    const params = new URLSearchParams();

    if (authResult?.meta?.isSignup) {
      params.append('email', authResult.data.user.email);
    }

    params.append('token', authResult.data.token);
    params.append('refreshToken', authResult.data.refreshToken);

    const data = {
      data: {
        ...authResult,
      },
    };

    const basePath = `${process.env.FRONTEND_BASE_URL}/oauth?${params.toString()}&auth=${JSON.stringify(data)}`;

    const finalRedirect = basePath;

    return res.redirect(finalRedirect);
  }

  @Post('verify-email')
  verifyEmail(@Body() dto: { email: string; otp: string }) {
    return this.authService.verifyEmailOtp(dto);
  }

  @Post('resend-otp')
  resendOtp(@Body() dto: { email: string }) {
    return this.authService.resendOtp(dto);
  }

  @Patch('change-password')
  changePassword(@Body() dto: authDto.PasswordDTO) {
    const { userId, currentPassword, newPassword, confirmPassword } = dto;
    return this.authService.changePassword(
      userId,
      currentPassword,
      newPassword,
      confirmPassword,
    );
  }

  @Post('refresh-token')
  refreshToken(@Body('refereshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }
}
