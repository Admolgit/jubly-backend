import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';

// MongoDB transactions alone do not prevent two inserts after an empty range
// query. Both operations must first write the same vendor document.
export async function withVendorScheduleLock<T>(
  prisma: PrismaService,
  vendorId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
        if (!vendor) throw new NotFoundException('Vendor not found');
        await tx.vendor.update({
          where: { id: vendorId },
          data: {
            updatedAt: new Date(
              Math.max(Date.now(), vendor.updatedAt.getTime() + 1),
            ),
          },
        });
        return operation(tx);
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2034'
      ) {
        throw error;
      }
      if (attempt === 2) {
        throw new ConflictException('Availability changed; please try again');
      }
    }
  }
  throw new ConflictException('Availability changed; please try again');
}

export async function assertBookingSlotAvailable(
  tx: Prisma.TransactionClient,
  slot: {
    vendorId: string;
    start: Date;
    end: Date;
    excludeBookingId?: string;
    excludeSlotLockId?: string;
  },
) {
  const settings = await tx.vendorBookingSettings.findUnique({
    where: { vendorId: slot.vendorId },
  });
  const bufferMs = Math.max(0, settings?.bufferTime ?? 0) * 60000;
  const start = new Date(slot.start.getTime() - bufferMs);
  const end = new Date(slot.end.getTime() + bufferMs);
  const now = new Date();

  const conflict = await tx.booking.findFirst({
    where: {
      vendorId: slot.vendorId,
      ...(slot.excludeBookingId ? { id: { not: slot.excludeBookingId } } : {}),
      status: {
        notIn: ['CANCELLED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_VENDOR'],
      },
      startTime: { lt: end },
      endTime: { gt: start },
      OR: [
        { status: { not: 'PENDING' } },
        { paymentExpiresAt: null },
        { paymentExpiresAt: { isSet: false } },
        { paymentExpiresAt: { gt: now } },
      ],
    },
    select: { id: true },
  });
  if (conflict) throw new ConflictException('This time slot is already booked');

  // Checkout locks store full UTC ISO timestamps, so ranges also span midnight.
  const held = await tx.slotLock.findFirst({
    where: {
      vendorId: slot.vendorId,
      expiresAt: { gt: now },
      ...(slot.excludeSlotLockId
        ? { id: { not: slot.excludeSlotLockId } }
        : {}),
      startTime: { lt: end.toISOString() },
      endTime: { gt: start.toISOString() },
    },
    select: { id: true },
  });
  if (held) throw new ConflictException('This time slot is being booked');
}
