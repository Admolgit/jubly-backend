/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreateVendorAvailabilityDto } from './dto/availability.dto';
import { successResponse } from 'src/utils/response';

@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  generateSlots(start: Date, end: Date, duration: number) {
    const slots: { startTime: Date; endTime: Date }[] = [];
    let current = new Date(start);

    while (current.getTime() + duration * 60000 <= end.getTime()) {
      const slotEnd = new Date(current.getTime() + duration * 60000);

      slots.push({
        startTime: new Date(current),
        endTime: slotEnd,
      });

      current = slotEnd;
    }

    return slots;
  }

  async getAvailability(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor not found');

      return this.prisma.vendorAvailability.findMany({
        where: { vendorId: vendor.id },
        orderBy: { dayOfWeek: 'asc' },
      });
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to fetch vendor availability',
        error?.message,
      );
    }
  }

  isSameDay(a: Date, b: Date) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  isPastDay(date: Date) {
    const today = new Date();

    const d1 = new Date(date);
    d1.setHours(0, 0, 0, 0);

    const d2 = new Date(today);
    d2.setHours(0, 0, 0, 0);

    return d1 < d2;
  }

  async getAvailableSlots(vendorId: string, serviceId: string, date: Date) {
    try {
      const vendor = await this.prisma.vendor.findUnique({
        where: { userId: vendorId },
        include: {
          vendorAvailability: true,
          bookings: true,
        },
      });

      const services = await this.prisma.service.findMany({
        where: {
          id: serviceId,
        },
      });

      const dateObj = new Date(date);

      const dayOfWeek = dateObj.getDay();
      if (!vendor) throw new NotFoundException('Vendor not found');
      const availability = vendor.vendorAvailability.find(
        (a) => a.dayOfWeek === dayOfWeek,
      );

      if (!availability) return [];

      const start = new Date(
        `${dateObj.toDateString()} ${availability.startTime}`,
      );
      const end = new Date(`${dateObj.toDateString()} ${availability.endTime}`);

      let duration = services[0].durationMins || 60;

      const bufferTime = await this.prisma.vendorBookingSettings.findFirst({
        where: { vendorId: vendor.id },
      });

      const bufferMins = bufferTime?.bufferTime || 0;
      duration += bufferMins;

      const slots = this.generateSlots(start, end, duration);

      const bookings = vendor.bookings;

      const now = new Date();

      const isToday = this.isSameDay(dateObj, now);

      if (this.isPastDay(dateObj)) {
        throw new BadRequestException('No slots for past dates');
      }

      const availableSlots = slots.filter((slot) => {
        if (isToday && slot.startTime <= now) {
          return false;
        }
        return !bookings.some(
          (b) =>
            slot.startTime < new Date(b.endTime) &&
            slot.endTime > new Date(b.startTime),
        );
      });

      if (availableSlots.length === 0) {
        throw new NotFoundException('No available slots for this date');
      }

      return successResponse(
        { availableSlots },
        'Available slot fetched successfully.',
      );
    } catch (error: any) {
      console.error({ error });
      throw new InternalServerErrorException(
        'Failed to fetch vendor availabile slot',
        error?.message,
      );
    }
  }

  async getAvailabilityGrouped(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor not found');

      const availabilities = await this.prisma.vendorAvailability.findMany({
        where: { vendorId: vendor.id },
        orderBy: { dayOfWeek: 'asc' },
      });

      const grouped: Record<number, { startTime: string; endTime: string }[]> =
        {};

      availabilities.forEach((a) => {
        if (!grouped[a.dayOfWeek]) grouped[a.dayOfWeek] = [];
        grouped[a.dayOfWeek].push({
          startTime: a.startTime,
          endTime: a.endTime,
        });
      });

      return successResponse({ grouped }, 'Availability fetched successfully');
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to fetch vendor availability',
        error?.message,
      );
    }
  }

  async setAvailability(userId: string, dto: CreateVendorAvailabilityDto) {
    try {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor not found');

      for (const item of dto.availabilities) {
        const [startH, startM] = item.startTime.split(':').map(Number);
        const [endH, endM] = item.endTime.split(':').map(Number);

        if (startH > endH || (startH === endH && startM >= endM)) {
          throw new BadRequestException(
            `startTime (${item.startTime}) must be before endTime (${item.endTime}) for day ${item.dayOfWeek}`,
          );
        }
      }

      const updatedAvailabilities = await this.prisma.$transaction(
        async (tx) => {
          const selectedDays = dto.availabilities.map((item) => item.dayOfWeek);

          await tx.vendorAvailability.deleteMany({
            where: {
              vendorId: vendor.id,
              dayOfWeek: {
                notIn: selectedDays,
              },
            },
          });

          await Promise.all(
            dto.availabilities.map((item) =>
              tx.vendorAvailability.upsert({
                where: {
                  vendorId_dayOfWeek: {
                    vendorId: vendor.id,
                    dayOfWeek: item.dayOfWeek,
                  },
                },
                update: {
                  startTime: item.startTime,
                  endTime: item.endTime,
                },
                create: {
                  vendorId: vendor.id,
                  dayOfWeek: item.dayOfWeek,
                  startTime: item.startTime,
                  endTime: item.endTime,
                },
              }),
            ),
          );
        },
      );

      return successResponse(
        { updatedAvailabilities },
        'Availability updated successfully',
      );
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to set vendor availability',
        error?.message,
      );
    }
  }

  async deleteAvailability(userId: string, dayOfWeek: number) {
    try {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor not found');

      const deleted = await this.prisma.vendorAvailability.deleteMany({
        where: { vendorId: vendor.id, dayOfWeek },
      });

      if (deleted.count === 0) {
        throw new NotFoundException('Availability for this day not found');
      }

      return successResponse({ deleted }, 'Availability deleted successfully');
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to set vendor availability',
        error?.message,
      );
    }
  }

  async updateBufferTime(userId: string, dto: { bufferTime: number }) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const updatedBuffer = await this.prisma.vendorBookingSettings.upsert({
      where: {
        vendorId: vendor.id,
      },

      update: {
        bufferTime: dto.bufferTime,
      },

      create: {
        vendorId: vendor.id,
        bufferTime: dto.bufferTime,
      },
    });

    return successResponse(updatedBuffer, 'Buffer time updated successfully.');
  }

  async getExistingBufferTime(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }
      const existingBuffer = await this.prisma.vendorBookingSettings.findUnique(
        {
          where: {
            vendorId: vendor.id,
          },
          select: {
            bufferTime: true,
          },
        },
      );

      return successResponse(
        existingBuffer,
        'Existing buffer time fetched successfully.',
      );
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to fetch existing buffer time.',
        error.message as string,
      );
    }
  }
}
