/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
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
import { UserRole } from '@prisma/client';

export enum DateFilter {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

@Injectable()
export class BookingService {
  constructor(
    private googleCalendarService: GoogleCalendarService,
    private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  async createBooking(userId: string, dto: IBooking) {
    try {
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
          clientName: dto.clientName,
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

          await this.googleCalendarService.createCalendarEvent(
            calendarIntegration,
            {
              title: service.name,
              description: service.description ?? 'No description',
              startTime: new Date(dto.startTime),
              endTime: new Date(dto.endTime),
              attendeeEmail: dto.clientEmail,
              attendeeName: dto.clientName,
            },
          );
        } catch (err) {
          console.error('Google Calendar failed:', err.message);
        }
      }

      return booking;
    } catch (error) {
      throw new InternalServerErrorException(
        'Internal server error',
        error.message as string,
      );
    }
  }

  async initializeBookingPayment(bookingId: string, dto: any) {
    try {
      const client = await this.prisma.user.findFirst({
        where: {
          email: dto.clientEmail,
          role: UserRole.CLIENT,
        },
      });

      let savedClientId: string = client?.id ?? '';
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
        throw new BadRequestException('Service not found');
      }

      const vendorUser = await this.prisma.user.findFirst({
        where: {
          id: services.userId,
        },
      });

      const amount = services.price;

      const response = await axios.post(
        `${process.env.PAYSTACK_BASE_URL}/transaction/initialize`,
        {
          email: dto.clientEmail,
          amount: amount * 100,
          metadata: {
            slug: vendorUser?.slug,
            vendorId: services.vendorId,
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
          vendorId: services.vendorId ?? '',
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
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to initialize payment',
        error.message as string,
      );
    }
  }

  async dashboardStats(userId: string, vendorId: string) {
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

      return successResponse(
        {
          bookingCount,
          upcomingBooking,
          earnings: earnings._sum.amount ?? 0,
          views: views?.vendorViews ?? 0,
        },
        'Successful',
      );
    } catch (error) {
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

      return successResponse(
        bookings,
        'Successfully fetched next 24 hours bookings',
      );
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch count by service',
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
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const baseDate = date ? new Date(date) : new Date();

    const user = await this.prisma.vendor.findUnique({
      where: { userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const where: any = {};

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
  }

  async getClientsStats(userId: string) {
    // 1️⃣ Get vendor
    const vendor = await this.prisma.vendor.findFirst({
      where: { userId },
    });

    if (!vendor) {
      throw new Error('Vendor not found');
    }

    // 2️⃣ Total unique clients
    const totalClients = await this.prisma.booking.groupBy({
      by: ['clientEmail'],
      where: {
        vendorId: vendor.id,
      },
    });

    // 3️⃣ Repeat clients (clients with more than 1 booking)
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

    // 4️⃣ Repeat rate
    const repeatRate =
      totalClients.length === 0
        ? 0
        : Math.round((repeatClients.length / totalClients.length) * 100);

    // 5️⃣ Average booking value
    const bookings = await this.prisma.booking.findMany({
      where: {
        vendorId: vendor.id,
        status: 'CONFIRMED',
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

    return successResponse(
      {
        totalClients: totalClients.length,
        repeatClients: repeatClients.length,
        repeatRate,
        avgBookingValue,
      },
      'Successfully fetched clients stats',
    );
  }
}
