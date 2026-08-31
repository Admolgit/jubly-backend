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
exports.BookingService = exports.DateFilter = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("../../prisma/prisma.service");
const google_service_1 = require("../google/google.service");
const auth_service_1 = require("../auth/auth.service");
const response_1 = require("../utils/response");
const date_fns_1 = require("date-fns");
const client_1 = require("@prisma/client");
const nodemailer_service_1 = require("../nodemailer/nodemailer.service");
const paystack_service_1 = require("../paystack/paystack.service");
const activityLog_service_1 = require("../activity/activityLog.service");
const platform_settings_service_1 = require("../platform-settings/platform-settings.service");
const subscription_service_1 = require("../subscription/subscription.service");
const dateAndTimeConverter_1 = require("../utils/dateAndTimeConverter");
const paystackCalculation_1 = require("../utils/paystackCalculation");
var DateFilter;
(function (DateFilter) {
    DateFilter["DAY"] = "day";
    DateFilter["WEEK"] = "week";
    DateFilter["MONTH"] = "month";
    DateFilter["YEAR"] = "year";
})(DateFilter || (exports.DateFilter = DateFilter = {}));
let BookingService = class BookingService {
    constructor(googleCalendarService, prisma, authService, nodemailerService, paystackService, activityService, jwtService, platformSettingsService, subscriptionService) {
        this.googleCalendarService = googleCalendarService;
        this.prisma = prisma;
        this.authService = authService;
        this.nodemailerService = nodemailerService;
        this.paystackService = paystackService;
        this.activityService = activityService;
        this.jwtService = jwtService;
        this.platformSettingsService = platformSettingsService;
        this.subscriptionService = subscriptionService;
        this.completionTokenPurpose = 'booking-completion-approval';
        this.completionTokenTtl = '72h';
        this.bookingTimezone = 'Africa/Lagos';
        this.vendorBookingPaymentExpiryMs = 30 * 60 * 1000;
    }
    parseDateInput(value, fieldName) {
        const parsed = new Date(value);
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
    toBookingDate(startTime) {
        const { year, month, day } = this.getDatePartsInBookingTimezone(startTime);
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
            const bookingDate = this.toBookingDate(startTime);
            if (endTime <= startTime) {
                throw new common_1.BadRequestException('endTime must be later than startTime');
            }
            if (startTime < new Date()) {
                throw new common_1.BadRequestException('Cannot book a past date or time');
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
                    clientAddress: dto.clientAddress,
                    clientId: dto.clientId,
                    amount: service.price,
                    name: service.name,
                    startTime,
                    endTime,
                    status: 'CONFIRMED',
                    clientPhone: dto.phone,
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
                        bookingId: booking.id,
                    });
                }
                catch (err) {
                    console.error('Google Calendar failed:', err.message);
                }
            }
            await this.activityService.createLog({
                vendorId: booking.vendorId,
                userId: dto.userId,
                action: 'BOOKING_CREATED',
                description: `Booking #${booking.id} was created.`,
                actor: dto.clientName,
                actorType: 'CLIENT',
                color: 'blue',
            });
            return booking;
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Internal server error', error.message);
        }
    }
    async initializeBookingPayment(bookingId, dto) {
        try {
            const startTime = this.parseDateInput(dto.startTime, 'startTime');
            if (startTime < new Date()) {
                throw new common_1.BadRequestException('Cannot book a past date or time');
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
            if (vendorUser &&
                dto.clientEmail &&
                vendorUser.email.toLowerCase() === String(dto.clientEmail).toLowerCase()) {
                throw new common_1.BadRequestException('Vendors cannot book their own service');
            }
            const client = await this.prisma.user.findFirst({
                where: {
                    email: dto.clientEmail,
                },
            });
            let savedClientId = client?.id;
            if (!client) {
                const saved = await this.authService.registerClient({
                    clientName: dto.clientName,
                    email: dto.clientEmail,
                    phone: dto.phone,
                    clientVendorId: vendor?.id,
                });
                savedClientId = saved.data.client.id;
            }
            const amount = services.price;
            const pastackAmount = (0, paystackCalculation_1.addPaystackFee)(amount);
            const calculatedAmount = pastackAmount.totalAmount;
            const { authorizationUrl, reference } = await this.paystackService.initializeTransaction(dto.clientEmail, calculatedAmount, {
                slug: vendorUser?.slug,
                vendorId: vendor.id,
                clientId: savedClientId,
                serviceId: dto.serviceId,
                title: services.name,
                clientName: dto.clientName,
                clientAddress: dto.clientAddress,
                email: dto.clientEmail,
                vendorEmail: vendorUser?.email,
                businessName: vendor.businessName,
                city: vendor.city,
                state: vendor.state,
                country: vendor.country,
                durationMins: services.durationMins,
                dayOfWeek: dto.dayOfWeek,
                startTime: dto.startTime,
                phone: dto.phone,
                endTime: dto.endTime,
                type: 'JUBLY_BOOKING',
                vendorUserId: vendorUser?.id,
                userId: vendorUser?.id,
            });
            await this.prisma.transaction.create({
                data: {
                    vendorId: vendor.id,
                    amount,
                    providerRef: reference,
                    status: 'PENDING',
                },
            });
            return (0, response_1.successResponse)({
                authorizationUrl,
                reference,
            }, 'Successful', 201);
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to initialize payment', error.message);
        }
    }
    async createVendorBooking(userId, dto) {
        try {
            const vendor = await this.prisma.vendor.findFirst({
                where: { userId },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('Vendor not found');
            }
            const isManualBookingEnabled = await this.platformSettingsService.isManualBookingEnabled(vendor.id);
            if (!isManualBookingEnabled) {
                throw new common_1.ForbiddenException('Vendor-created bookings are currently disabled.');
            }
            const startTime = this.parseDateInput(dto.startTime, 'startTime');
            const service = await this.prisma.service.findFirst({
                where: { id: dto.serviceId },
            });
            if (!service) {
                throw new common_1.NotFoundException('Service not found');
            }
            const endTime = dto.endTime
                ? this.parseDateInput(dto.endTime, 'endTime')
                : new Date(startTime.getTime() + (service.durationMins || 60) * 60000);
            if (endTime <= startTime) {
                throw new common_1.BadRequestException('endTime must be later than startTime');
            }
            if (startTime < new Date()) {
                throw new common_1.BadRequestException('Cannot book a past date or time');
            }
            if (service.userId !== userId) {
                throw new common_1.ForbiddenException('You can only create bookings for your own services');
            }
            const bookingDate = this.toBookingDate(startTime);
            const dayOfWeek = startTime.getDay();
            const availability = await this.prisma.vendorAvailability.findUnique({
                where: {
                    vendorId_dayOfWeek: { vendorId: vendor.id, dayOfWeek },
                },
            });
            if (!availability) {
                throw new common_1.BadRequestException('Vendor is not available on this day');
            }
            const windowStart = new Date(`${startTime.toDateString()} ${availability.startTime}`);
            const windowEnd = new Date(`${startTime.toDateString()} ${availability.endTime}`);
            if (startTime < windowStart || endTime > windowEnd) {
                throw new common_1.BadRequestException('Requested time is outside vendor availability hours');
            }
            const bookingSettings = await this.prisma.vendorBookingSettings.findUnique({
                where: { vendorId: vendor.id },
            });
            const bufferMs = (bookingSettings?.bufferTime || 0) * 60000;
            const existingBookings = await this.prisma.booking.findMany({
                where: {
                    vendorId: vendor.id,
                    date: bookingDate,
                    status: {
                        notIn: ['CANCELLED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_VENDOR'],
                    },
                },
            });
            const hasOverlap = existingBookings.some((b) => startTime.getTime() - bufferMs < new Date(b.endTime).getTime() &&
                endTime.getTime() + bufferMs > new Date(b.startTime).getTime());
            if (hasOverlap) {
                throw new common_1.ConflictException('This time slot is already booked');
            }
            const amount = service.price;
            const existingClient = await this.prisma.user.findFirst({
                where: { email: dto.clientEmail },
            });
            if (dto.paymentOption === 'PAID_BY_HAND') {
                const canUsePaidByHand = await this.platformSettingsService.canUsePaidByHand(vendor.id);
                if (!canUsePaidByHand) {
                    throw new common_1.ForbiddenException('An active Jubly subscription is required to record externally paid bookings.');
                }
                const booking = await this.prisma.booking.create({
                    data: {
                        vendorId: vendor.id,
                        serviceId: dto.serviceId,
                        date: bookingDate,
                        startTime,
                        endTime,
                        name: service.name,
                        clientName: dto.clientName,
                        clientEmail: dto.clientEmail,
                        clientPhone: dto.clientPhone,
                        clientAddress: dto.clientAddress,
                        userId: existingClient?.id,
                        amount,
                        status: 'CONFIRMED',
                        source: 'VENDOR_CREATED',
                        paymentMethod: 'PAID_BY_HAND',
                        paymentVerification: 'VENDOR_REPORTED',
                    },
                });
                await this.prisma.transaction.create({
                    data: {
                        vendorId: vendor.id,
                        bookingId: booking.id,
                        amount,
                        currency: 'NGN',
                        providerRef: `MANUAL-${booking.id}`,
                        paymentMethod: 'PAID_BY_HAND',
                        status: 'COMPLETED',
                        percentageFee: 0,
                        title: service.name,
                        category: 'VENDOR_REPORTED',
                        paidAt: new Date(),
                    },
                });
                await this.activityService.createLog({
                    vendorId: vendor.id,
                    userId,
                    action: 'MANUAL_PAYMENT_RECORDED',
                    description: `Booking #${booking.id} was recorded as paid by hand.`,
                    actor: dto.clientName,
                    actorType: 'VENDOR',
                    color: 'green',
                });
                this.sendVendorCreatedBookingEmails(userId, vendor, service, booking, dto).catch((err) => console.error('Vendor-created booking email failed:', err?.message));
                return { booking };
            }
            const booking = await this.prisma.booking.create({
                data: {
                    vendorId: vendor.id,
                    serviceId: dto.serviceId,
                    date: bookingDate,
                    startTime,
                    endTime,
                    name: service.name,
                    clientName: dto.clientName,
                    clientEmail: dto.clientEmail,
                    clientPhone: dto.clientPhone,
                    userId: existingClient?.id,
                    amount,
                    status: 'PENDING',
                    source: 'VENDOR_CREATED',
                    paymentMethod: 'PAY_BY_LINK',
                    paymentVerification: 'PENDING',
                    paymentExpiresAt: new Date(Date.now() + this.vendorBookingPaymentExpiryMs),
                },
            });
            const percentageFee = await this.platformSettingsService.resolvePlatformPercentage(vendor.id);
            const vendorUser = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            const pastackAmount = (0, paystackCalculation_1.addPaystackFee)(amount);
            const calculatedAmount = pastackAmount.totalAmount;
            const { authorizationUrl, reference } = await this.paystackService.initializeTransaction(dto.clientEmail, calculatedAmount, {
                type: 'VENDOR_CREATED_BOOKING_LINK',
                bookingId: booking.id,
                vendorId: vendor.id,
                serviceId: dto.serviceId,
                clientAddress: dto.clientAddress,
                title: service.name,
                clientName: dto.clientName,
                clientEmail: dto.clientEmail,
                clientPhone: dto.clientPhone,
                vendorEmail: vendorUser?.email,
                percentageFee,
                businessName: vendor.businessName,
                slug: vendorUser?.slug,
            });
            await this.prisma.transaction.create({
                data: {
                    vendorId: vendor.id,
                    amount,
                    currency: 'NGN',
                    providerRef: reference,
                    status: 'PENDING',
                },
            });
            await this.activityService.createLog({
                vendorId: vendor.id,
                userId,
                action: 'BOOKING_CREATED',
                description: `Booking #${booking.id} was created and awaits payment.`,
                actor: dto.clientName,
                actorType: 'VENDOR',
                color: 'blue',
            });
            return { booking, paymentUrl: authorizationUrl, reference };
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Internal server error', error.message);
        }
    }
    async sendVendorCreatedBookingEmails(userId, vendor, service, booking, dto) {
        const vendorUser = await this.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!vendorUser?.email) {
            return;
        }
        const dateLabel = (0, dateAndTimeConverter_1.dateConverter)(booking.startTime);
        const timeLabel = (0, dateAndTimeConverter_1.timeConverter)(booking.startTime);
        const endTimeLabel = (0, dateAndTimeConverter_1.timeConverter)(booking.endTime);
        await this.nodemailerService.sendClientBookingMail({
            clientEmail: dto.clientEmail,
            clientName: dto.clientName,
            serviceName: service.name,
            vendorName: vendor.businessName,
            phone: vendorUser.phone || '',
            date: dateLabel,
            time: timeLabel,
            endTime: endTimeLabel,
            durationMins: Number(service.durationMins ?? 60),
            businessName: vendor.businessName,
            address: `${vendor.city} ${vendor.state} ${vendor.country ?? ''}`.trim(),
        });
        await this.nodemailerService.sendVendorBookingMail({
            vendorEmail: vendorUser.email,
            clientName: dto.clientName,
            clientEmail: dto.clientEmail,
            serviceName: service.name,
            date: dateLabel,
            time: timeLabel,
            endTime: endTimeLabel,
            phone: dto.clientPhone ?? '',
            durationMins: Number(service.durationMins ?? 60),
        });
    }
    async dashboardStats(userId, vendorId) {
        try {
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId },
            });
            if (!vendor || vendor?.id !== vendorId) {
                throw new common_1.ForbiddenException('Not allowed to view this dashboard');
            }
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
            if (error instanceof common_1.ForbiddenException) {
                throw error;
            }
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch admin booking stats.', error.message);
        }
    }
    async getAdminBookings(dto) {
        const { page, limit, search, dateFilter, date, status, startDate, endDate, } = dto;
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch admin bookings.', error.message);
        }
    }
    async getBookings(userId, page, limit, search, dateFilter, date, status) {
        try {
            const pageNum = Number(page);
            const limitNum = Number(limit);
            const baseDate = date ? new Date(date) : new Date();
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('User not found');
            }
            const where = {};
            if (userId) {
                where.vendorId = vendor.id;
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch bookings.', error.message);
        }
    }
    async getClientsBookings(userId, page, limit, search, dateFilter, date, status) {
        try {
            const pageNum = Number(page);
            const limitNum = Number(limit);
            const baseDate = date ? new Date(date) : new Date();
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            const where = {
                clientEmail: user.email,
            };
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
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
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch bookings stats.', error.message);
        }
    }
    async loadBookingForCompletion(bookingId) {
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                services: true,
                vendor: { include: { user: true } },
            },
        });
        if (!booking) {
            throw new common_1.NotFoundException('Booking not found');
        }
        return booking;
    }
    signCompletionToken(bookingId) {
        return this.jwtService.sign({ purpose: this.completionTokenPurpose, bookingId }, { expiresIn: this.completionTokenTtl });
    }
    verifyCompletionToken(token) {
        try {
            const payload = this.jwtService.verify(token);
            if (payload.purpose !== this.completionTokenPurpose ||
                !payload.bookingId) {
                throw new common_1.BadRequestException('This approval link is invalid.');
            }
            return { bookingId: payload.bookingId };
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.BadRequestException('This approval link is invalid or has expired.');
        }
    }
    async settleBookingPayment(booking) {
        const existingSettlement = await this.prisma.settlement.findFirst({
            where: {
                bookingId: booking.id,
                status: { in: ['PENDING', 'SUCCESS'] },
            },
        });
        if (existingSettlement) {
            const transaction = await this.prisma.transaction.findFirst({
                where: { bookingId: booking.id },
                orderBy: { createdAt: 'desc' },
            });
            return { transaction, settlement: existingSettlement };
        }
        if (booking.paymentMethod === 'PAID_BY_HAND') {
            const transaction = await this.prisma.transaction.findFirst({
                where: { bookingId: booking.id },
                orderBy: { createdAt: 'desc' },
            });
            return { transaction, settlement: null };
        }
        const transaction = await this.prisma.transaction.findFirst({
            where: { bookingId: booking.id, status: 'PENDING' },
        });
        if (!transaction) {
            throw new common_1.BadRequestException('No pending payment found for this booking');
        }
        if (!booking.vendor.bankAccountNumber || !booking.vendor.bankCode) {
            throw new common_1.BadRequestException('Vendor has no settlement bank account');
        }
        const percentageFee = transaction.percentageFee ?? 0;
        const vendorAmount = Math.round(transaction.amount * (1 - percentageFee) * 100) / 100;
        const recipient = await this.paystackService.createTransferRecipient({
            name: booking.vendor.businessName,
            accountNumber: booking.vendor.bankAccountNumber,
            bankCode: booking.vendor.bankCode,
        });
        const settlement = await this.prisma.settlement.create({
            data: {
                bookingId: booking.id,
                amount: vendorAmount,
                recipientCode: recipient.recipient_code,
                status: 'PENDING',
            },
        });
        let transfer;
        try {
            transfer = await this.paystackService.initiateTransfer({
                amount: vendorAmount,
                recipientCode: recipient.recipient_code,
                reason: `Settlement for booking ${booking.id}`,
                reference: `booking-${booking.id}-${Date.now()}`,
            });
        }
        catch (error) {
            await this.prisma.settlement.update({
                where: { id: settlement.id },
                data: { status: 'FAILED' },
            });
            throw error;
        }
        await this.prisma.settlement.update({
            where: { id: settlement.id },
            data: {
                transferCode: transfer.transfer_code,
                status: transfer.status?.toUpperCase() || 'PENDING',
            },
        });
        await this.prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: 'COMPLETED' },
        });
        return { transaction, settlement };
    }
    async completeBookingNow(booking, user) {
        const { transaction, settlement } = await this.settleBookingPayment(booking);
        const payoutAmount = settlement?.amount ?? transaction?.amount;
        const updatedBooking = await this.prisma.booking.update({
            where: { id: booking.id },
            data: { status: 'COMPLETED' },
        });
        await this.activityService.createLog({
            vendorId: booking.vendorId,
            userId: user.id,
            action: 'SETTLEMENT_PAID',
            description: `Settlement of ₦${payoutAmount?.toLocaleString() ?? '0'} processed.`,
            actor: 'System',
            actorType: 'SYSTEM',
            color: 'purple',
        });
        await this.nodemailerService.bookingCompletedMail({
            recipientEmail: booking.clientEmail,
            recipientName: booking.clientName ?? booking.clientEmail,
            serviceName: booking.services.name,
            vendorName: booking.vendor.businessName,
        });
        if (booking.vendor.user?.email) {
            await this.nodemailerService.bookingCompletedMail({
                recipientEmail: booking.vendor.user.email,
                recipientName: booking.vendor.businessName,
                serviceName: booking.services.name,
                vendorName: booking.vendor.businessName,
            });
        }
        return (0, response_1.successResponse)(updatedBooking, 'Booking marked as completed successfully');
    }
    async requestCompletionApproval(booking, user) {
        const updatedBooking = await this.prisma.booking.update({
            where: { id: booking.id },
            data: {
                status: 'COMPLETION_PENDING_APPROVAL',
                completionRequestedBy: user.id,
                completionRequestedAt: new Date(),
            },
        });
        await this.activityService.createLog({
            vendorId: booking.vendorId,
            userId: user.id,
            action: 'BOOKING_COMPLETION_REQUESTED',
            description: `Booking #${booking.id} completion requested by vendor, pending client approval.`,
            actor: booking.vendor.businessName,
            actorType: 'VENDOR',
            color: 'yellow',
        });
        const token = this.signCompletionToken(booking.id);
        const reviewUrl = `${process.env.FRONTEND_BASE_URL}/bookings/completion-review?token=${token}`;
        await this.nodemailerService.bookingCompletionRequestMail({
            recipientEmail: booking.clientEmail,
            recipientName: booking.clientName ?? booking.clientEmail,
            serviceName: booking.services.name,
            vendorName: booking.vendor.businessName,
            reviewUrl,
        });
        return (0, response_1.successResponse)(updatedBooking, 'Completion request sent to client for approval');
    }
    async markAsCompleted(bookingId, userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            const booking = await this.loadBookingForCompletion(bookingId);
            if (booking.status !== client_1.BookingStatus.CONFIRMED) {
                throw new common_1.BadRequestException('Only confirmed bookings can be marked as completed');
            }
            const isClient = user.role === client_1.UserRole.CLIENT && booking.clientEmail === user.email;
            const isVendor = user.role === client_1.UserRole.VENDOR && booking.vendor.userId === user.id;
            if (isClient) {
                return await this.completeBookingNow(booking, user);
            }
            if (isVendor) {
                return await this.requestCompletionApproval(booking, user);
            }
            throw new common_1.ForbiddenException('Not allowed to mark this booking as completed');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to mark booking as completed.', error.message);
        }
    }
    async approveCompletion(token) {
        try {
            const { bookingId } = this.verifyCompletionToken(token);
            const booking = await this.loadBookingForCompletion(bookingId);
            if (booking.status === client_1.BookingStatus.COMPLETED) {
                return (0, response_1.successResponse)(booking, 'This booking has already been completed.');
            }
            if (booking.status !== client_1.BookingStatus.COMPLETION_PENDING_APPROVAL) {
                return (0, response_1.successResponse)(booking, 'This completion request is no longer pending.');
            }
            const { transaction, settlement } = await this.settleBookingPayment(booking);
            const payoutAmount = settlement?.amount ?? transaction?.amount;
            const updatedBooking = await this.prisma.booking.update({
                where: { id: booking.id },
                data: {
                    status: 'COMPLETED',
                    completionApprovedAt: new Date(),
                },
            });
            await this.activityService.createLog({
                vendorId: booking.vendorId,
                userId: booking.clientId ?? undefined,
                action: 'BOOKING_COMPLETION_APPROVED',
                description: `Booking #${booking.id} completion approved by client. Settlement of ₦${payoutAmount?.toLocaleString() ?? '0'} processed.`,
                actor: booking.clientName ?? booking.clientEmail,
                actorType: 'CLIENT',
                color: 'purple',
            });
            await this.nodemailerService.bookingCompletedMail({
                recipientEmail: booking.clientEmail,
                recipientName: booking.clientName ?? booking.clientEmail,
                serviceName: booking.services.name,
                vendorName: booking.vendor.businessName,
            });
            if (booking.vendor.user?.email) {
                await this.nodemailerService.bookingCompletedMail({
                    recipientEmail: booking.vendor.user.email,
                    recipientName: booking.vendor.businessName,
                    serviceName: booking.services.name,
                    vendorName: booking.vendor.businessName,
                });
            }
            return (0, response_1.successResponse)(updatedBooking, 'Booking completion approved and payment released');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to approve booking completion.', error.message);
        }
    }
    async rejectCompletion(token, reason) {
        try {
            const { bookingId } = this.verifyCompletionToken(token);
            const booking = await this.loadBookingForCompletion(bookingId);
            if (booking.status === client_1.BookingStatus.COMPLETED) {
                return (0, response_1.successResponse)(booking, 'This booking has already been completed.');
            }
            if (booking.status !== client_1.BookingStatus.COMPLETION_PENDING_APPROVAL) {
                return (0, response_1.successResponse)(booking, 'This completion request is no longer pending.');
            }
            const updatedBooking = await this.prisma.booking.update({
                where: { id: booking.id },
                data: {
                    status: 'CONFIRMED',
                    completionRejectedAt: new Date(),
                    completionRejectionReason: reason,
                },
            });
            await this.activityService.createLog({
                vendorId: booking.vendorId,
                userId: booking.clientId ?? undefined,
                action: 'BOOKING_COMPLETION_REJECTED',
                description: `Booking #${booking.id} completion request rejected by client.`,
                actor: booking.clientName ?? booking.clientEmail,
                actorType: 'CLIENT',
                color: 'red',
                metadata: { reason },
            });
            if (booking.vendor.user?.email) {
                await this.nodemailerService.bookingCompletionRejectedMail({
                    recipientEmail: booking.vendor.user.email,
                    serviceName: booking.services.name,
                    clientName: booking.clientName ?? booking.clientEmail,
                    reason,
                });
            }
            return (0, response_1.successResponse)(updatedBooking, 'Completion request rejected');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to reject booking completion.', error.message);
        }
    }
    async getCompletionReview(token) {
        try {
            const { bookingId } = this.verifyCompletionToken(token);
            const booking = await this.loadBookingForCompletion(bookingId);
            return (0, response_1.successResponse)({
                bookingId: booking.id,
                status: booking.status,
                serviceName: booking.services.name,
                vendorName: booking.vendor.businessName,
                clientName: booking.clientName,
                date: booking.date,
                startTime: booking.startTime,
                endTime: booking.endTime,
                canAct: booking.status === client_1.BookingStatus.COMPLETION_PENDING_APPROVAL,
            }, 'Completion review details fetched');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch completion review details.', error.message);
        }
    }
    async getBookingsStatusFilter(userId) {
        const vendor = await this.prisma.vendor.findFirst({
            where: { userId },
        });
        if (!vendor) {
            throw new common_1.NotFoundException('Vendor not found');
        }
        const [all, pending, confirmed, completed, cancelled, cancelled_by_client, cancelled_by_vendor,] = await Promise.all([
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
            this.prisma.booking.count({
                where: {
                    status: client_1.BookingStatus.CANCELLED_BY_CLIENT,
                    vendorId: vendor.id,
                },
            }),
            this.prisma.booking.count({
                where: {
                    status: client_1.BookingStatus.CANCELLED_BY_VENDOR,
                    vendorId: vendor.id,
                },
            }),
        ]);
        return (0, response_1.successResponse)({
            all,
            pending,
            confirmed,
            completed,
            cancelled,
            cancelled_by_client,
            cancelled_by_vendor,
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
                day: bestDay,
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
    async getBusinessCategories() {
        try {
            const categories = await this.prisma.vendor.findMany({
                distinct: ['category'],
                select: {
                    category: true,
                },
            });
            const categoryList = categories.map((c) => c.category);
            return (0, response_1.successResponse)(categoryList, 'Business categories fetched');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch business categories.', error.message);
        }
    }
};
exports.BookingService = BookingService;
exports.BookingService = BookingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [google_service_1.GoogleCalendarService,
        prisma_service_1.PrismaService,
        auth_service_1.AuthService,
        nodemailer_service_1.NodemailerService,
        paystack_service_1.PaystackService,
        activityLog_service_1.ActivityService,
        jwt_1.JwtService,
        platform_settings_service_1.PlatformSettingsService,
        subscription_service_1.SubscriptionService])
], BookingService);
