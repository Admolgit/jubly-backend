/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleCalendarService {
  private oauthClient;

  constructor(private config: ConfigService) {
    this.oauthClient = new google.auth.OAuth2(
      this.config.get('GOOGLE_CLIENT_ID'),
      this.config.get('GOOGLE_CLIENT_SECRET'),
      this.config.get('GOOGLE_REDIRECT_URL'),
    );
  }

  getAuthUrl() {
    const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];

    return this.oauthClient.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });
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
    accessToken: string,
    booking: {
      title: string;
      description?: string;
      startTime: Date;
      endTime: Date;
      attendeeEmail: string;
    },
  ) {
    const oauth2Client = new google.auth.OAuth2();

    oauth2Client.setCredentials({
      access_token: accessToken,
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
}
