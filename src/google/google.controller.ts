/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
  // UseGuards,
} from '@nestjs/common';
import { GoogleCalendarService } from './google.service';
// import type { Response, Request } from 'express';
// import { PrismaService } from 'prisma/prisma.service';
import { AuthService } from 'src/auth/auth.service';
// import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
// import { Roles, RolesGuard } from 'src/auth/role.guard';

@Controller('google')
export class GoogleController {
  constructor(
    private googleService: GoogleCalendarService,
    // private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  @Get('calendar')
  connectGoogleCalendar(
    @Query('userId') userId: string,
    @Query('direction') direction: string,
  ) {
    if (!userId) throw new BadRequestException('UserId required');

    const stateObj = { userId, direction };
    const state = encodeURIComponent(
      Buffer.from(JSON.stringify(stateObj)).toString('base64'),
    );

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${process.env.GOOGLE_CLIENT_ID}` +
      `&redirect_uri=${process.env.GOOGLE_CALLBACK_URL}` +
      `&response_type=code` +
      `&scope=https://www.googleapis.com/auth/calendar` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${state}`;

    return { url: authUrl };
  }

  @Get('callback')
  async googleRedirect(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: import('express').Response,
  ) {
    if (!code) throw new BadRequestException('Code not provided');
    if (!state) throw new BadRequestException('State not provided');

    let parsedState: { userId: string; direction?: string };
    try {
      parsedState = JSON.parse(
        Buffer.from(decodeURIComponent(state), 'base64').toString(),
      );
    } catch {
      throw new BadRequestException('Invalid state');
    }

    const result = await this.googleService.saveTokens(
      parsedState.userId,
      code,
    );

    const appJwt: any = this.authService.generateJwt(parsedState.userId);

    let frontendRedirectUrl = `${process.env.FRONTEND_BASE_URL}/dashboard?calendarLinked=true&userId=${encodeURIComponent(
      result.userId as string,
    )}&accessToken=${encodeURIComponent(result.accessToken as string)}&access_token=${encodeURIComponent(appJwt)}`;
    if (parsedState.direction === 'onboarding') {
      frontendRedirectUrl = `${process.env.FRONTEND_BASE_URL}/onboard/availability?calendarLinked=true&userId=${encodeURIComponent(
        result.userId as string,
      )}&accessToken=${encodeURIComponent(result.accessToken as string)}&access_token=${encodeURIComponent(appJwt)}`;
    }

    return res.redirect(frontendRedirectUrl);
  }

  @Get('linked')
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles('VENDOR')
  getCalenderLinkedStatus(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('UserId required');
    return this.googleService.getUserCalendarLinked(userId);
  }
}
