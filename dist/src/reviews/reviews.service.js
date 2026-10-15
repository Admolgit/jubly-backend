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
var ReviewsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const class_validator_1 = require("class-validator");
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
let ReviewsService = ReviewsService_1 = class ReviewsService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(ReviewsService_1.name);
    }
    async execute(operation) {
        try {
            return await operation();
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002') {
                throw new common_1.ConflictException('This booking has already been reviewed');
            }
            this.logger.error('Review operation failed', error instanceof Error ? error.stack : undefined);
            throw new common_1.InternalServerErrorException('Unable to process reviews');
        }
    }
    async eligibleBooking(customerId, bookingId) {
        if (!(0, class_validator_1.isMongoId)(customerId))
            throw new common_1.UnauthorizedException();
        const customer = await this.prisma.user.findUnique({
            where: { id: customerId },
            select: { id: true, role: true },
        });
        if (!customer)
            throw new common_1.UnauthorizedException();
        if (customer.role !== client_1.UserRole.CLIENT) {
            throw new common_1.ForbiddenException('Only clients can access booking reviews');
        }
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            select: {
                id: true,
                clientId: true,
                userId: true,
                vendorId: true,
                status: true,
            },
        });
        if (!booking)
            throw new common_1.NotFoundException('Booking not found');
        const owners = [booking.clientId, booking.userId].filter((id) => id !== null && id !== undefined);
        if (!owners.length || owners.some((id) => id !== customer.id)) {
            throw new common_1.NotFoundException('Booking not found');
        }
        if (!(0, class_validator_1.isMongoId)(booking.vendorId))
            throw new common_1.NotFoundException('Vendor not found');
        const vendor = await this.prisma.vendor.findUnique({
            where: { id: booking.vendorId },
            select: { id: true, userId: true },
        });
        if (!vendor)
            throw new common_1.NotFoundException('Vendor not found');
        if (vendor.userId === customer.id)
            throw new common_1.ForbiddenException('Self-reviews are not allowed');
        if (booking.status !== client_1.BookingStatus.COMPLETED) {
            throw new common_1.BadRequestException('Only completed bookings can be reviewed');
        }
        return booking;
    }
    create(customerId, dto) {
        return this.execute(async () => {
            if (!Number.isInteger(dto.rating) || dto.rating < 1 || dto.rating > 5) {
                throw new common_1.BadRequestException('Rating must be an integer between 1 and 5');
            }
            if (dto.comment != null &&
                (typeof dto.comment !== 'string' || dto.comment.trim().length > 2000)) {
                throw new common_1.BadRequestException('Comment must be a string of at most 2000 characters');
            }
            const booking = await this.eligibleBooking(customerId, dto.bookingId);
            const existing = await this.prisma.review.findUnique({
                where: { bookingId: booking.id },
                select: { id: true },
            });
            if (existing)
                throw new common_1.ConflictException('This booking has already been reviewed');
            const review = await this.prisma.review.create({
                data: {
                    bookingId: booking.id,
                    vendorId: booking.vendorId,
                    customerId,
                    rating: dto.rating,
                    comment: dto.comment?.trim() || null,
                },
            });
            return (0, response_1.successResponse)({ review }, 'Review submitted successfully', 201);
        });
    }
    getBookingReview(customerId, bookingId) {
        return this.execute(async () => {
            const booking = await this.eligibleBooking(customerId, bookingId);
            const review = await this.prisma.review.findUnique({
                where: { bookingId: booking.id },
            });
            return (0, response_1.successResponse)({ review }, 'Booking review fetched successfully');
        });
    }
    getVendorReviews(vendorId, query) {
        return this.execute(async () => {
            const vendor = await this.prisma.vendor.findUnique({
                where: {
                    id: vendorId,
                    OR: [{ kycStatus: 'APPROVED' }, { isApproved: true }],
                },
                select: { id: true },
            });
            if (!vendor)
                throw new common_1.NotFoundException('Vendor profile not found');
            const { page, limit } = query;
            const skip = (page - 1) * limit;
            if (!Number.isSafeInteger(skip))
                throw new common_1.BadRequestException('Page is too large');
            const [rows, aggregate] = await this.prisma.$transaction([
                this.prisma.review.findMany({
                    where: { vendorId },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                    skip,
                    take: limit,
                    select: {
                        id: true,
                        rating: true,
                        comment: true,
                        createdAt: true,
                        customer: { select: { firstName: true, lastName: true } },
                        booking: { select: { name: true } },
                    },
                }),
                this.prisma.review.aggregate({
                    where: { vendorId },
                    _avg: { rating: true },
                    _count: { _all: true },
                }),
            ]);
            const reviews = rows.map((row) => ({
                id: row.id,
                rating: row.rating,
                comment: row.comment,
                createdAt: row.createdAt,
                customer: {
                    displayName: [row.customer.firstName, row.customer.lastName]
                        .map((name) => name?.trim())
                        .filter(Boolean)
                        .join(' ') || 'Customer',
                },
                serviceName: row.booking.name,
            }));
            const totalReviews = aggregate._count._all;
            return (0, response_1.successResponse)({
                reviews,
                averageRating: aggregate._avg.rating === null
                    ? null
                    : Math.round(aggregate._avg.rating * 10) / 10,
                totalReviews,
            }, 'Vendor reviews fetched successfully', 200, {
                page,
                limit,
                total: totalReviews,
                totalPages: Math.ceil(totalReviews / limit),
            });
        });
    }
    async getPublicStats(vendorId) {
        const vendor = await this.prisma.vendor.findUnique({
            where: { id: vendorId },
        });
        if (!vendor) {
            throw new common_1.NotFoundException('Vendor not found');
        }
        const [completedBookings, reviewSummary] = await Promise.all([
            this.prisma.booking.findMany({
                where: {
                    vendorId,
                    status: 'COMPLETED',
                },
                select: {
                    clientId: true,
                },
            }),
            this.prisma.review.aggregate({
                where: {
                    vendorId,
                },
                _avg: {
                    rating: true,
                },
                _count: {
                    rating: true,
                },
            }),
            this.prisma.booking.findMany({
                where: {
                    vendorId,
                },
                select: {
                    createdAt: true,
                },
            }),
        ]);
        const happyClients = new Set(completedBookings.map((booking) => booking.clientId)).size;
        const averageRating = reviewSummary._avg.rating ?? 0;
        const satisfactionRate = reviewSummary._count.rating > 0
            ? Math.round((averageRating / 5) * 100)
            : 0;
        return {
            happyClients,
            satisfactionRate,
        };
    }
};
exports.ReviewsService = ReviewsService;
exports.ReviewsService = ReviewsService = ReviewsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReviewsService);
