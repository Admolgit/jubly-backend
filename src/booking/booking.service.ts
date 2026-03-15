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

      const vendor = await this.prisma.vendor.findFirst({
        where: {
          userId,
        },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }

      await this.googleCalendarService.verifyBooking(dto);

      const booking = await this.prisma.booking.create({
        data: {
          vendorId: vendor.id,
          serviceId: dto.serviceId,
          date: dto.date,
          clientEmail: dto.clientEmail,
          startTime: dto.startTime,
          endTime: dto.endTime,
        },
      });

      const calendarIntegration = await this.prisma.vendorCalendar.findFirst({
        where: {
          vendorId: vendor.id,
          provider: 'google',
        },
      });

      if (calendarIntegration) {
        await this.googleCalendarService.createCalendarEvent(
          calendarIntegration.accessToken,
          {
            title: 'New Jubl Booking',
            description: 'Booking created via Jubl',
            startTime: dto.startTime,
            endTime: dto.endTime,
            attendeeEmail: dto.clientEmail,
          },
        );
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
          email: dto.email,
        },
      });

      if (!client) {
        await this.authService.registerClient({
          clientName: dto.clientName,
          email: dto.clientEmail,
          phone: dto.clientEmail,
        });
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
            vendorId: services.vendorId,
            clientId: client?.id,
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
}
