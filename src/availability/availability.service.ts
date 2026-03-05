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

  // Get vendor availability
  async getAvailability(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor not found');

      return this.prisma.vendorAvailability.findMany({
        where: { vendorId: vendor.id },
        orderBy: { dayOfWeek: 'asc' },
      });
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch vendor availability',
        error?.message,
      );
    }
  }

  // Get vendor availability by day of the week
  async getAvailabilityGrouped(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor not found');

      const availabilities = await this.prisma.vendorAvailability.findMany({
        where: { vendorId: vendor.id },
        orderBy: { dayOfWeek: 'asc' },
      });

      // Group by dayOfWeek for easy frontend consumption
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
    } catch (error) {
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

      const updatedAvailabilities = await Promise.all(
        dto.availabilities.map((item) =>
          this.prisma.vendorAvailability.upsert({
            where: {
              vendorId: vendor.id,
              dayOfWeek: item.dayOfWeek,
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

      return successResponse(
        { updatedAvailabilities },
        'Availability updated successfully',
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to set vendor availability',
        error?.message,
      );
    }
  }

  // Delete availability for a specific day
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
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to set vendor availability',
        error?.message,
      );
    }
  }
}
