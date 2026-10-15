import { ConflictException, Injectable } from '@nestjs/common';
import {
  BookingStatus,
  Prisma,
  RescheduleStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import {
  assertBookingSlotAvailable,
  withVendorScheduleLock,
} from 'src/booking/booking-slot.util';

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

  acceptReschedule(
    booking: BookingWithRelations,
    requestId: string,
    schedule: { start: Date; end: Date; date: Date },
    userId: string,
    reason?: string,
  ) {
    return withVendorScheduleLock(this.prisma, booking.vendorId, async (tx) => {
      await assertBookingSlotAvailable(tx, {
        vendorId: booking.vendorId,
        start: schedule.start,
        end: schedule.end,
        excludeBookingId: booking.id,
      });
      const updated = await tx.booking.updateMany({
        where: {
          id: booking.id,
          updatedAt: booking.updatedAt,
          status: BookingStatus.RESCHEDULE_REQUESTED,
        },
        data: {
          startTime: schedule.start,
          endTime: schedule.end,
          date: schedule.date,
          status: BookingStatus.CONFIRMED,
          rescheduleCount: { increment: 1 },
        },
      });
      const accepted = await tx.rescheduleRequest.updateMany({
        where: {
          id: requestId,
          bookingId: booking.id,
          status: RescheduleStatus.PENDING,
        },
        data: {
          status: RescheduleStatus.ACCEPTED,
          respondedBy: userId,
          respondedAt: new Date(),
          responseReason: reason,
        },
      });
      if (!updated.count || !accepted.count) {
        throw new ConflictException(
          'Reschedule request changed; please try again',
        );
      }
      return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
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
