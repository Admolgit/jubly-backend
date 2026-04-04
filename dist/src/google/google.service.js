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
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
let GoogleCalendarService = class GoogleCalendarService {
    constructor(config, prisma) {
        this.config = config;
        this.prisma = prisma;
        this.oauthClient = new googleapis_1.google.auth.OAuth2(this.config.get('GOOGLE_CLIENT_ID'), this.config.get('GOOGLE_CLIENT_SECRET'), this.config.get('GOOGLE_REDIRECT_URL'));
    }
    replaceBigInt(obj) {
        if (obj === null || obj === undefined)
            return obj;
        if (typeof obj === 'bigint') {
            return obj.toString();
        }
        if (Array.isArray(obj)) {
            return obj.map((item) => this.replaceBigInt(item));
        }
        if (typeof obj === 'object') {
            const safeObj = {};
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
    async saveTokens(userId, code) {
        const { tokens } = await this.oauthClient.getToken({
            code,
            redirect_uri: process.env.GOOGLE_CALLBACK_URL,
        });
        if (!tokens.access_token || !tokens.refresh_token) {
            throw new common_1.InternalServerErrorException('Google did not return tokens');
        }
        const result = await this.prisma.vendorCalendar.upsert({
            where: { userId: userId },
            update: {
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiryDate: new Date(tokens.expiry_date),
                linked: true,
            },
            create: {
                provider: 'GOOGLE',
                userId: userId,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiryDate: new Date(tokens.expiry_date),
                linked: true,
            },
        });
        return this.replaceBigInt(result);
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
    async createCalendarEvent(calendarIntegration, booking) {
        const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_CALLBACK_URL);
        oauth2Client.setCredentials({
            access_token: calendarIntegration.accessToken,
            refresh_token: calendarIntegration.refreshToken,
        });
        if (calendarIntegration.expiryDate &&
            new Date() > calendarIntegration.expiryDate) {
            const { credentials } = await oauth2Client.refreshAccessToken();
            oauth2Client.setCredentials(credentials);
            await this.prisma.vendorCalendar.update({
                where: { id: calendarIntegration.id },
                data: {
                    accessToken: credentials.access_token,
                    expiryDate: new Date(credentials.expiry_date),
                },
            });
        }
        const calendarApi = googleapis_1.google.calendar({
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
    async getUserCalendarLinked(userId) {
        try {
            const linked = await this.prisma.vendorCalendar.findFirst({
                where: {
                    userId,
                    linked: true,
                },
            });
            return (0, response_1.successResponse)({ linked }, 'Successfully fetched calendar linked status');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch dashboard stats.', error.message);
        }
    }
};
exports.GoogleCalendarService = GoogleCalendarService;
exports.GoogleCalendarService = GoogleCalendarService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], GoogleCalendarService);
