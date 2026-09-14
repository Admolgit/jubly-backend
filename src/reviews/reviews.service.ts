import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { BookingStatus, Prisma, UserRole } from '@prisma/client';
import { isMongoId } from 'class-validator';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This booking has already been reviewed');
      }
      this.logger.error(
        'Review operation failed',
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException('Unable to process reviews');
    }
  }

  private async eligibleBooking(customerId: string, bookingId: string) {
    if (!isMongoId(customerId)) throw new UnauthorizedException();
    const customer = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { id: true, role: true },
    });
    if (!customer) throw new UnauthorizedException();
    if (customer.role !== UserRole.CLIENT) {
      throw new ForbiddenException('Only clients can access booking reviews');
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
    if (!booking) throw new NotFoundException('Booking not found');

    // Both legacy owner fields must agree when present. Never fall back to email.
    const owners = [booking.clientId, booking.userId].filter(
      (id): id is string => id !== null && id !== undefined,
    );
    if (!owners.length || owners.some((id) => id !== customer.id)) {
      throw new NotFoundException('Booking not found');
    }

    // Query by ID directly: existing Booking.vendorId has no ObjectId annotation.
    if (!isMongoId(booking.vendorId))
      throw new NotFoundException('Vendor not found');
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: booking.vendorId },
      select: { id: true, userId: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (vendor.userId === customer.id)
      throw new ForbiddenException('Self-reviews are not allowed');
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException('Only completed bookings can be reviewed');
    }
    return booking;
  }

  create(customerId: string, dto: CreateReviewDto) {
    return this.execute(async () => {
      if (!Number.isInteger(dto.rating) || dto.rating < 1 || dto.rating > 5) {
        throw new BadRequestException(
          'Rating must be an integer between 1 and 5',
        );
      }
      if (
        dto.comment != null &&
        (typeof dto.comment !== 'string' || dto.comment.trim().length > 2000)
      ) {
        throw new BadRequestException(
          'Comment must be a string of at most 2000 characters',
        );
      }
      const booking = await this.eligibleBooking(customerId, dto.bookingId);
      const existing = await this.prisma.review.findUnique({
        where: { bookingId: booking.id },
        select: { id: true },
      });
      if (existing)
        throw new ConflictException('This booking has already been reviewed');
      // The unique bookingId index is authoritative if two submissions race.
      const review = await this.prisma.review.create({
        data: {
          bookingId: booking.id,
          vendorId: booking.vendorId,
          customerId,
          rating: dto.rating,
          comment: dto.comment?.trim() || null,
        },
      });
      return successResponse({ review }, 'Review submitted successfully', 201);
    });
  }

  getBookingReview(customerId: string, bookingId: string) {
    return this.execute(async () => {
      const booking = await this.eligibleBooking(customerId, bookingId);
      const review = await this.prisma.review.findUnique({
        where: { bookingId: booking.id },
      });
      return successResponse({ review }, 'Booking review fetched successfully');
    });
  }

  getVendorReviews(vendorId: string, query: ReviewQueryDto) {
    return this.execute(async () => {
      const vendor = await this.prisma.vendor.findUnique({
        where: {
          id: vendorId,
          OR: [{ kycStatus: 'APPROVED' }, { isApproved: true }],
        },
        select: { id: true },
      });

      if (!vendor) throw new NotFoundException('Vendor profile not found');
      
      const { page, limit } = query;
      const skip = (page - 1) * limit;

      if (!Number.isSafeInteger(skip))
        throw new BadRequestException('Page is too large');
      
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
          displayName:
            [row.customer.firstName, row.customer.lastName]
              .map((name) => name?.trim())
              .filter(Boolean)
              .join(' ') || 'Customer',
        },
        serviceName: row.booking.name,
      }));
      const totalReviews = aggregate._count._all;
      return successResponse(
        {
          reviews,
          averageRating:
            aggregate._avg.rating === null
              ? null
              : Math.round(aggregate._avg.rating * 10) / 10,
          totalReviews,
        },
        'Vendor reviews fetched successfully',
        200,
        {
          page,
          limit,
          total: totalReviews,
          totalPages: Math.ceil(totalReviews / limit),
        },
      );
    });
  }

  async getPublicStats(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
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
          // Include this if your Review model has moderation:
          // status: 'APPROVED',
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
          // vendorRespondedAt: {
          //   not: null,
          // },
        },
        select: {
          createdAt: true,
          // vendorRespondedAt: true,
        },
      }),
    ]);

    const happyClients = new Set(
      completedBookings.map((booking) => booking.clientId),
    ).size;

    const averageRating = reviewSummary._avg.rating ?? 0;

    // Converts a 5-star score to a percentage.
    // Example: 4.5 / 5 × 100 = 90%
    const satisfactionRate =
      reviewSummary._count.rating > 0
        ? Math.round((averageRating / 5) * 100)
        : 0;

    // const responseTimes = respondedBookings
    //   .filter((booking) => booking.vendorRespondedAt)
    //   .map((booking) => {
    //     return (
    //       (booking.vendorRespondedAt!.getTime() - booking.createdAt.getTime()) /
    //       60_000
    //     );
    //   });

    // const averageResponseMinutes =
    //   responseTimes.length > 0
    //     ? Math.round(
    //         responseTimes.reduce((total, time) => total + time, 0) /
    //           responseTimes.length,
    //       )
    //     : null;

    return {
      happyClients,
      satisfactionRate,
      // responseLabel: this.getResponseLabel(averageResponseMinutes),
      // averageResponseMinutes,
    };
  }

  // private getResponseLabel(
  //   averageMinutes: number | null,
  // ): 'Fast' | 'Average' | 'Slow' | 'New' {
  //   if (averageMinutes === null) return 'New';
  //   if (averageMinutes <= 60) return 'Fast';
  //   if (averageMinutes <= 360) return 'Average';

  //   return 'Slow';
  // }
}
