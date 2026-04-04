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

  async verifyBooking(dto: { calendar: any; startTime: Date; endTime: Date }) {
    const { calendar, startTime, endTime } = dto;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL,
    );

    // ✅ FULL credentials
    oauth2Client.setCredentials({
      access_token: calendar.accessToken,
      refresh_token: calendar.refreshToken,
    });

    // ✅ Handle expiry
    if (calendar.expiryDate && new Date() > calendar.expiryDate) {
      const { credentials } = await oauth2Client.refreshAccessToken();

      oauth2Client.setCredentials(credentials);

      await this.prisma.vendorCalendar.update({
        where: { id: calendar.id },
        data: {
          accessToken: credentials.access_token!,
          expiryDate: new Date(credentials.expiry_date!),
        },
      });
    }

    const calendarApi = google.calendar({
      version: 'v3',
      auth: oauth2Client,
    });

    const events = await calendarApi.events.list({
      calendarId: 'primary',
      timeMin: startTime.toISOString(),
      timeMax: endTime.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const items = events.data.items || [];

    // ✅ PROPER overlap detection
    const hasConflict = items.some((event) => {
      const eventStart = new Date(event.start?.dateTime || '');
      const eventEnd = new Date(event.end?.dateTime || '');

      return startTime < eventEnd && endTime > eventStart;
    });

    if (hasConflict) {
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

    // ✅ SET FULL CREDENTIALS
    oauth2Client.setCredentials({
      access_token: calendarIntegration.accessToken,
      refresh_token: calendarIntegration.refreshToken,
    });

    // ✅ Handle expired token
    if (
      calendarIntegration.expiryDate &&
      new Date() > calendarIntegration.expiryDate
    ) {
      const { credentials } = await oauth2Client.refreshAccessToken();

      oauth2Client.setCredentials(credentials);

      // ✅ update DB
      await this.prisma.vendorCalendar.update({
        where: { id: calendarIntegration.id },
        data: {
          accessToken: credentials.access_token!,
          expiryDate: new Date(credentials.expiry_date!),
        },
      });
    }

    const calendarApi = google.calendar({
      version: 'v3',
      auth: oauth2Client,
    });

    return calendarApi.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: booking.title,
        description: booking.description,
        start: {
          dateTime: booking.startTime.toISOString(),
        },
        end: {
          dateTime: booking.endTime.toISOString(),
        },
        attendees: [{ email: booking.attendeeEmail }],
      },
    });
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
