/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { GoogleCalendarService } from './google.service';
import type { Response, Request } from 'express';
import { PrismaService } from 'prisma/prisma.service';
import { AuthService } from 'src/auth/auth.service';

@Controller('google')
export class GoogleController {
  constructor(
    private googleService: GoogleCalendarService,
    private prisma: PrismaService,
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
      `&redirect_uri=${process.env.GOOGLE_REDIRECT_URI}` +
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

    let frontendRedirectUrl = `${process.env.WEBSITE_URL}/app/home?calendarLinked=true&userId=${encodeURIComponent(
      result.userId as string,
    )}&accessToken=${encodeURIComponent(result.accessToken as string)}&access_token=${encodeURIComponent(appJwt)}`;
    if (parsedState.direction === 'onboarding') {
      frontendRedirectUrl = `${process.env.WEBSITE_URL}/onboard/availability?calendarLinked=true&userId=${encodeURIComponent(
        result.userId as string,
      )}&accessToken=${encodeURIComponent(result.accessToken as string)}&access_token=${encodeURIComponent(appJwt)}`;
    }

    return res.redirect(frontendRedirectUrl);
  }

  @Get('callback/no')
  async googleCallback(
    @Req() req: Request,
    @Query('code') code: string,
    @Res() res: Response,
  ) {
    const tokens = await this.googleService.getTokens(code);

    console.log({ tokens });

    const userId = req.body.id;
    const vendor = await this.prisma.vendor.findUnique({
      where: {
        userId,
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendr not found');
    }

    // Save tokens in database
    // await this.prisma.vendorCalendar.create({
    //   data: {
    //     userId,
    //     provider: 'google',
    //     accessToken: tokens.access_token,
    //     refreshToken: tokens.refresh_token,
    //   },
    // });

    return res.redirect('http://localhost:5173/dashboard');
  }
}
