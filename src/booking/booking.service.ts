/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { GoogleCalendarService } from 'src/google/google.service';
import { IBooking } from './dto/booking.dto';
import { AuthService } from 'src/auth/auth.service';
import { successResponse } from 'src/utils/response';
import axios from 'axios';
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from 'date-fns';
import { BookingStatus, UserRole } from '@prisma/client';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { PaystackService } from 'src/paystack/paystack.service';
import { ActivityService } from 'src/activity/activityLog.service';

export enum DateFilter {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

@Injectable()
export class BookingService {
  constructor(
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly nodemailerService: NodemailerService,
    private readonly paystackService: PaystackService,
    private readonly activityService: ActivityService,
  ) {}

  private readonly bookingTimezone = 'Africa/Lagos';

  private parseDateInput(value: string | Date, fieldName: string) {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} is invalid`);
    }

    return parsed;
  }

  private getDatePartsInBookingTimezone(value: Date) {
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
      throw new InternalServerErrorException('Failed to resolve booking date');
    }

    return { year, month, day };
  }

  private toBookingDate(startTime: Date) {
    const { year, month, day } = this.getDatePartsInBookingTimezone(startTime);

    return new Date(`${year}-${month}-${day}T00:00:00.000+01:00`);
  }

  private getCreatedAtRange(dateFilter?: DateFilter, date?: string) {
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
          gte: startOfWeek(baseDate, { weekStartsOn: 1 }),
          lte: endOfWeek(baseDate, { weekStartsOn: 1 }),
        };
      case DateFilter.MONTH:
        return {
          gte: startOfMonth(baseDate),
          lte: endOfMonth(baseDate),
        };
      case DateFilter.YEAR:
        return {
          gte: startOfYear(baseDate),
          lte: endOfYear(baseDate),
        };
      default:
        return undefined;
    }
  }

  private getDateRange(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) {
      return undefined;
    }

    const range: { gte?: Date; lte?: Date } = {};

    if (startDate) {
      range.gte = new Date(`${startDate}T00:00:00.000`);
    }

    if (endDate) {
      range.lte = new Date(`${endDate}T23:59:59.999`);
    }

    if (range.gte && range.lte && range.gte > range.lte) {
      throw new BadRequestException('startDate cannot be later than endDate');
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

  async createBooking(userId: string, dto: IBooking) {
    try {
      const startTime = this.parseDateInput(dto.startTime, 'startTime');
      const endTime = this.parseDateInput(dto.endTime, 'endTime');
      const bookingDate = this.toBookingDate(startTime);

      if (endTime <= startTime) {
        throw new BadRequestException('endTime must be later than startTime');
      }

      if (startTime < new Date()) {
        throw new BadRequestException('Cannot book a past date or time');
      }

      const user = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const service = await this.prisma.service.findFirst({
        where: {
          id: dto.serviceId,
        },
      });

      if (!service) {
        throw new NotFoundException('Service not found');
      }

      const vendor = await this.prisma.vendor.findFirst({
        where: {
          userId,
        },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
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
          name: service.name,
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

          await this.googleCalendarService.createCalendarEvent(
            calendarIntegration,
            {
              title: service.name,
              description: service.description ?? 'No description',
              startTime,
              endTime,
              attendeeEmail: dto.clientEmail,
              attendeeName: dto.clientName,
              vendorEmail: user.email,
              bookingId: booking.id,
            },
          );
        } catch (err: any) {
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
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Internal server error',
        error.message as string,
      );
    }
  }

  async initializeBookingPayment(bookingId: string, dto: any) {
    try {
      const startTime = this.parseDateInput(dto.startTime, 'startTime');

      if (startTime < new Date()) {
        throw new BadRequestException('Cannot book a past date or time');
      }

      const services = await this.prisma.service.findUnique({
        where: { id: dto.serviceId },
      });

      if (!services) {
        throw new NotFoundException('Service not found');
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
        throw new NotFoundException('Vendor not found');
      }

      if (
        vendorUser &&
        dto.clientEmail &&
        vendorUser.email.toLowerCase() === String(dto.clientEmail).toLowerCase()
      ) {
        throw new BadRequestException('Vendors cannot book their own service');
      }

      const client = await this.prisma.user.findFirst({
        where: {
          email: dto.clientEmail,
          // role: UserRole.CLIENT,
        },
      });

      let savedClientId: string | undefined = client?.id;
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

      const response = await axios.post(
        `${process.env.PAYSTACK_BASE_URL}/transaction/initialize`,
        {
          email: dto.clientEmail,
          amount: amount * 100,
          metadata: {
            slug: vendorUser?.slug,
            vendorId: vendor.id,
            clientId: savedClientId,
            serviceId: dto.serviceId,
            title: services.name,
            clientName: dto.clientName,
            clientAddress: dto.clientAddress,
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
            userId: vendorUser?.id,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );

      await this.prisma.transaction.create({
        data: {
          vendorId: vendor.id,
          amount,
          providerRef: (response.data as any).data.reference,
          status: 'PENDING',
        },
      });

      return successResponse(
        {
          authorizationUrl: (response.data as any).data.authorization_url,
          reference: (response.data as any).data.reference,
        },
        'Successful',
        201,
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to initialize payment',
        error.message as string,
      );
    }
  }

  async dashboardStats(userId: string, vendorId: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor || vendor?.id !== vendorId) {
        throw new ForbiddenException('Not allowed to view this dashboard');
      }

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const startOfLastMonth = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        1,
      );

      const endOfLastMonth = new Date(
        now.getFullYear(),
        now.getMonth(),
        0,
        23,
        59,
        59,
      );

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

      const calculateGrowth = (current: number, previous: number) => {
        if (previous === 0) {
          return current > 0 ? 100 : 0;
        }

        return Math.round(((current - previous) / previous) * 100);
      };

      const bookingGrowth = calculateGrowth(
        currentMonthBookings,
        lastMonthBookings,
      );

      const earningsGrowth = calculateGrowth(
        currentMonthEarnings._sum.amount ?? 0,
        lastMonthEarnings._sum.amount ?? 0,
      );

      return successResponse(
        {
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
        },
        'Successful',
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch dashboard stats.',
        error.message as string,
      );
    }
  }

  async getNext24HoursBookings(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findFirst({
        where: { userId },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
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

      return successResponse(
        bookings,
        'Successfully fetched next 24 hours bookings',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch bookings.',
        error.message as string,
      );
    }
  }

  async getUpcomingBookings(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findFirst({
        where: { userId },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
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

      return successResponse(
        bookings,
        'Successfully fetched upcoming bookings',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch upcoming bookings.',
        error.message as string,
      );
    }
  }
  async getClientUpcomingBookings(userId: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
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

      return successResponse(
        bookings,
        'Successfully fetched upcoming bookings',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch upcoming bookings.',
        error.message as string,
      );
    }
  }

  async countBookingsByService(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
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
        serviceName:
          services.find((s) => s.id === g.serviceId)?.name || 'Unknown',
        count: g._count.serviceId,
      }));

      return successResponse(
        groupedService,
        'Successfully counted bookings by service',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch count by service',
        error.message as string,
      );
    }
  }

  async getAdminBookingStats() {
    try {
      const now = new Date();
      const startOfTodayDate = new Date();
      startOfTodayDate.setHours(0, 0, 0, 0);

      const endOfTodayDate = new Date(startOfTodayDate);
      endOfTodayDate.setDate(endOfTodayDate.getDate() + 1);

      const [
        totalBookings,
        pendingBookings,
        confirmedBookings,
        completedBookings,
        cancelledBookings,
        todayBookings,
        upcomingBookings,
      ] = await Promise.all([
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

      return successResponse(
        {
          totalBookings,
          pendingBookings,
          confirmedBookings,
          completedBookings,
          cancelledBookings,
          todayBookings,
          upcomingBookings,
        },
        'Successfully fetched admin booking stats',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch admin booking stats.',
        error.message as string,
      );
    }
  }

  async getAdminBookings(dto: {
    page: string;
    limit: string;
    search?: string;
    dateFilter?: DateFilter;
    date?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const {
      page,
      limit,
      search,
      dateFilter,
      date,
      status,
      startDate,
      endDate,
    } = dto;
    try {
      const pageNum = Math.max(Number.parseInt(page, 10) || 1, 1);
      const limitNum = Math.max(Number.parseInt(limit, 10) || 10, 1);

      const where: any = {};

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

      return successResponse(
        { bookings },
        'Successfully fetched admin bookings',
        200,
        {
          total,
          page: pageNum,
          lastPage: Math.max(1, Math.ceil(total / limitNum)),
          limit: limitNum,
        },
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch admin bookings.',
        error.message as string,
      );
    }
  }

  async getBookings(
    userId: string,
    page: string,
    limit: string,
    search?: string,
    dateFilter?: DateFilter,
    date?: string,
    status?: string,
  ) {
    try {
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const baseDate = date ? new Date(date) : new Date();

      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        throw new NotFoundException('User not found');
      }

      const where: any = {};

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
              gte: startOfWeek(baseDate, { weekStartsOn: 1 }),
              lte: endOfWeek(baseDate, { weekStartsOn: 1 }),
            };
            break;
          case DateFilter.MONTH:
            where.createdAt = {
              gte: startOfMonth(baseDate),
              lte: endOfMonth(baseDate),
            };
            break;
          case DateFilter.YEAR:
            where.createdAt = {
              gte: startOfYear(baseDate),
              lte: endOfYear(baseDate),
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

      return successResponse(bookings, 'Successfully fetched bookings', 200, {
        total,
        page: pageNum,
        lastPage: Math.ceil(total / limitNum),
      });
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch bookings.',
        error.message,
      );
    }
  }

  async getClientsBookings(
    userId: string,
    page: string,
    limit: string,
    search?: string,
    dateFilter?: DateFilter,
    date?: string,
    status?: string,
    email?: string,
  ) {
    try {
      const pageNum = Number(page);
      const limitNum = Number(limit);
      const baseDate = date ? new Date(date) : new Date();

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const where: any = {
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
              gte: startOfWeek(baseDate, { weekStartsOn: 1 }),
              lte: endOfWeek(baseDate, { weekStartsOn: 1 }),
            };
            break;
          case DateFilter.MONTH:
            where.createdAt = {
              gte: startOfMonth(baseDate),
              lte: endOfMonth(baseDate),
            };
            break;
          case DateFilter.YEAR:
            where.createdAt = {
              gte: startOfYear(baseDate),
              lte: endOfYear(baseDate),
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

      return successResponse(bookings, 'Successfully fetched bookings', 200, {
        total,
        page: pageNum,
        lastPage: Math.ceil(total / limitNum),
      });
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch bookings.',
        (error as Error).message,
      );
    }
  }

  async getClientsStats(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findFirst({
        where: { userId },
      });

      if (!vendor) {
        throw new Error('Vendor not found');
      }

      const now = new Date();

      const startOfCurrentMonth = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      );

      const startOfLastMonth = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        1,
      );

      const endOfLastMonth = new Date(
        now.getFullYear(),
        now.getMonth(),
        0,
        23,
        59,
        59,
      );

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

      const repeatRate =
        totalClients.length === 0
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

      const total = bookings.reduce(
        (sum, b) => sum + (b.services?.price || 0),
        0,
      );

      const avgBookingValue =
        bookings.length === 0 ? 0 : Math.round(total / bookings.length);

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

      const lastMonthRepeatRate =
        lastMonthTotalClients.length === 0
          ? 0
          : Math.round(
              (lastMonthRepeatClients.length / lastMonthTotalClients.length) *
                100,
            );

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

      const lastMonthTotal = lastMonthBookings.reduce(
        (sum, b) => sum + (b.services?.price || 0),
        0,
      );

      const lastMonthAvgBookingValue =
        lastMonthBookings.length === 0
          ? 0
          : Math.round(lastMonthTotal / lastMonthBookings.length);

      const calculateGrowth = (current: number, previous: number) => {
        if (previous === 0) {
          return current > 0 ? 100 : 0;
        }

        return Math.round(((current - previous) / previous) * 100);
      };

      return successResponse(
        {
          totalClients: {
            value: totalClients.length,
            growth: calculateGrowth(
              totalClients.length,
              lastMonthTotalClients.length,
            ),
          },

          repeatClients: {
            value: repeatClients.length,
            growth: calculateGrowth(
              repeatClients.length,
              lastMonthRepeatClients.length,
            ),
          },

          repeatRate: {
            value: repeatRate,
            growth: calculateGrowth(repeatRate, lastMonthRepeatRate),
          },

          avgBookingValue: {
            value: avgBookingValue,
            growth: calculateGrowth(avgBookingValue, lastMonthAvgBookingValue),
          },
        },
        'Successfully fetched clients stats',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch bookings.',
        error.message as string,
      );
    }
  }

  async getClientBookingsStats(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
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

      return successResponse(
        { activeBooking, total },
        'Stats fetched successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch bookings stats.',
        error.message as string,
      );
    }
  }

  async markAsCmpleted(bookingId: string, userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const vendor = await this.prisma.vendor.findFirst({
        where: { userId },
      });

      const booking = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          services: true,
          vendor: true,
        },
      });

      if (!booking) {
        throw new NotFoundException('Booking not found');
      }

      if (user.role !== UserRole.CLIENT || booking.clientEmail !== user.email) {
        throw new ForbiddenException(
          'Only the client who made this booking can mark it as completed',
        );
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
          throw new BadRequestException(
            'No pending payment found for this booking',
          );
        }

        if (!booking.vendor.bankAccountNumber || !booking.vendor.bankCode) {
          throw new BadRequestException(
            'Vendor has no settlement bank account',
          );
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

        let transfer: any;
        try {
          transfer = await this.paystackService.initiateTransfer({
            amount: transaction.amount,
            recipientCode: recipient.recipient_code,
            reason: `Settlement for booking ${booking.id}`,
            reference: `booking-${booking.id}-${Date.now()}`,
          });
        } catch (error) {
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

      await this.activityService.createLog({
        vendorId: vendor ? vendor.id : booking.vendorId,
        userId,
        action: 'SETTLEMENT_PAID',
        description: `Settlement of ₦${transaction?.amount?.toLocaleString()} processed.`,
        actor: 'System',
        actorType: 'SYSTEM',
        color: 'purple',
      });

      await this.nodemailerService.bookingStatusChangeMail({
        subject: 'Your Booking Has Been Mark As Completed',
        name: booking.clientName as string,
        role: user.role,
        vendor: user.role === 'CLIENT' ? 'Client' : 'Vendor',
        serviceName: booking.services.name,
        vendorName: booking.vendor.businessName,
        email: user.role === 'CLIENT' ? user.email : booking.clientEmail,
        action: 'Mark As Completed',
      });

      return successResponse(
        updatedBooking,
        'Booking mark as completed successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to mark booking as completed.',
        error.message as string,
      );
    }
  }

  async getBookingsStatusFilter(userId: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const [all, pending, confirmed, completed, cancelled] = await Promise.all([
      this.prisma.booking.count({
        where: {
          vendorId: vendor.id,
        },
      }),

      this.prisma.booking.count({
        where: {
          status: BookingStatus.PENDING,
          vendorId: vendor.id,
        },
      }),

      this.prisma.booking.count({
        where: { status: BookingStatus.CONFIRMED, vendorId: vendor.id },
      }),

      this.prisma.booking.count({
        where: { status: BookingStatus.COMPLETED, vendorId: vendor.id },
      }),

      this.prisma.booking.count({
        where: { status: BookingStatus.CANCELLED, vendorId: vendor.id },
      }),
    ]);

    return successResponse(
      {
        all,
        pending,
        confirmed,
        completed,
        cancelled,
      },
      'Status fetched successfully',
    );
  }

  async getBusinessInsights(userId: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
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

    const dayMap: Record<string, number> = {};

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

    return successResponse(
      {
        bestDay: {
          day: bestDay,
          percentage: bestDayPercentage,
        },
        averageBooking,
        repeatClients,
      },
      'Business insight fetched',
    );
  }

  async getClientBookingStats(clientEmail: string, vendorId: string) {
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

    return successResponse(
      {
        totalBookings,
        confirmedBookings,
        completedBookings,
        pendingBookings,
        amountSpent,
        bookings: clientBookings,
      },
      'Client booking stats fetched successfully',
    );
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

      return successResponse(categoryList, 'Business categories fetched');
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch business categories.',
        error.message as string,
      );
    }
  }
}
