/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { GoogleCalendarService } from './google.service';
import { AuthService } from 'src/auth/auth.service';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { PrismaService } from 'prisma/prisma.service';

@Controller('google')
export class GoogleController {
  constructor(
    private googleService: GoogleCalendarService,
    private authService: AuthService,
    private prisma: PrismaService,
  ) {}

  @Get('calendar')
  connectGoogleCalendar(
    @Query('userId') userId: string,
    @Query('direction') direction: string,
  ) {
    if (userId === undefined) throw new BadRequestException('UserId required');

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

  @Get('/calendar/callback')
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

    let frontendRedirectUrl: string;
    if (parsedState.direction === 'onboarding-calendar') {
      frontendRedirectUrl = `${process.env.FRONTEND_BASE_URL}/dashboard?calendarLinked=true&userId=${encodeURIComponent(
        result.userId as string,
      )}&accessToken=${encodeURIComponent(result.accessToken as string)}&access_token=${encodeURIComponent(appJwt)}`;
    } else {
      frontendRedirectUrl = `${process.env.FRONTEND_BASE_URL}/dashboard?calendarLinked=true&userId=${encodeURIComponent(
        result.userId as string,
      )}&accessToken=${encodeURIComponent(result.accessToken as string)}&access_token=${encodeURIComponent(appJwt)}`;
    }

    await this.prisma.vendor.update({
      where: {
        userId: parsedState.userId,
      },
      data: {
        onboardingCompleted: true,
      },
    });

    return res.redirect(frontendRedirectUrl);
  }

  @Get('linked')
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles('VENDOR')
  getCalenderLinkedStatus(@Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('UserId required');
    return this.googleService.getUserCalendarLinked(userId);
  }

  @Get('/calendar-list/:vendorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getCalendar(
    @Query('view') view: 'month' | 'week' | 'day',
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('date') date?: string,
    @Param('vendorId') vendorId?: string,
  ) {
    return this.googleService.getCalendar({
      view,
      year: Number(year),
      month: Number(month),
      date,
      vendorId,
    });
  }

  @Get('/client/calendar-list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CLIENT')
  getClientCalendar(
    @Req() req: { user: { id: string } },
    @Query('view') view: 'month' | 'week' | 'day',
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('date') date?: string,
  ) {
    return this.googleService.getClientCalendar({
      userId: req.user.id,
      view,
      year: Number(year),
      month: Number(month),
      date,
    });
  }
}
