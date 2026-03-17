"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleCalendarService = void 0;
const common_1 = require("@nestjs/common");
const googleapis_1 = require("googleapis");
const config_1 = require("@nestjs/config");
let GoogleCalendarService = class GoogleCalendarService {
    constructor(config) {
        this.config = config;
        this.oauthClient = new googleapis_1.google.auth.OAuth2(this.config.get('GOOGLE_CLIENT_ID'), this.config.get('GOOGLE_CLIENT_SECRET'), this.config.get('GOOGLE_REDIRECT_URL'));
    }
    getAuthUrl() {
        const scopes = ['https://www.googleapis.com/auth/calendar.readonly'];
        return this.oauthClient.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent',
        });
    }
    async getTokens(code) {
        const { tokens } = await this.oauthClient.getToken(code);
        return tokens;
    }
    async verifyBooking(dto) {
        const { accessToken, startTime, endTime } = dto;
        this.oauthClient.setCredentials({
            access_token: accessToken,
        });
        const calendar = googleapis_1.google.calendar({
            version: 'v3',
            auth: this.oauthClient,
        });
        const events = await calendar.events.list({
            calendarId: 'primary',
            timeMin: startTime.toISOString(),
            timeMax: endTime.toISOString(),
            singleEvents: true,
        });
        if (events?.data.items?.length > 0) {
            throw new Error('Vendor already has an event at this time');
        }
    }
    async createCalendarEvent(accessToken, booking) {
        const oauth2Client = new googleapis_1.google.auth.OAuth2();
        oauth2Client.setCredentials({
            access_token: accessToken,
        });
        const calendar = googleapis_1.google.calendar({
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
};
exports.GoogleCalendarService = GoogleCalendarService;
exports.GoogleCalendarService = GoogleCalendarService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GoogleCalendarService);
