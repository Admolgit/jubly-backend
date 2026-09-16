/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { PrismaService } from 'prisma/prisma.service';
import { GoogleCalendarService } from 'src/google/google.service';
import { IBooking } from './dto/booking.dto';
import { CreateVendorBookingDto } from './dto/vendor-booking.dto';
import {
  assertBookingSlotAvailable,
  withVendorScheduleLock,
} from './booking-slot.util';
import { AuthService } from 'src/auth/auth.service';
import { successResponse } from 'src/utils/response';
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
import { PlatformSettingsService } from 'src/platform-settings/platform-settings.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { dateConverter, timeConverter } from 'src/utils/dateAndTimeConverter';
import {
  addPaystackFee,
  calculateJublyCommission,
} from 'src/utils/paystackCalculation';

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
    private readonly jwtService: JwtService,
    private readonly platformSettingsService: PlatformSettingsService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  private readonly completionTokenPurpose = 'booking-completion-approval';
  private readonly completionTokenTtl = '72h';

  private readonly bookingTimezone = 'Africa/Lagos';

  private readonly vendorBookingPaymentExpiryMs = 30 * 60 * 1000;

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

  async createBooking(
    userId: string,
    dto: IBooking,
    payment?: { reference: string; slotLockId?: string },
  ) {
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

      const result = await withVendorScheduleLock(
        this.prisma,
        vendor.id,
        async (tx) => {
          if (payment) {
            const transaction = await tx.transaction.findUnique({
              where: { providerRef: payment.reference },
            });
            if (!transaction || transaction.vendorId !== vendor.id) {
              throw new BadRequestException('Transaction was not initialized');
            }
            if (transaction.bookingId) {
              return {
                booking: await tx.booking.findUniqueOrThrow({
                  where: { id: transaction.bookingId },
                }),
                created: false,
              };
            }
          }
          await assertBookingSlotAvailable(tx, {
            vendorId: vendor.id,
            start: startTime,
            end: endTime,
            excludeSlotLockId: payment?.slotLockId,
          });
          const booking = await tx.booking.create({
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
          if (payment) {
            await tx.transaction.update({
              where: { providerRef: payment.reference },
              data: { bookingId: booking.id },
            });
            if (payment.slotLockId) {
              await tx.slotLock.deleteMany({
                where: { id: payment.slotLockId, vendorId: vendor.id },
              });
            }
          }
          return { booking, created: true };
        },
      );
      const { booking } = result;
      if (!result.created) return booking;

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
    let slotLockId: string | undefined;
    try {
      const startTime = this.parseDateInput(dto.startTime, 'startTime');
      const endTime = this.parseDateInput(dto.endTime, 'endTime');

      if (endTime <= startTime) {
        throw new BadRequestException('endTime must be later than startTime');
      }

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

      const pastackAmount = addPaystackFee(amount);

      const calculatedAmount = pastackAmount.totalAmount;

      const lock = await withVendorScheduleLock(
        this.prisma,
        vendor.id,
        async (tx) => {
          await assertBookingSlotAvailable(tx, {
            vendorId: vendor.id,
            start: startTime,
            end: endTime,
          });
          await tx.slotLock.deleteMany({
            where: { vendorId: vendor.id, expiresAt: { lte: new Date() } },
          });
          return tx.slotLock.create({
            data: {
              vendorId: vendor.id,
              date: this.toBookingDate(startTime),
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
              expiresAt: new Date(
                Date.now() + this.vendorBookingPaymentExpiryMs,
              ),
            },
          });
        },
      );
      slotLockId = lock.id;

      const { authorizationUrl, reference } =
        await this.paystackService.initializeTransaction(
          dto.clientEmail,
          calculatedAmount,
          {
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
            slotLockId,
            vendorUserId: vendorUser?.id,
            userId: vendorUser?.id,
          },
        );

      await this.prisma.transaction.create({
        data: {
          vendorId: vendor.id,
          amount,
          providerRef: reference,
          status: 'PENDING',
        },
      });

      return successResponse(
        {
          authorizationUrl,
          reference,
        },
        'Successful',
        201,
      );
    } catch (error: any) {
      if (slotLockId) {
        await this.prisma.slotLock
          .deleteMany({ where: { id: slotLockId } })
          .catch(() => undefined);
      }
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to initialize payment',
        error.message as string,
      );
    }
  }

  async createVendorBooking(userId: string, dto: CreateVendorBookingDto) {
    try {
      const vendor = await this.prisma.vendor.findFirst({
        where: { userId },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }

      // Vendor-level override (if any) takes precedence over the global
      // manualBookingEnabled setting for this vendor.
      const isManualBookingEnabled =
        await this.platformSettingsService.isManualBookingEnabled(vendor.id);

      if (!isManualBookingEnabled) {
        throw new ForbiddenException(
          'Vendor-created bookings are currently disabled.',
        );
      }

      const startTime = this.parseDateInput(dto.startTime, 'startTime');

      const service = await this.prisma.service.findFirst({
        where: { id: dto.serviceId },
      });

      if (!service) {
        throw new NotFoundException('Service not found');
      }

      const endTime = dto.endTime
        ? this.parseDateInput(dto.endTime, 'endTime')
        : new Date(startTime.getTime() + (service.durationMins || 60) * 60000);

      if (endTime <= startTime) {
        throw new BadRequestException('endTime must be later than startTime');
      }

      if (startTime < new Date()) {
        throw new BadRequestException('Cannot book a past date or time');
      }

      if (service.userId !== userId) {
        throw new ForbiddenException(
          'You can only create bookings for your own services',
        );
      }

      const bookingDate = this.toBookingDate(startTime);
      const dayOfWeek = startTime.getDay();

      const availability = await this.prisma.vendorAvailability.findUnique({
        where: {
          vendorId_dayOfWeek: { vendorId: vendor.id, dayOfWeek },
        },
      });

      if (!availability) {
        throw new BadRequestException('Vendor is not available on this day');
      }

      const windowStart = new Date(
        `${startTime.toDateString()} ${availability.startTime}`,
      );
      const windowEnd = new Date(
        `${startTime.toDateString()} ${availability.endTime}`,
      );

      if (startTime < windowStart || endTime > windowEnd) {
        throw new BadRequestException(
          'Requested time is outside vendor availability hours',
        );
      }

      const amount = service.price;

      const existingClient = await this.prisma.user.findFirst({
        where: { email: dto.clientEmail },
      });

      if (dto.paymentOption === 'PAID_BY_HAND') {
        const canUsePaidByHand =
          await this.platformSettingsService.canUsePaidByHand(vendor.id);

        if (!canUsePaidByHand) {
          throw new ForbiddenException(
            'An active Jubly subscription is required to record externally paid bookings.',
          );
        }

        const booking = await withVendorScheduleLock(
          this.prisma,
          vendor.id,
          async (tx) => {
            await assertBookingSlotAvailable(tx, {
              vendorId: vendor.id,
              start: startTime,
              end: endTime,
            });
            return tx.booking.create({
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
          },
        );

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

        this.sendVendorCreatedBookingEmails(
          userId,
          vendor,
          service,
          booking,
          dto,
        ).catch((err: any) =>
          console.error('Vendor-created booking email failed:', err?.message),
        );

        return { booking };
      }

      // PAY_BY_LINK
      const booking = await withVendorScheduleLock(
        this.prisma,
        vendor.id,
        async (tx) => {
          await assertBookingSlotAvailable(tx, {
            vendorId: vendor.id,
            start: startTime,
            end: endTime,
          });
          return tx.booking.create({
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
              paymentExpiresAt: new Date(
                Date.now() + this.vendorBookingPaymentExpiryMs,
              ),
            },
          });
        },
      );

      const percentageFee =
        await this.platformSettingsService.resolvePlatformPercentage(vendor.id);

      const vendorUser = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      const pastackAmount = addPaystackFee(amount);

      const calculatedAmount = pastackAmount.totalAmount;

      const { authorizationUrl, reference } =
        await this.paystackService.initializeTransaction(
          dto.clientEmail,
          calculatedAmount,
          {
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
          },
        );

      await this.prisma.booking.update({
        where: { id: booking.id },
        data: {
          paymentUrl: authorizationUrl,
        },
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

  async confirmVendorBookingPayment(bookingId: string, reference: string) {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    return withVendorScheduleLock(this.prisma, booking.vendorId, async (tx) => {
      const current = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      if (current.paymentVerification === 'PAYSTACK_VERIFIED') return current;

      const expiredReservation =
        current.status === 'CANCELLED' &&
        current.paymentVerification === 'UNVERIFIED' &&
        current.paymentExpiresAt &&
        current.paymentExpiresAt <= new Date();
      if (current.status !== 'PENDING' && !expiredReservation) {
        throw new ConflictException('This booking can no longer be confirmed');
      }
      await assertBookingSlotAvailable(tx, {
        vendorId: current.vendorId,
        start: current.startTime,
        end: current.endTime,
        excludeBookingId: current.id,
      });
      const updated = await tx.booking.update({
        where: { id: current.id },
        data: {
          status: 'CONFIRMED',
          paymentVerification: 'PAYSTACK_VERIFIED',
          paymentExpiresAt: null,
          paymentUrl: null,
        },
      });
      await tx.transaction.update({
        where: { providerRef: reference },
        data: { bookingId: current.id },
      });
      return updated;
    });
  }

  private async sendVendorCreatedBookingEmails(
    userId: string,
    vendor: {
      id: string;
      businessName: string;
      city: string;
      state: string;
      country: string | null;
    },
    service: { name: string; durationMins: number | null },
    booking: { startTime: Date; endTime: Date },
    dto: CreateVendorBookingDto,
  ) {
    const vendorUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!vendorUser?.email) {
      return;
    }

    const dateLabel = dateConverter(booking.startTime);
    const timeLabel = timeConverter(booking.startTime);
    const endTimeLabel = timeConverter(booking.endTime);

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
            in: ['COMPLETED'],
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
            in: ['COMPLETED'],
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
            in: ['COMPLETED'],
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
      const pageNum = Number(page);
      const limitNum = Number(limit);
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
              userId: true,
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
              id: true,
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

  private async loadBookingForCompletion(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        services: true,
        vendor: { include: { user: true } },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  private signCompletionToken(bookingId: string): string {
    return this.jwtService.sign(
      { purpose: this.completionTokenPurpose, bookingId },
      { expiresIn: this.completionTokenTtl },
    );
  }

  private verifyCompletionToken(token: string): { bookingId: string } {
    try {
      const payload = this.jwtService.verify<{
        purpose: string;
        bookingId: string;
      }>(token);

      if (
        payload.purpose !== this.completionTokenPurpose ||
        !payload.bookingId
      ) {
        throw new BadRequestException('This approval link is invalid.');
      }

      return { bookingId: payload.bookingId };
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        'This approval link is invalid or has expired.',
      );
    }
  }

  private async settleBookingPayment(booking: any) {
    const existingSettlement = await this.prisma.settlement.findFirst({
      where: {
        bookingId: booking.id,
      },
    });

    if (existingSettlement) {
      if (
        existingSettlement.status !== 'SUCCESS' &&
        (['FAILED', 'REVERSED'].includes(existingSettlement.status) ||
          !existingSettlement.transferCode)
      ) {
        throw new ConflictException('Settlement is awaiting reconciliation');
      }

      if (existingSettlement.status === 'SUCCESS') {
        await this.prisma.transaction.updateMany({
          where: { bookingId: booking.id, status: 'PENDING' },
          data: { status: 'COMPLETED' },
        });
      }

      const transaction = await this.prisma.transaction.findFirst({
        where: { bookingId: booking.id },
        orderBy: { createdAt: 'desc' },
      });

      return { transaction, settlement: existingSettlement };
    }

    // PAID_BY_HAND bookings never touched Paystack — the vendor already
    // holds the money directly, so there is nothing to transfer/settle.
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
      throw new BadRequestException(
        'No pending payment found for this booking',
      );
    }

    if (!booking.vendor.bankAccountNumber || !booking.vendor.bankCode) {
      throw new BadRequestException('Vendor has no settlement bank account');
    }

    const percentageFee = transaction.percentageFee ?? 0;
    const transactionAmount = transaction.amount ?? 0;

    const jublyFee = calculateJublyCommission(transactionAmount, percentageFee);

    const vendorAmount = Math.round((transactionAmount - jublyFee) * 100) / 100;

    const recipient = await this.paystackService.createTransferRecipient({
      name: booking.vendor.businessName,
      accountNumber: booking.vendor.bankAccountNumber,
      bankCode: booking.vendor.bankCode,
    });

    const reference = randomUUID();
    const settlement = await this.prisma
      .$transaction(async (tx) => {
        // Write the booking in the same transaction as the unique settlement
        // claim, so a concurrent rejection cannot invalidate this snapshot.
        const claimed = await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: booking.status,
            updatedAt: booking.updatedAt,
          },
          data: {
            updatedAt: new Date(
              Math.max(Date.now(), booking.updatedAt.getTime() + 1),
            ),
          },
        });
        if (!claimed.count) {
          throw new ConflictException('Booking changed; please try again');
        }

        return tx.settlement.create({
          data: {
            bookingId: booking.id,
            amount: vendorAmount,
            recipientCode: recipient.recipient_code,
            reference,
            status: 'PENDING',
          },
        });
      })
      .catch((error) => {
        if (error.code === 'P2002' || error.code === 'P2034') {
          throw new ConflictException('Settlement is already being processed');
        }
        throw error;
      });

    // On a timeout keep the claim: reconciliation verifies this saved
    // reference before retrying; it must not create a second payment.
    const transfer = await this.paystackService.initiateTransfer({
      amount: vendorAmount,
      recipientCode: recipient.recipient_code,
      reason: `Settlement for booking ${booking.id}`,
      reference,
    });

    await this.prisma.settlement.updateMany({
      where: {
        id: settlement.id,
        reference,
        status: 'PENDING',
        updatedAt: settlement.updatedAt,
      },
      data: {
        transferCode: transfer.transfer_code,
        status: transfer.status?.toUpperCase() || 'PENDING',
      },
    });

    const currentSettlement = await this.prisma.settlement.findUniqueOrThrow({
      where: { id: settlement.id },
    });
    if (['FAILED', 'REVERSED'].includes(currentSettlement.status)) {
      throw new ConflictException('Settlement is awaiting reconciliation');
    }

    await this.prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: 'COMPLETED' },
    });

    return { transaction, settlement: currentSettlement };
  }

  private async completeBookingNow(booking: any, user: any) {
    const { transaction, settlement } =
      await this.settleBookingPayment(booking);
    const payoutAmount = settlement?.amount ?? transaction?.amount;

    const updatedBooking = await this.prisma.booking.update({
      where: {
        id: booking.id,
        status: booking.status,
        ...(settlement ? {} : { updatedAt: booking.updatedAt }),
      },
      data: { status: 'COMPLETED' },
    });

    await this.activityService.createLog({
      vendorId: booking.vendorId,
      userId: user.id,
      action:
        settlement?.status === 'SUCCESS'
          ? 'SETTLEMENT_PAID'
          : 'SETTLEMENT_PROCESSING',

      description:
        settlement?.status === 'SUCCESS'
          ? `Settlement of ₦${payoutAmount?.toLocaleString() ?? '0'} paid successfully.`
          : `Settlement of ₦${payoutAmount?.toLocaleString() ?? '0'} is being processed.`,
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

    return successResponse(
      updatedBooking,
      'Booking marked as completed successfully',
    );
  }

  async completeUnansweredRequest(bookingId: string, cutoff: Date) {
    const booking = await this.loadBookingForCompletion(bookingId);

    if (
      booking.status !== BookingStatus.COMPLETION_PENDING_APPROVAL ||
      !booking.completionRequestedAt ||
      booking.completionRequestedAt > cutoff ||
      booking.completionApprovedAt ||
      (booking.completionRejectedAt &&
        booking.completionRejectedAt >= booking.completionRequestedAt)
    ) {
      return;
    }

    // Leave failed transfers to the existing settlement retry job.
    const failedSettlement = await this.prisma.settlement.findFirst({
      where: { bookingId, status: { in: ['FAILED', 'REVERSED'] } },
    });
    if (failedSettlement) return;

    return this.completeBookingNow(booking, { id: booking.vendor.userId });
  }

  private async requestCompletionApproval(booking: any, user: any) {
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

    return successResponse(
      updatedBooking,
      'Completion request sent to client for approval',
    );
  }

  async markAsCompleted(bookingId: string, userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const booking = await this.loadBookingForCompletion(bookingId);

      if (booking.status !== BookingStatus.CONFIRMED) {
        throw new BadRequestException(
          'Only confirmed bookings can be marked as completed',
        );
      }

      const isClient =
        user.role === UserRole.CLIENT && booking.clientEmail === user.email;
      const isVendor =
        user.role === UserRole.VENDOR && booking.vendor.userId === user.id;

      if (isClient) {
        return await this.completeBookingNow(booking, user);
      }

      if (isVendor) {
        return await this.requestCompletionApproval(booking, user);
      }

      throw new ForbiddenException(
        'Not allowed to mark this booking as completed',
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

  async approveCompletion(token: string) {
    try {
      const { bookingId } = this.verifyCompletionToken(token);
      const booking = await this.loadBookingForCompletion(bookingId);

      if (booking.status === BookingStatus.COMPLETED) {
        return successResponse(
          booking,
          'This booking has already been completed.',
        );
      }

      if (booking.status !== BookingStatus.COMPLETION_PENDING_APPROVAL) {
        return successResponse(
          booking,
          'This completion request is no longer pending.',
        );
      }

      const { transaction, settlement } =
        await this.settleBookingPayment(booking);
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

      return successResponse(
        updatedBooking,
        'Booking completion approved and payment released',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to approve booking completion.',
        error.message as string,
      );
    }
  }

  async rejectCompletion(token: string, reason?: string) {
    try {
      const { bookingId } = this.verifyCompletionToken(token);
      const booking = await this.loadBookingForCompletion(bookingId);

      if (booking.status === BookingStatus.COMPLETED) {
        return successResponse(
          booking,
          'This booking has already been completed.',
        );
      }

      if (booking.status !== BookingStatus.COMPLETION_PENDING_APPROVAL) {
        return successResponse(
          booking,
          'This completion request is no longer pending.',
        );
      }

      const updatedBooking = await this.prisma
        .$transaction(async (tx) => {
          const settlement = await tx.settlement.findFirst({
            where: { bookingId: booking.id },
          });
          if (settlement) {
            throw new ConflictException(
              'Payment settlement has already started',
            );
          }

          const rejected = await tx.booking.updateMany({
            where: {
              id: booking.id,
              status: BookingStatus.COMPLETION_PENDING_APPROVAL,
              updatedAt: booking.updatedAt,
            },
            data: {
              status: 'CONFIRMED',
              completionRejectedAt: new Date(),
              completionRejectionReason: reason,
            },
          });
          if (!rejected.count) {
            throw new ConflictException('Booking changed; please try again');
          }
          return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
        })
        .catch((error) => {
          if (error.code === 'P2034') {
            throw new ConflictException('Booking changed; please try again');
          }
          throw error;
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

      return successResponse(updatedBooking, 'Completion request rejected');
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to reject booking completion.',
        error.message as string,
      );
    }
  }

  async getCompletionReview(token: string) {
    try {
      const { bookingId } = this.verifyCompletionToken(token);
      const booking = await this.loadBookingForCompletion(bookingId);

      return successResponse(
        {
          bookingId: booking.id,
          status: booking.status,
          serviceName: booking.services.name,
          vendorName: booking.vendor.businessName,
          clientName: booking.clientName,
          date: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
          canAct: booking.status === BookingStatus.COMPLETION_PENDING_APPROVAL,
        },
        'Completion review details fetched',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch completion review details.',
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

    const [
      all,
      pending,
      confirmed,
      completed,
      cancelled,
      cancelled_by_client,
      cancelled_by_vendor,
    ] = await Promise.all([
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

      this.prisma.booking.count({
        where: {
          status: BookingStatus.CANCELLED_BY_CLIENT,
          vendorId: vendor.id,
        },
      }),

      this.prisma.booking.count({
        where: {
          status: BookingStatus.CANCELLED_BY_VENDOR,
          vendorId: vendor.id,
        },
      }),
    ]);

    return successResponse(
      {
        all,
        pending,
        confirmed,
        completed,
        cancelled,
        cancelled_by_client,
        cancelled_by_vendor,
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
