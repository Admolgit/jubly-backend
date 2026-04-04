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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const google_service_1 = require("../google/google.service");
const auth_service_1 = require("../auth/auth.service");
const response_1 = require("../utils/response");
const axios_1 = __importDefault(require("axios"));
let BookingService = class BookingService {
    constructor(googleCalendarService, prisma, authService) {
        this.googleCalendarService = googleCalendarService;
        this.prisma = prisma;
        this.authService = authService;
    }
    async createBooking(userId, dto) {
        try {
            const user = await this.prisma.user.findUnique({
                where: {
                    id: userId,
                },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            const service = await this.prisma.service.findFirst({
                where: {
                    id: dto.serviceId,
                },
            });
            if (!service) {
                throw new common_1.NotFoundException('Service not found');
            }
            const vendor = await this.prisma.vendor.findFirst({
                where: {
                    userId,
                },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('Vendor not found');
            }
            const calendarIntegration = await this.prisma.vendorCalendar.findFirst({
                where: {
                    userId,
                    provider: 'google',
                },
            });
            const booking = await this.prisma.booking.create({
                data: {
                    vendorId: vendor.id,
                    serviceId: dto.serviceId,
                    date: new Date(dto.startTime.setHours(0, 0, 0, 0)),
                    clientEmail: dto.clientEmail,
                    startTime: new Date(dto.startTime),
                    endTime: new Date(dto.endTime),
                },
            });
            if (calendarIntegration) {
                try {
                    await this.googleCalendarService.verifyBooking({
                        calendar: calendarIntegration,
                        startTime: new Date(dto.startTime),
                        endTime: new Date(dto.endTime),
                    });
                    await this.googleCalendarService.createCalendarEvent(calendarIntegration, {
                        title: service.name,
                        description: service.description ?? 'No description',
                        startTime: new Date(dto.startTime),
                        endTime: new Date(dto.endTime),
                        attendeeEmail: dto.clientEmail,
                    });
                }
                catch (err) {
                    console.error('Google Calendar failed:', err.message);
                }
            }
            return booking;
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Internal server error', error.message);
        }
    }
    async initializeBookingPayment(bookingId, dto) {
        try {
            const client = await this.prisma.user.findFirst({
                where: {
                    email: dto.email,
                },
            });
            let savedClientId;
            if (!client) {
                const saved = await this.authService.registerClient({
                    clientName: dto.clientName,
                    email: dto.clientEmail,
                    phone: dto.clientEmail,
                });
                savedClientId = saved.data.client.id;
            }
            const services = await this.prisma.service.findUnique({
                where: { id: dto.serviceId },
            });
            if (!services) {
                throw new common_1.BadRequestException('Service not found');
            }
            const vendorUser = await this.prisma.user.findFirst({
                where: {
                    id: services.userId,
                },
            });
            const amount = services.price;
            const response = await axios_1.default.post(`${process.env.PAYSTACK_BASE_URL}/transaction/initialize`, {
                email: dto.clientEmail,
                amount: amount * 100,
                metadata: {
                    vendorId: services.vendorId,
                    clientId: client?.id ?? savedClientId,
                    serviceId: dto.serviceId,
                    clientName: dto.clientName,
                    email: dto.clientEmail,
                    vendorEmail: vendorUser?.email,
                    businessName: dto.businessName,
                    dayOfWeek: dto.dayOfWeek,
                    startTime: dto.startTime,
                    phone: dto.phone,
                    endTime: dto.endTime,
                    type: 'JUBLY_BOOKING',
                    city: dto.city,
                    state: dto.state,
                    country: dto.country,
                    vendorUserId: vendorUser?.id,
                },
            }, {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json',
                },
            });
            await this.prisma.transaction.create({
                data: {
                    vendorId: services.vendorId ?? '',
                    amount,
                    providerRef: response.data.data.reference,
                    status: 'PENDING',
                },
            });
            return (0, response_1.successResponse)({
                authorizationUrl: response.data.data.authorization_url,
                reference: response.data.data.reference,
            }, 'Successful', 201);
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to initialize payment', error.message);
        }
    }
    async dashboardStats(userId, vendorId) {
        try {
            const bookingCount = await this.prisma.booking.count({
                where: {
                    userId,
                },
            });
            const upcomingBooking = await this.prisma.booking.count({
                where: {
                    userId,
                    status: 'PENDING',
                },
            });
            const earnings = await this.prisma.transaction.aggregate({
                where: {
                    vendorId,
                    status: 'SUCCESS',
                },
                _sum: {
                    amount: true,
                },
            });
            const views = await this.prisma.vendor.findFirst({
                where: {
                    userId,
                    id: vendorId,
                },
                select: {
                    vendorViews: true,
                },
            });
            return (0, response_1.successResponse)({
                bookingCount,
                upcomingBooking,
                earnings: earnings._sum.amount ?? 0,
                views: views?.vendorViews ?? 0,
            }, 'Successful');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch dashboard stats.', error.message);
        }
    }
};
exports.BookingService = BookingService;
exports.BookingService = BookingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [google_service_1.GoogleCalendarService,
        prisma_service_1.PrismaService,
        auth_service_1.AuthService])
], BookingService);
