import { Injectable } from '@nestjs/common';
import {
  BookingStatus,
  Prisma,
  RescheduleStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';

const bookingWithRelations = Prisma.validator<Prisma.BookingDefaultArgs>()({
  include: {
    services: true,
    vendor: { include: { user: true } },
  },
});

export type BookingWithRelations = Prisma.BookingGetPayload<
  typeof bookingWithRelations
>;

@Injectable()
export class RescheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  findBookingById(bookingId: string): Promise<BookingWithRelations | null> {
    return this.prisma.booking.findUnique({
      where: { id: bookingId },
      ...bookingWithRelations,
    });
  }

  findActiveRescheduleRequest(bookingId: string) {
    return this.prisma.rescheduleRequest.findFirst({
      where: {
        bookingId,
        status: RescheduleStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  createRescheduleRequest(data: {
    bookingId: string;
    initiatedBy: string;
    initiatedByRole: UserRole;
    proposedDate: Date;
    previousProposedDate?: Date;
    reason?: string;
    bookingStatusBeforeRequest: BookingStatus;
  }) {
    return this.prisma.rescheduleRequest.create({ data });
  }

  updateRescheduleRequest(
    id: string,
    data: Prisma.RescheduleRequestUpdateInput,
  ) {
    return this.prisma.rescheduleRequest.update({ where: { id }, data });
  }

  listRescheduleHistory(bookingId: string) {
    return this.prisma.rescheduleRequest.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    });
  }

  updateBooking(bookingId: string, data: Prisma.BookingUpdateInput) {
    return this.prisma.booking.update({ where: { id: bookingId }, data });
  }

  incrementVendorCancellationStrikes(vendorId: string) {
    return this.prisma.vendor.update({
      where: { id: vendorId },
      data: { cancellationStrikes: { increment: 1 } },
    });
  }

  findConflictingBooking(
    vendorId: string,
    excludeBookingId: string,
    start: Date,
    end: Date,
  ) {
    return this.prisma.booking.findFirst({
      where: {
        vendorId,
        id: { not: excludeBookingId },
        AND: [{ startTime: { lt: end } }, { endTime: { gt: start } }],
      },
    });
  }
}
