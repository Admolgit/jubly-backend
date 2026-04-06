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
exports.BookingService = exports.DateFilter = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const google_service_1 = require("../google/google.service");
const auth_service_1 = require("../auth/auth.service");
const response_1 = require("../utils/response");
const axios_1 = __importDefault(require("axios"));
const date_fns_1 = require("date-fns");
const client_1 = require("@prisma/client");
var DateFilter;
(function (DateFilter) {
    DateFilter["DAY"] = "day";
    DateFilter["WEEK"] = "week";
    DateFilter["MONTH"] = "month";
    DateFilter["YEAR"] = "year";
})(DateFilter || (exports.DateFilter = DateFilter = {}));
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
                    status: 'CONFIRMED',
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
                    email: dto.clientEmail,
                    role: client_1.UserRole.CLIENT,
                },
            });
            let savedClientId = '';
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
                    slug: vendorUser?.slug,
                    vendorId: services.vendorId,
                    clientId: client?.id ?? savedClientId,
                    serviceId: dto.serviceId,
                    title: services.name,
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
                    vendorId,
                },
            });
            const upcomingBooking = await this.prisma.booking.count({
                where: {
                    vendorId,
                    status: 'CONFIRMED',
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
    async getNext24HoursBookings(userId) {
        const vendor = await this.prisma.vendor.findFirst({
            where: { userId },
        });
        if (!vendor) {
            throw new common_1.NotFoundException('Vendor not found');
        }
        const now = new Date();
        const next24Hours = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const bookings = await this.prisma.booking.findMany({
            where: {
                vendorId: vendor.id,
                status: 'CONFIRMED',
                startTime: {
                    gte: now,
                    lte: next24Hours,
                },
            },
            orderBy: {
                startTime: 'asc',
            },
            include: {
                services: true,
            },
            take: 5,
        });
        return (0, response_1.successResponse)(bookings, 'Successfully fetched next 24 hours bookings');
    }
    async countBookingsByService(userId) {
        try {
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('Vendor not found');
            }
            const grouped = await this.prisma.booking.groupBy({
                by: ['serviceId'],
                where: {
                    vendorId: vendor.id,
                },
                _count: {
                    serviceId: true,
                },
                orderBy: {
                    _count: {
                        serviceId: 'desc',
                    },
                },
            });
            const serviceIds = grouped.map((g) => g.serviceId);
            const services = await this.prisma.service.findMany({
                where: {
                    id: { in: serviceIds },
                },
                select: {
                    id: true,
                    name: true,
                },
            });
            const groupedService = grouped.map((g) => ({
                serviceName: services.find((s) => s.id === g.serviceId)?.name || 'Unknown',
                count: g._count.serviceId,
            }));
            return (0, response_1.successResponse)(groupedService, 'Successfully counted bookings by service');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch count by service', error.message);
        }
    }
    async getBookings(userId, page, limit, search, dateFilter, date, status) {
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const baseDate = date ? new Date(date) : new Date();
        const user = await this.prisma.vendor.findUnique({
            where: { userId },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        const where = {};
        if (userId) {
            where.vendorId = user.id;
        }
        if (status) {
            where.status = status;
        }
        if (search) {
            where.clientName = { contains: search, mode: 'insensitive' };
        }
        if (dateFilter) {
            switch (dateFilter) {
                case DateFilter.DAY:
                    where.createdAt = {
                        gte: new Date(baseDate.setHours(0, 0, 0, 0)),
                        lte: new Date(baseDate.setHours(23, 59, 59, 999)),
                    };
                    break;
                case DateFilter.WEEK:
                    where.createdAt = {
                        gte: (0, date_fns_1.startOfWeek)(baseDate, { weekStartsOn: 1 }),
                        lte: (0, date_fns_1.endOfWeek)(baseDate, { weekStartsOn: 1 }),
                    };
                    break;
                case DateFilter.MONTH:
                    where.createdAt = {
                        gte: (0, date_fns_1.startOfMonth)(baseDate),
                        lte: (0, date_fns_1.endOfMonth)(baseDate),
                    };
                    break;
                case DateFilter.YEAR:
                    where.createdAt = {
                        gte: (0, date_fns_1.startOfYear)(baseDate),
                        lte: (0, date_fns_1.endOfYear)(baseDate),
                    };
                    break;
            }
        }
        const bookings = await this.prisma.booking.findMany({
            where,
            skip: (pageNum - 1) * limitNum,
            take: Number(limitNum),
            orderBy: { createdAt: 'desc' },
            include: {
                services: {
                    select: {
                        name: true,
                        price: true,
                    },
                },
            },
        });
        const total = await this.prisma.booking.count({ where });
        return (0, response_1.successResponse)(bookings, 'Successfully fetched bookings', 200, {
            total,
            page: pageNum,
            lastPage: Math.ceil(total / limitNum),
        });
    }
    async getClientsStats(userId) {
        const vendor = await this.prisma.vendor.findFirst({
            where: { userId },
        });
        if (!vendor) {
            throw new Error('Vendor not found');
        }
        const totalClients = await this.prisma.booking.groupBy({
            by: ['clientEmail'],
            where: {
                vendorId: vendor.id,
            },
        });
        const repeatClients = await this.prisma.booking.groupBy({
            by: ['clientEmail'],
            where: {
                vendorId: vendor.id,
            },
            _count: {
                clientEmail: true,
            },
            having: {
                clientEmail: {
                    _count: {
                        gt: 1,
                    },
                },
            },
        });
        const repeatRate = totalClients.length === 0
            ? 0
            : Math.round((repeatClients.length / totalClients.length) * 100);
        const bookings = await this.prisma.booking.findMany({
            where: {
                vendorId: vendor.id,
                status: 'CONFIRMED',
            },
            include: {
                services: true,
            },
        });
        const total = bookings.reduce((sum, b) => sum + (b.services?.price || 0), 0);
        const avgBookingValue = bookings.length === 0 ? 0 : Math.round(total / bookings.length);
        return (0, response_1.successResponse)({
            totalClients: totalClients.length,
            repeatClients: repeatClients.length,
            repeatRate,
            avgBookingValue,
        }, 'Successfully fetched clients stats');
    }
};
exports.BookingService = BookingService;
exports.BookingService = BookingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [google_service_1.GoogleCalendarService,
        prisma_service_1.PrismaService,
        auth_service_1.AuthService])
], BookingService);
