/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';

@Injectable()
export class GoogleCalendarService {
  private oauthClient;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.oauthClient = new google.auth.OAuth2(
      this.config.get('GOOGLE_CLIENT_ID'),
      this.config.get('GOOGLE_CLIENT_SECRET'),
      this.config.get('GOOGLE_REDIRECT_URL'),
    );
  }

  replaceBigInt(obj: any): any {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'bigint') {
      return obj.toString();
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.replaceBigInt(item));
    }

    if (typeof obj === 'object') {
      const safeObj: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          safeObj[key] = this.replaceBigInt(obj[key]);
        }
      }
      return safeObj;
    }

    return obj;
  }

  getAuthUrl() {
    const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];

    return this.oauthClient.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });
  }

  async saveTokens(userId: string, code: string) {
    const { tokens } = await this.oauthClient.getToken({
      code,
      redirect_uri: process.env.GOOGLE_CALLBACK_URL,
    });

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new InternalServerErrorException('Google did not return tokens');
    }

    const result = await this.prisma.vendorCalendar.upsert({
      where: { userId: userId },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: new Date(tokens.expiry_date as string),
        linked: true,
      },
      create: {
        provider: 'GOOGLE',
        userId: userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: new Date(tokens.expiry_date as string),
        linked: true,
      },
    });

    return this.replaceBigInt(result);
  }

  async getTokens(code: string) {
    const { tokens } = await this.oauthClient.getToken(code);
    return tokens;
  }

  async verifyBooking(dto) {
    const { accessToken, startTime, endTime } = dto;
    this.oauthClient.setCredentials({
      access_token: accessToken,
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauthClient,
    });

    const events = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startTime.toISOString(),
      timeMax: endTime.toISOString(),
      singleEvents: true,
    });

    if ((events?.data.items?.length as number) > 0) {
      throw new Error('Vendor already has an event at this time');
    }
  }

  async createCalendarEvent(
    calendarIntegration: any,
    booking: {
      title: string;
      description?: string;
      startTime: Date;
      endTime: Date;
      attendeeEmail: string;
    },
  ) {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL,
    );

    oauth2Client.setCredentials({
      access_token: calendarIntegration.accessToken,
      refresh_token: calendarIntegration.refreshToken,
      expiry_date: new Date(calendarIntegration.expiryDate as string).getTime(),
    });

    const calendar = google.calendar({
      version: 'v3',
      auth: oauth2Client,
    });

    const event = {
      summary: booking.title,
      description: booking.description,
      start: {
        dateTime: booking.startTime.toISOString(),
        timeZone: 'UTC',
      },
      end: {
        dateTime: booking.endTime.toISOString(),
        timeZone: 'UTC',
      },
      attendees: [{ email: booking.attendeeEmail }],
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    });

    return response.data;
  }

  async getUserCalendarLinked(userId: string) {
    try {
      const linked = await this.prisma.vendorCalendar.findFirst({
        where: {
          userId,
          linked: true,
        },
      });

      return successResponse(
        { linked },
        'Successfully fetched calendar linked status',
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch dashboard stats.',
        error.message as string,
      );
    }
  }
}
