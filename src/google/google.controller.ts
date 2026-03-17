/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
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

@Controller('google')
export class GoogleController {
  constructor(
    private googleService: GoogleCalendarService,
    private prisma: PrismaService,
  ) {}

  @Get('calendar')
  connectGoogle(@Res() res: Response) {
    const url = this.googleService.getAuthUrl();
    return res.redirect(url as string);
  }

  @Get('callback')
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
    await this.prisma.vendorCalendar.create({
      data: {
        vendorId: vendor.id,
        provider: 'google',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      },
    });

    return res.redirect('http://localhost:5173/dashboard');
  }
}
