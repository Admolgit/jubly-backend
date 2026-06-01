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
const nodemailer_service_1 = require("../nodemailer/nodemailer.service");
const paystack_service_1 = require("../paystack/paystack.service");
var DateFilter;
(function (DateFilter) {
    DateFilter["DAY"] = "day";
    DateFilter["WEEK"] = "week";
    DateFilter["MONTH"] = "month";
    DateFilter["YEAR"] = "year";
})(DateFilter || (exports.DateFilter = DateFilter = {}));
let BookingService = class BookingService {
    constructor(googleCalendarService, prisma, authService, nodemailerService, paystackService) {
        this.googleCalendarService = googleCalendarService;
        this.prisma = prisma;
        this.authService = authService;
        this.nodemailerService = nodemailerService;
        this.paystackService = paystackService;
        this.bookingTimezone = 'Africa/Lagos';
    }
    parseDateInput(value, fieldName) {
        const parsed = value instanceof Date ? new Date(value) : new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            throw new common_1.BadRequestException(`${fieldName} is invalid`);
        }
        return parsed;
    }
    getDatePartsInBookingTimezone(value) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: this.bookingTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(value);
        const year = parts.find((part) => part.type === 'year')?.value;
        const month = parts.find((part) => part.type === 'month')?.value;
        const day = parts.find((part) => part.type === 'day')?.value;
        if (!year || !month || !day) {
            throw new common_1.InternalServerErrorException('Failed to resolve booking date');
        }
        return { year, month, day };
    }
    toBookingDate(value, fallbackDate) {
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return new Date(`${value}T00:00:00.000+01:00`);
        }
        const baseDate = value instanceof Date
            ? new Date(value)
            : typeof value === 'string'
                ? this.parseDateInput(value, 'date')
                : fallbackDate;
        if (!baseDate) {
            throw new common_1.BadRequestException('date is required');
        }
        const { year, month, day } = this.getDatePartsInBookingTimezone(baseDate);
        return new Date(`${year}-${month}-${day}T00:00:00.000+01:00`);
    }
    getCreatedAtRange(dateFilter, date) {
        if (!dateFilter) {
            return undefined;
        }
        const baseDate = date ? new Date(date) : new Date();
        switch (dateFilter) {
            case DateFilter.DAY:
                return {
                    gte: new Date(baseDate.setHours(0, 0, 0, 0)),
                    lte: new Date(baseDate.setHours(23, 59, 59, 999)),
                };
            case DateFilter.WEEK:
                return {
                    gte: (0, date_fns_1.startOfWeek)(baseDate, { weekStartsOn: 1 }),
                    lte: (0, date_fns_1.endOfWeek)(baseDate, { weekStartsOn: 1 }),
                };
            case DateFilter.MONTH:
                return {
                    gte: (0, date_fns_1.startOfMonth)(baseDate),
                    lte: (0, date_fns_1.endOfMonth)(baseDate),
                };
            case DateFilter.YEAR:
                return {
                    gte: (0, date_fns_1.startOfYear)(baseDate),
                    lte: (0, date_fns_1.endOfYear)(baseDate),
                };
            default:
                return undefined;
        }
    }
    getDateRange(startDate, endDate) {
        if (!startDate && !endDate) {
            return undefined;
        }
        const range = {};
        if (startDate) {
            range.gte = new Date(`${startDate}T00:00:00.000`);
        }
        if (endDate) {
            range.lte = new Date(`${endDate}T23:59:59.999`);
        }
        if (range.gte && range.lte && range.gte > range.lte) {
            throw new common_1.BadRequestException('startDate cannot be later than endDate');
        }
        return range;
    }
    async getVendorCalendar(userId) {
        return await this.prisma.vendorCalendar.findFirst({
            where: {
                userId,
                provider: {
                    in: ['google', 'GOOGLE'],
                },
                linked: true,
            },
        });
    }
    async createBooking(userId, dto) {
        try {
            const startTime = this.parseDateInput(dto.startTime, 'startTime');
            const endTime = this.parseDateInput(dto.endTime, 'endTime');
            const bookingDate = this.toBookingDate(dto.date, startTime);
            if (endTime <= startTime) {
                throw new common_1.BadRequestException('endTime must be later than startTime');
            }
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
            const calendarIntegration = await this.getVendorCalendar(userId);
            const booking = await this.prisma.booking.create({
                data: {
                    vendorId: vendor.id,
                    serviceId: dto.serviceId,
                    date: bookingDate,
                    clientEmail: dto.clientEmail,
                    clientName: dto.clientName,
                    clientId: dto.clientId,
                    startTime,
                    endTime,
                    status: 'CONFIRMED',
                },
            });
            if (calendarIntegration) {
                try {
                    await this.googleCalendarService.verifyBooking({
                        calendar: calendarIntegration,
                        startTime,
                        endTime,
                    });
                    await this.googleCalendarService.createCalendarEvent(calendarIntegration, {
                        title: service.name,
                        description: service.description ?? 'No description',
                        startTime,
                        endTime,
                        attendeeEmail: dto.clientEmail,
                        attendeeName: dto.clientName,
                        vendorEmail: user.email,
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
            let savedClientId = client?.id ?? '';
            if (!client) {
                const saved = await this.authService.registerClient({
                    clientName: dto.clientName,
                    email: dto.clientEmail,
                    phone: dto.phone,
                    clientVendorId: dto.vendorId,
                });
                savedClientId = saved.data.client.id;
            }
            const services = await this.prisma.service.findUnique({
                where: { id: dto.serviceId },
            });
            if (!services) {
                throw new common_1.NotFoundException('Service not found');
            }
            const vendorUser = await this.prisma.user.findFirst({
                where: {
                    id: services.userId,
                },
            });
            const vendor = await this.prisma.vendor.findFirst({
                where: { userId: services.userId },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('Vendor not found');
            }
            console.log({ vendor });
            const amount = services.price;
            const response = await axios_1.default.post(`${process.env.PAYSTACK_BASE_URL}/transaction/initialize`, {
                email: dto.clientEmail,
                amount: amount * 100,
                metadata: {
                    slug: vendorUser?.slug,
                    vendorId: vendor.id,
                    clientId: savedClientId,
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
                    vendorId: vendor.id,
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
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            const bookingCount = await this.prisma.booking.count({
                where: {
                    vendorId,
                },
            });
            const currentMonthBookings = await this.prisma.booking.count({
                where: {
                    vendorId,
                    createdAt: {
                        gte: startOfMonth,
                    },
                },
            });
            const lastMonthBookings = await this.prisma.booking.count({
                where: {
                    vendorId,
                    createdAt: {
                        gte: startOfLastMonth,
                        lte: endOfLastMonth,
                    },
                },
            });
            const upcomingBooking = await this.prisma.booking.count({
                where: {
                    vendorId,
                    status: 'CONFIRMED',
                    startTime: {
                        gte: now,
                    },
                },
            });
            const thisWeekUpcoming = await this.prisma.booking.count({
                where: {
                    vendorId,
                    status: 'CONFIRMED',
                    startTime: {
                        gte: startOfWeek,
                    },
                },
            });
            const earnings = await this.prisma.transaction.aggregate({
                where: {
                    vendorId,
                    status: {
                        in: ['COMPLETED', 'CONFIRMED'],
                    },
                },
                _sum: {
                    amount: true,
                },
            });
            const currentMonthEarnings = await this.prisma.transaction.aggregate({
                where: {
                    vendorId,
                    status: {
                        in: ['COMPLETED', 'CONFIRMED'],
                    },
                    createdAt: {
                        gte: startOfMonth,
                    },
                },
                _sum: {
                    amount: true,
                },
            });
            const lastMonthEarnings = await this.prisma.transaction.aggregate({
                where: {
                    vendorId,
                    status: {
                        in: ['COMPLETED', 'CONFIRMED'],
                    },
                    createdAt: {
                        gte: startOfLastMonth,
                        lte: endOfLastMonth,
                    },
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
            const calculateGrowth = (current, previous) => {
                if (previous === 0) {
                    return current > 0 ? 100 : 0;
                }
                return Math.round(((current - previous) / previous) * 100);
            };
            const bookingGrowth = calculateGrowth(currentMonthBookings, lastMonthBookings);
            const earningsGrowth = calculateGrowth(currentMonthEarnings._sum.amount ?? 0, lastMonthEarnings._sum.amount ?? 0);
            return (0, response_1.successResponse)({
                bookingCount: {
                    total: bookingCount,
                    growth: bookingGrowth,
                },
                upcomingBooking: {
                    total: upcomingBooking,
                    growth: thisWeekUpcoming,
                },
                earnings: {
                    total: earnings._sum.amount ?? 0,
                    growth: earningsGrowth,
                },
                views: {
                    total: views?.vendorViews ?? 0,
                    growth: 8,
                },
            }, 'Successful');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch dashboard stats.', error.message);
        }
    }
    async getNext24HoursBookings(userId) {
        try {
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
                    status: {
                        in: ['CONFIRMED', 'PENDING'],
                    },
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
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch bookings.', error.message);
        }
    }
    async getUpcomingBookings(userId) {
        try {
            const vendor = await this.prisma.vendor.findFirst({
                where: { userId },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('Vendor not found');
            }
            const now = new Date();
            const bookings = await this.prisma.booking.findMany({
                where: {
                    vendorId: vendor.id,
                    status: 'CONFIRMED',
                    startTime: {
                        gte: now,
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
            return (0, response_1.successResponse)(bookings, 'Successfully fetched upcoming bookings');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch upcoming bookings.', error.message);
        }
    }
    async getClientUpcomingBookings(userId) {
        try {
            const user = await this.prisma.user.findFirst({
                where: { id: userId },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            const now = new Date();
            const bookings = await this.prisma.booking.findMany({
                where: {
                    clientEmail: user.email,
                    status: 'CONFIRMED',
                    startTime: {
                        gte: now,
                    },
                },
                orderBy: {
                    startTime: 'asc',
                },
                include: {
                    services: true,
                    vendor: {
                        select: {
                            businessName: true,
                        },
                    },
                },
                take: 5,
            });
            return (0, response_1.successResponse)(bookings, 'Successfully fetched upcoming bookings');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch upcoming bookings.', error.message);
        }
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
    async getAdminBookingStats() {
        try {
            const now = new Date();
            const startOfTodayDate = new Date();
            startOfTodayDate.setHours(0, 0, 0, 0);
            const endOfTodayDate = new Date(startOfTodayDate);
            endOfTodayDate.setDate(endOfTodayDate.getDate() + 1);
            const [totalBookings, pendingBookings, confirmedBookings, completedBookings, cancelledBookings, todayBookings, upcomingBookings,] = await Promise.all([
                this.prisma.booking.count(),
                this.prisma.booking.count({
                    where: { status: 'PENDING' },
                }),
                this.prisma.booking.count({
                    where: { status: 'CONFIRMED' },
                }),
                this.prisma.booking.count({
                    where: { status: 'COMPLETED' },
                }),
                this.prisma.booking.count({
                    where: { status: 'CANCELLED' },
                }),
                this.prisma.booking.count({
                    where: {
                        startTime: {
                            gte: startOfTodayDate,
                            lt: endOfTodayDate,
                        },
                    },
                }),
                this.prisma.booking.count({
                    where: {
                        status: 'CONFIRMED',
                        startTime: {
                            gte: now,
                        },
                    },
                }),
            ]);
            return (0, response_1.successResponse)({
                totalBookings,
                pendingBookings,
                confirmedBookings,
                completedBookings,
                cancelledBookings,
                todayBookings,
                upcomingBookings,
            }, 'Successfully fetched admin booking stats');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch admin booking stats.', error.message);
        }
    }
    async getAdminBookings(page, limit, search, dateFilter, date, status, startDate, endDate) {
        try {
            const pageNum = Math.max(Number.parseInt(page, 10) || 1, 1);
            const limitNum = Math.max(Number.parseInt(limit, 10) || 10, 1);
            const where = {};
            if (status) {
                where.status = status;
            }
            const createdAtRange = this.getCreatedAtRange(dateFilter, date);
            if (createdAtRange) {
                where.createdAt = createdAtRange;
            }
            const scheduledRange = this.getDateRange(startDate, endDate);
            if (scheduledRange) {
                where.startTime = scheduledRange;
            }
            if (search) {
                where.OR = [
                    {
                        clientName: {
                            contains: search,
                            mode: 'insensitive',
                        },
                    },
                    {
                        clientEmail: {
                            contains: search,
                            mode: 'insensitive',
                        },
                    },
                    {
                        vendor: {
                            is: {
                                businessName: {
                                    contains: search,
                                    mode: 'insensitive',
                                },
                            },
                        },
                    },
                    {
                        services: {
                            is: {
                                name: {
                                    contains: search,
                                    mode: 'insensitive',
                                },
                            },
                        },
                    },
                ];
            }
            const bookings = await this.prisma.booking.findMany({
                where,
                skip: (pageNum - 1) * limitNum,
                take: limitNum,
                orderBy: { createdAt: 'desc' },
                include: {
                    services: {
                        select: {
                            name: true,
                            price: true,
                        },
                    },
                    vendor: {
                        select: {
                            businessName: true,
                            category: true,
                            city: true,
                            state: true,
                        },
                    },
                },
            });
            const total = await this.prisma.booking.count({ where });
            return (0, response_1.successResponse)({ bookings }, 'Successfully fetched admin bookings', 200, {
                total,
                page: pageNum,
                lastPage: Math.max(1, Math.ceil(total / limitNum)),
                limit: limitNum,
            });
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch admin bookings.', error.message);
        }
    }
    async getBookings(userId, page, limit, search, dateFilter, date, status) {
        try {
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
                            durationMins: true,
                        },
                    },
                    vendor: {
                        select: {
                            businessName: true,
                            city: true,
                            state: true,
                            country: true,
                            bankAccountNumber: true,
                            bankCode: true,
                        },
                    },
                    user: {
                        select: {
                            firstName: true,
                            lastName: true,
                            email: true,
                            phone: true,
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
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch bookings.', error.message);
        }
    }
    async getClientsBookings(userId, page, limit, search, dateFilter, date, status, email) {
        try {
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const baseDate = date ? new Date(date) : new Date();
            const user = await this.prisma.user.findUnique({
                where: { email: email },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            const where = {};
            if (userId) {
                where.clientEmail = user.email;
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
                            durationMins: true,
                            active: true,
                        },
                    },
                    vendor: {
                        select: {
                            businessName: true,
                            city: true,
                            country: true,
                            state: true,
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
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch bookings.', error.message);
        }
    }
    async getClientsStats(userId) {
        try {
            const vendor = await this.prisma.vendor.findFirst({
                where: { userId },
            });
            if (!vendor) {
                throw new Error('Vendor not found');
            }
            const now = new Date();
            const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
            const totalClients = await this.prisma.booking.groupBy({
                by: ['clientEmail'],
                where: {
                    vendorId: vendor.id,
                    createdAt: {
                        gte: startOfCurrentMonth,
                    },
                },
            });
            const repeatClients = await this.prisma.booking.groupBy({
                by: ['clientEmail'],
                where: {
                    vendorId: vendor.id,
                    createdAt: {
                        gte: startOfCurrentMonth,
                    },
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
                    createdAt: {
                        gte: startOfCurrentMonth,
                    },
                },
                include: {
                    services: true,
                },
            });
            const total = bookings.reduce((sum, b) => sum + (b.services?.price || 0), 0);
            const avgBookingValue = bookings.length === 0 ? 0 : Math.round(total / bookings.length);
            const lastMonthTotalClients = await this.prisma.booking.groupBy({
                by: ['clientEmail'],
                where: {
                    vendorId: vendor.id,
                    createdAt: {
                        gte: startOfLastMonth,
                        lte: endOfLastMonth,
                    },
                },
            });
            const lastMonthRepeatClients = await this.prisma.booking.groupBy({
                by: ['clientEmail'],
                where: {
                    vendorId: vendor.id,
                    createdAt: {
                        gte: startOfLastMonth,
                        lte: endOfLastMonth,
                    },
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
            const lastMonthRepeatRate = lastMonthTotalClients.length === 0
                ? 0
                : Math.round((lastMonthRepeatClients.length / lastMonthTotalClients.length) *
                    100);
            const lastMonthBookings = await this.prisma.booking.findMany({
                where: {
                    vendorId: vendor.id,
                    status: 'CONFIRMED',
                    createdAt: {
                        gte: startOfLastMonth,
                        lte: endOfLastMonth,
                    },
                },
                include: {
                    services: true,
                },
            });
            const lastMonthTotal = lastMonthBookings.reduce((sum, b) => sum + (b.services?.price || 0), 0);
            const lastMonthAvgBookingValue = lastMonthBookings.length === 0
                ? 0
                : Math.round(lastMonthTotal / lastMonthBookings.length);
            const calculateGrowth = (current, previous) => {
                if (previous === 0) {
                    return current > 0 ? 100 : 0;
                }
                return Math.round(((current - previous) / previous) * 100);
            };
            return (0, response_1.successResponse)({
                totalClients: {
                    value: totalClients.length,
                    growth: calculateGrowth(totalClients.length, lastMonthTotalClients.length),
                },
                repeatClients: {
                    value: repeatClients.length,
                    growth: calculateGrowth(repeatClients.length, lastMonthRepeatClients.length),
                },
                repeatRate: {
                    value: repeatRate,
                    growth: calculateGrowth(repeatRate, lastMonthRepeatRate),
                },
                avgBookingValue: {
                    value: avgBookingValue,
                    growth: calculateGrowth(avgBookingValue, lastMonthAvgBookingValue),
                },
            }, 'Successfully fetched clients stats');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch bookings.', error.message);
        }
    }
    async getClientBookingsStats(userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: {
                    id: userId,
                },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            const booking = await this.prisma.booking.findMany({
                where: {
                    clientEmail: user.email,
                    status: {
                        in: ['COMPLETED', 'CONFIRMED'],
                    },
                },
                include: {
                    services: {
                        select: {
                            price: true,
                        },
                    },
                },
            });
            const activeBooking = await this.prisma.booking.count({
                where: {
                    clientEmail: user.email,
                    status: 'CONFIRMED',
                },
            });
            const total = booking.reduce((acc, sum) => {
                return acc + sum.services.price;
            }, 0);
            return (0, response_1.successResponse)({ activeBooking, total }, 'Stats fetched successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch bookings stats.', error.message);
        }
    }
    async cancelBooking(bookingId, userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: {
                    id: userId,
                },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            const booking = await this.prisma.booking.findUnique({
                where: { id: bookingId },
                include: {
                    services: true,
                    vendor: true,
                },
            });
            if (!booking) {
                throw new common_1.NotFoundException('Booking not found');
            }
            const updatedBooking = await this.prisma.booking.update({
                where: { id: bookingId },
                data: {
                    status: 'CANCELLED',
                },
            });
            await this.nodemailerService.bookingStatusChangeMail({
                subject: 'Your Booking Has Been Cancelled',
                name: booking.clientName,
                role: user.role,
                vendor: user.role === 'CLIENT' ? 'Client' : 'Vendor',
                serviceName: booking.services.name,
                vendorName: booking.vendor.businessName,
                email: user.role === 'CLIENT' ? user.email : booking.clientEmail,
                action: 'Cancel',
            });
            const transaction = await this.prisma.transaction.findFirst({
                where: {
                    bookingId: bookingId,
                },
            });
            if (transaction) {
                await this.prisma.transaction.update({
                    where: {
                        id: transaction.id,
                    },
                    data: {
                        status: 'CANCELLED',
                    },
                });
            }
            return (0, response_1.successResponse)(updatedBooking, 'Booking cancelled successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to cancel booking.', error.message);
        }
    }
    async rescheduleBooking(bookingId, dto, userId) {
        try {
            const { date, startTime, endTime } = dto;
            const start = this.parseDateInput(`${date}T${startTime}`, 'startTime');
            const end = this.parseDateInput(`${date}T${endTime}`, 'endTime');
            const bookingDate = this.toBookingDate(date, start);
            const user = await this.prisma.user.findUnique({
                where: {
                    id: userId,
                },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            if (start >= end) {
                throw new common_1.BadRequestException('End time must be after start time');
            }
            const booking = await this.prisma.booking.findUnique({
                where: { id: bookingId },
                include: {
                    services: true,
                    vendor: true,
                },
            });
            if (!booking) {
                throw new common_1.NotFoundException('Booking not found');
            }
            if (start < new Date()) {
                throw new common_1.BadRequestException('Cannot reschedule to a past time');
            }
            const conflict = await this.prisma.booking.findFirst({
                where: {
                    vendorId: booking.vendorId,
                    id: { not: bookingId },
                    AND: [
                        {
                            startTime: { lt: end },
                        },
                        {
                            endTime: { gt: start },
                        },
                    ],
                },
            });
            if (conflict) {
                throw new common_1.BadRequestException('Time slot already booked');
            }
            const updated = await this.prisma.booking.update({
                where: { id: bookingId },
                data: {
                    startTime: start,
                    endTime: end,
                    date: bookingDate,
                },
            });
            const calendarIntegration = this.getVendorCalendar(userId);
            const calendarApi = await this.googleCalendarService.calendarEnv(calendarIntegration);
            await calendarApi.events.update({
                calendarId: 'primary',
                eventId: booking.googleEventId,
                sendUpdates: 'all',
                requestBody: {
                    start: {
                        dateTime: new Date(startTime).toISOString(),
                        timeZone: 'Africa/Lagos',
                    },
                    end: {
                        dateTime: new Date(endTime).toISOString(),
                        timeZone: 'Africa/Lagos',
                    },
                },
            });
            await this.nodemailerService.bookingStatusChangeMail({
                subject: 'Your Booking Has Been Rescheldule',
                name: booking.clientName,
                role: user.role,
                vendor: user.role === 'CLIENT' ? 'Client' : 'Vendor',
                serviceName: booking.services.name,
                vendorName: booking.vendor.businessName,
                email: user.role === 'CLIENT' ? user.email : booking.clientEmail,
                oldDate: booking.date,
                oldStart: booking.startTime,
                oldEnd: booking.endTime,
                newDate: new Date(date),
                newStart: new Date(startTime),
                newEnd: new Date(endTime),
                action: 'Reschedule',
            });
            return (0, response_1.successResponse)(updated, 'Rescheduled successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to reschedule booking.', error.message);
        }
    }
    async markAsCmpleted(bookingId, userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: {
                    id: userId,
                },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            const booking = await this.prisma.booking.findUnique({
                where: { id: bookingId },
                include: {
                    services: true,
                    vendor: true,
                },
            });
            if (!booking) {
                throw new common_1.NotFoundException('Booking not found');
            }
            if (user.role !== client_1.UserRole.CLIENT || booking.clientEmail !== user.email) {
                throw new common_1.ForbiddenException('Only the client who made this booking can mark it as completed');
            }
            const existingSettlement = await this.prisma.settlement.findFirst({
                where: {
                    bookingId,
                    status: {
                        in: ['PENDING', 'SUCCESS'],
                    },
                },
            });
            const transaction = await this.prisma.transaction.findFirst({
                where: {
                    bookingId,
                    status: 'PENDING',
                },
            });
            if (!existingSettlement) {
                if (!transaction) {
                    throw new common_1.BadRequestException('No pending payment found for this booking');
                }
                if (!booking.vendor.bankAccountNumber || !booking.vendor.bankCode) {
                    throw new common_1.BadRequestException('Vendor has no settlement bank account');
                }
                const recipient = await this.paystackService.createTransferRecipient({
                    name: booking.vendor.businessName,
                    accountNumber: booking.vendor.bankAccountNumber,
                    bankCode: booking.vendor.bankCode,
                });
                const settlement = await this.prisma.settlement.create({
                    data: {
                        bookingId,
                        amount: transaction.amount,
                        recipientCode: recipient.recipient_code,
                        status: 'PENDING',
                    },
                });
                let transfer;
                try {
                    transfer = await this.paystackService.initiateTransfer({
                        amount: transaction.amount,
                        recipientCode: recipient.recipient_code,
                        reason: `Settlement for booking ${booking.id}`,
                        reference: `booking-${booking.id}-${Date.now()}`,
                    });
                }
                catch (error) {
                    await this.prisma.settlement.update({
                        where: {
                            id: settlement.id,
                        },
                        data: {
                            status: 'FAILED',
                        },
                    });
                    throw error;
                }
                await this.prisma.settlement.update({
                    where: {
                        id: settlement.id,
                    },
                    data: {
                        transferCode: transfer.transfer_code,
                        status: transfer.status?.toUpperCase() || 'PENDING',
                    },
                });
                await this.prisma.transaction.update({
                    where: {
                        id: transaction.id,
                    },
                    data: {
                        status: 'COMPLETED',
                    },
                });
            }
            const updatedBooking = await this.prisma.booking.update({
                where: { id: bookingId },
                data: {
                    status: 'COMPLETED',
                },
            });
            await this.nodemailerService.bookingStatusChangeMail({
                subject: 'Your Booking Has Been Mark As Completed',
                name: booking.clientName,
                role: user.role,
                vendor: user.role === 'CLIENT' ? 'Client' : 'Vendor',
                serviceName: booking.services.name,
                vendorName: booking.vendor.businessName,
                email: user.role === 'CLIENT' ? user.email : booking.clientEmail,
                action: 'Mark As Completed',
            });
            return (0, response_1.successResponse)(updatedBooking, 'Booking mark as completed successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to mark booking as completed.', error.message);
        }
    }
    async getBookingsStatusFilter(userId) {
        const vendor = await this.prisma.vendor.findFirst({
            where: { userId },
        });
        if (!vendor) {
            throw new common_1.NotFoundException('Vendor not found');
        }
        const [all, pending, confirmed, completed, cancelled] = await Promise.all([
            this.prisma.booking.count({
                where: {
                    vendorId: vendor.id,
                },
            }),
            this.prisma.booking.count({
                where: {
                    status: client_1.BookingStatus.PENDING,
                    vendorId: vendor.id,
                },
            }),
            this.prisma.booking.count({
                where: { status: client_1.BookingStatus.CONFIRMED, vendorId: vendor.id },
            }),
            this.prisma.booking.count({
                where: { status: client_1.BookingStatus.COMPLETED, vendorId: vendor.id },
            }),
            this.prisma.booking.count({
                where: { status: client_1.BookingStatus.CANCELLED, vendorId: vendor.id },
            }),
        ]);
        return (0, response_1.successResponse)({
            all,
            pending,
            confirmed,
            completed,
            cancelled,
        }, 'Status fetched successfully');
    }
    async getBusinessInsights(userId) {
        const vendor = await this.prisma.vendor.findFirst({
            where: { userId },
        });
        if (!vendor) {
            throw new common_1.NotFoundException('Vendor not found');
        }
        const bookingsByDay = await this.prisma.booking.groupBy({
            where: {
                vendorId: vendor.id,
            },
            by: ['date'],
            _count: {
                id: true,
            },
        });
        const dayMap = {};
        bookingsByDay.forEach((b) => {
            const day = new Date(b.date).toLocaleDateString('en-US', {
                weekday: 'long',
            });
            dayMap[day] = (dayMap[day] || 0) + b._count.id;
        });
        let bestDay = '';
        let maxBookings = 0;
        Object.entries(dayMap).forEach(([day, count]) => {
            if (count > maxBookings) {
                bestDay = day;
                maxBookings = count;
            }
        });
        const totalBookings = await this.prisma.booking.count({
            where: {
                vendorId: vendor.id,
            },
        });
        const bestDayPercentage = totalBookings
            ? Math.round((maxBookings / totalBookings) * 100)
            : 0;
        const avg = await this.prisma.booking.findMany({
            where: {
                vendorId: vendor.id,
            },
            include: {
                services: true,
            },
        });
        const bookingAvg = avg.reduce((a, b) => {
            return a + b.services.price;
        }, 0);
        const averageBooking = bookingAvg / totalBookings || 0;
        const repeatClientsData = await this.prisma.booking.groupBy({
            where: {
                vendorId: vendor.id,
            },
            by: ['clientEmail'],
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
        const repeatClients = repeatClientsData.length;
        return (0, response_1.successResponse)({
            bestDay: {
                day: bestDay || 'N/A',
                percentage: bestDayPercentage,
            },
            averageBooking,
            repeatClients,
        }, 'Business insight fetched');
    }
    async getClientBookingStats(clientEmail, vendorId) {
        const clientBookings = await this.prisma.booking.findMany({
            where: {
                clientEmail,
                vendorId,
            },
            include: {
                services: {
                    select: {
                        name: true,
                        price: true,
                    },
                },
            },
        });
        const amountSpent = clientBookings.reduce((sum, b) => {
            return sum + (b.services.price || 0);
        }, 0);
        const totalBookings = await this.prisma.booking.count({
            where: {
                clientEmail,
                vendorId,
            },
        });
        const confirmedBookings = await this.prisma.booking.count({
            where: {
                clientEmail,
                vendorId,
                status: 'CONFIRMED',
            },
        });
        const completedBookings = await this.prisma.booking.count({
            where: {
                clientEmail,
                vendorId,
                status: 'COMPLETED',
            },
        });
        const pendingBookings = await this.prisma.booking.count({
            where: {
                vendorId,
                clientEmail,
                status: 'PENDING',
            },
        });
        return (0, response_1.successResponse)({
            totalBookings,
            confirmedBookings,
            completedBookings,
            pendingBookings,
            amountSpent,
            bookings: clientBookings,
        }, 'Client booking stats fetched successfully');
    }
};
exports.BookingService = BookingService;
exports.BookingService = BookingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [google_service_1.GoogleCalendarService,
        prisma_service_1.PrismaService,
        auth_service_1.AuthService,
        nodemailer_service_1.NodemailerService,
        paystack_service_1.PaystackService])
], BookingService);
