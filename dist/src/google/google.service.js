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
        const { calendar, startTime, endTime } = dto;
        const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_CALLBACK_URL);
        oauth2Client.setCredentials({
            access_token: calendar.accessToken,
            refresh_token: calendar.refreshToken,
        });
        if (calendar.expiryDate && new Date() > calendar.expiryDate) {
            const { credentials } = await oauth2Client.refreshAccessToken();
            oauth2Client.setCredentials(credentials);
            await this.prisma.vendorCalendar.update({
                where: { id: calendar.id },
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
        const events = await calendarApi.events.list({
            calendarId: 'primary',
            timeMin: startTime.toISOString(),
            timeMax: endTime.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
        });
        const items = events.data.items || [];
        const hasConflict = items.some((event) => {
            const eventStart = new Date(event.start?.dateTime || '');
            const eventEnd = new Date(event.end?.dateTime || '');
            return startTime < eventEnd && endTime > eventStart;
        });
        if (hasConflict) {
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
                attendees: [
                    { email: booking.attendeeEmail, displayName: booking.attendeeName },
                ],
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
    async getCalendar({ view, year, month, date, vendorId, }) {
        try {
            let startTime = new Date();
            let endTime = new Date();
            if (view === 'month') {
                startTime = new Date(year, month - 1, 1);
                endTime = new Date(year, month, 0, 23, 59, 59);
            }
            if (view === 'week') {
                const current = new Date(date);
                const day = current.getDay();
                const diffToSunday = current.getDate() - day;
                startTime = new Date(current.setDate(diffToSunday));
                startTime.setHours(0, 0, 0, 0);
                endTime = new Date(startTime);
                endTime.setDate(startTime.getDate() + 6);
                endTime.setHours(23, 59, 59);
            }
            if (view === 'day') {
                startTime = new Date(date);
                startTime.setHours(0, 0, 0, 0);
                endTime = new Date(date);
                endTime.setHours(23, 59, 59);
            }
            const bookings = await this.prisma.booking.findMany({
                where: {
                    vendorId,
                    status: 'CONFIRMED',
                    date: {
                        gte: startTime,
                        lte: endTime,
                    },
                },
                orderBy: {
                    startTime: 'asc',
                },
            });
            return this.formatCalendarData(view, bookings, startTime);
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch calendar data.', error.message);
        }
    }
    async getClientCalendar({ userId, view, year, month, date, }) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            let startTime = new Date();
            let endTime = new Date();
            if (view === 'month') {
                startTime = new Date(year, month - 1, 1);
                endTime = new Date(year, month, 0, 23, 59, 59);
            }
            if (view === 'week') {
                const current = new Date(date);
                const day = current.getDay();
                const diffToSunday = current.getDate() - day;
                startTime = new Date(current.setDate(diffToSunday));
                startTime.setHours(0, 0, 0, 0);
                endTime = new Date(startTime);
                endTime.setDate(startTime.getDate() + 6);
                endTime.setHours(23, 59, 59);
            }
            if (view === 'day') {
                startTime = new Date(date);
                startTime.setHours(0, 0, 0, 0);
                endTime = new Date(date);
                endTime.setHours(23, 59, 59);
            }
            const bookings = await this.prisma.booking.findMany({
                where: {
                    clientEmail: user.email,
                    status: 'CONFIRMED',
                    date: {
                        gte: startTime,
                        lte: endTime,
                    },
                },
                orderBy: {
                    startTime: 'asc',
                },
            });
            return this.formatCalendarData(view, bookings, startTime);
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch clients calendar data.', error.message);
        }
    }
    formatCalendarData(view, bookings, startDate) {
        try {
            if (view === 'month') {
                const calendar = {};
                bookings.forEach((b) => {
                    const key = b.date.toISOString().split('T')[0];
                    if (!calendar[key])
                        calendar[key] = [];
                    calendar[key].push({
                        id: b.id,
                        title: b.clientName || b.clientEmail,
                        startTime: b.startTime,
                        endTime: b.endTime,
                    });
                });
                return (0, response_1.successResponse)({ view, calendar }, 'Successfully fetched calendar.');
            }
            if (view === 'week') {
                const days = [];
                for (let i = 0; i < 7; i++) {
                    const current = new Date(startDate);
                    current.setDate(startDate.getDate() + i);
                    const key = current.toISOString().split('T')[0];
                    const dayBookings = bookings.filter((b) => b.date.toISOString().split('T')[0] === key);
                    days.push({
                        date: key,
                        bookings: dayBookings,
                    });
                }
                if (view === 'day') {
                    return (0, response_1.successResponse)({
                        view,
                        date: startDate,
                        bookings,
                    }, 'Successfully fetched calendar.');
                }
                return (0, response_1.successResponse)({ view, days }, 'Successfully fetched calendar.');
            }
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to format calendar data.', error.message);
        }
    }
};
exports.GoogleCalendarService = GoogleCalendarService;
exports.GoogleCalendarService = GoogleCalendarService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService])
], GoogleCalendarService);
