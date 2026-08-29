/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { CronJob } from 'cron';
import { PrismaService } from 'prisma/prisma.service';
import { PaystackService } from './paystack.service';
import { BookingService } from 'src/booking/booking.service';
import { TransactionService } from 'src/transaction/transaction.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { PlatformSettingsService } from 'src/platform-settings/platform-settings.service';
import { ActivityService } from 'src/activity/activityLog.service';
import type { User, Vendor } from '@prisma/client';

const PENDING_TRANSACTION_STALE_AFTER_MS = 20 * 60 * 1000;
const PENDING_TRANSACTION_ABANDON_AFTER_MS = 48 * 60 * 60 * 1000;
const SETTLEMENT_RETRY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 25;

@Injectable()
export class PaystackReconciliationService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackService: PaystackService,
    private readonly bookingService: BookingService,
    private readonly transactionsService: TransactionService,
    private readonly mailService: NodemailerService,
    private readonly platformSettingsService: PlatformSettingsService,
    private readonly activityService: ActivityService,
  ) {}

  onModuleInit() {
    new CronJob(
      '*/10 * * * *',
      () => {
        void this.reconcilePendingTransactions();
      },
      null,
      true,
      'Africa/Lagos',
    );

    new CronJob(
      '*/30 * * * *',
      () => {
        void this.retryFailedSettlements();
      },
      null,
      true,
      'Africa/Lagos',
    );

    new CronJob(
      '*/15 * * * *',
      () => {
        void this.cleanupExpiredSlotLocks();
      },
      null,
      true,
      'Africa/Lagos',
    );

    new CronJob(
      '*/15 * * * *',
      () => {
        void this.expireAbandonedVendorBookingLinks();
      },
      null,
      true,
      'Africa/Lagos',
    );
  }

  async reconcilePendingTransactions() {
    const staleThreshold = new Date(
      Date.now() - PENDING_TRANSACTION_STALE_AFTER_MS,
    );

    const staleTransactions = await this.prisma.transaction.findMany({
      where: {
        bookingId: null,
        createdAt: { lt: staleThreshold },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const transaction of staleTransactions) {
      try {
        const verification = await this.paystackService.verifyTransaction(
          transaction.providerRef,
        );
        const chargeData = verification.data;
        const chargeStatus = String(chargeData?.status || '').toLowerCase();

        if (chargeStatus === 'success') {
          await this.finalizeSuccessfulCharge(chargeData);
          continue;
        }

        const isDefinitivelyDead = ['failed', 'abandoned', 'reversed'].includes(
          chargeStatus,
        );
        const isTooOldToKeepWaiting =
          Date.now() - transaction.createdAt.getTime() >
          PENDING_TRANSACTION_ABANDON_AFTER_MS;

        if (isDefinitivelyDead || isTooOldToKeepWaiting) {
          await this.prisma.transaction.update({
            where: { id: transaction.id },
            data: { status: 'FAILED' },
          });
        }
      } catch (error) {
        console.error(
          `[PaystackReconciliation] Failed to reconcile transaction ${transaction.providerRef}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  private async finalizeSuccessfulCharge(chargeData: any) {
    const existing = await this.prisma.transaction.findUnique({
      where: { providerRef: chargeData.reference },
    });

    if (!existing || existing.bookingId) {
      return;
    }

    if (chargeData.metadata?.type === 'VENDOR_CREATED_BOOKING_LINK') {
      return this.finalizeVendorCreatedBookingLinkCharge(chargeData);
    }

    const {
      slug,
      vendorId,
      clientId,
      serviceId,
      title,
      email,
      userId,
      dayOfWeek,
      startTime,
      endTime,
      clientName,
      clientAddress,
      durationMins,
      businessName,
      vendorEmail,
      city,
      state,
      country,
      vendorUserId,
      phone,
    } = chargeData.metadata ?? {};

    if (
      !vendorId ||
      !vendorUserId ||
      !serviceId ||
      !clientId ||
      !email ||
      !dayOfWeek ||
      !startTime ||
      !endTime
    ) {
      console.error(
        `[PaystackReconciliation] Incomplete metadata for transaction ${chargeData.reference}, cannot recover booking automatically`,
      );
      return;
    }

    const auth = chargeData.authorization;
    const bank = auth?.bank || null;
    const accountName = auth?.account_name || null;
    const accountNumber = auth?.account_number || null;
    const paymentChannel = chargeData.channel || auth?.channel || 'unknown';

    const book = await this.bookingService.createBooking(vendorUserId, {
      userId: vendorUserId,
      clientId,
      serviceId,
      date: dayOfWeek,
      clientName,
      clientAddress,
      clientEmail: email,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      status: 'CONFIRMED',
    } as any);

    await this.prisma.transaction.update({
      where: { providerRef: chargeData.reference },
      data: { bookingId: book.id },
    });

    const senderDetails = await this.prisma.senderDetails.create({
      data: {
        vendorId,
        email,
        senderName: accountName ?? clientName,
        senderAccountNumber: accountNumber,
        senderBankName: bank,
        senderDescription: 'Payment via Paystack (reconciled)',
      },
    });

    const percentageFee =
      await this.platformSettingsService.resolvePlatformPercentage(vendorId);

    await this.transactionsService.updateTransaction(userId, {
      amount: chargeData.amount,
      senderDetailsId: senderDetails.id,
      status: 'PENDING',
      providerRef: chargeData.reference,
      paidAt: chargeData.paid_at,
      percentageFee,
      bookingId: book.id,
      vendorId,
      slug,
      title,
      paymentMethod: paymentChannel,
      description: 'Payment via Paystack (reconciled)',
    });

    let vendorUserRecord: User | null = null;
    try {
      vendorUserRecord = await this.prisma.user.findUnique({
        where: { id: vendorUserId },
      });
    } catch (err) {
      console.error(
        '[PaystackReconciliation] Failed to load vendor for receipt emails:',
        err,
      );
    }

    try {
      await this.mailService.sendClientBookingMail({
        clientEmail: email,
        serviceName: title,
        date: dayOfWeek,
        time: startTime,
        endTime,
        clientName,
        durationMins,
        businessName,
        address: `${city} ${state} ${country}`,
      });
    } catch (err) {
      console.error(
        '[PaystackReconciliation] sendClientBookingMail failed:',
        err,
      );
    }

    try {
      await this.mailService.sendVendorBookingMail({
        vendorEmail,
        clientName,
        clientEmail: email,
        serviceName: title,
        date: dayOfWeek,
        time: startTime,
        endTime,
        durationMins,
        phone,
      });
    } catch (err) {
      console.error(
        '[PaystackReconciliation] sendVendorBookingMail failed:',
        err,
      );
    }

    try {
      await this.mailService.sendClientReceiptMail({
        clientEmail: email,
        bookingName: book.name,
        vendorName: businessName,
        vendorAddress: `${city} ${state} ${country ?? ''}`.trim(),
        vendorPhone: vendorUserRecord?.phone ?? undefined,
        serviceName: title,
        date: dayOfWeek,
        startTime,
        endTime,
        transactionRef: chargeData.reference,
      });
    } catch (err) {
      console.error(
        '[PaystackReconciliation] sendClientReceiptMail failed:',
        err,
      );
    }

    if (vendorEmail) {
      try {
        await this.mailService.sendVendorReceiptMail({
          vendorEmail,
          bookingName: book.name,
          clientName,
          clientAddress,
          clientPhone: phone,
          serviceName: title,
          date: dayOfWeek,
          startTime,
          endTime,
          transactionRef: chargeData.reference,
        });
      } catch (err) {
        console.error(
          '[PaystackReconciliation] sendVendorReceiptMail failed:',
          err,
        );
      }
    }
  }

  // Fallback path for vendor-created PAY_BY_LINK bookings whose payment
  // succeeded but whose live webhook delivery never arrived/processed.
  // Unlike the marketplace flow above, the booking already exists (created
  // up front to reserve the slot) — so this updates it in place rather than
  // creating a new one, mirroring exactly what paystackWebhook's
  // VENDOR_CREATED_BOOKING_LINK branch does.
  private async finalizeVendorCreatedBookingLinkCharge(chargeData: any) {
    const { bookingId, percentageFee, clientName, clientEmail, title } =
      chargeData.metadata ?? {};

    if (!bookingId) {
      console.error(
        `[PaystackReconciliation] Incomplete vendor-created-link metadata for transaction ${chargeData.reference}`,
      );
      return;
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      console.error(
        `[PaystackReconciliation] Vendor-created booking ${bookingId} not found for transaction ${chargeData.reference}`,
      );
      return;
    }

    if (booking.paymentVerification === 'PAYSTACK_VERIFIED') {
      // Already confirmed — most likely the live webhook won the race.
      return;
    }

    const auth = chargeData.authorization;
    const bank = auth?.bank || null;
    const accountName = auth?.account_name || null;
    const accountNumber = auth?.account_number || null;
    const paymentChannel = chargeData.channel || auth?.channel || 'unknown';

    const updatedBooking = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CONFIRMED',
        paymentVerification: 'PAYSTACK_VERIFIED',
        paymentExpiresAt: null,
      },
    });

    const senderDetails = await this.prisma.senderDetails.create({
      data: {
        vendorId: booking.vendorId,
        email: clientEmail,
        senderName: accountName ?? clientName,
        senderAccountNumber: accountNumber,
        senderBankName: bank,
        senderDescription: 'Payment via Paystack (vendor-created link, reconciled)',
      },
    });

    await this.prisma.transaction.update({
      where: { providerRef: chargeData.reference },
      data: {
        bookingId: updatedBooking.id,
        // Stays 'PENDING' — see the identical comment in paystackWebhook;
        // this tracks vendor payout status, not client payment status.
        status: 'PENDING',
        paidAt: new Date(),
        percentageFee: percentageFee ?? 0.05,
        paymentMethod: paymentChannel,
        senderDetailsId: senderDetails.id,
      },
    });

    await this.activityService.createLog({
      vendorId: booking.vendorId,
      action: 'PAYMENT_RECEIVED',
      description: `Payment of ₦${booking.amount?.toLocaleString() ?? ''} received for booking #${booking.id} (reconciled).`,
      actor: 'System',
      actorType: 'SYSTEM',
      color: 'yellow',
    });

    let bookingVendor: Vendor | null = null;
    let vendorUser: User | null = null;
    try {
      bookingVendor = await this.prisma.vendor.findUnique({
        where: { id: booking.vendorId },
      });
      vendorUser = bookingVendor
        ? await this.prisma.user.findUnique({
            where: { id: bookingVendor.userId },
          })
        : null;
    } catch (err) {
      console.error(
        '[PaystackReconciliation] Failed to load vendor for receipt emails:',
        err,
      );
    }

    try {
      await this.mailService.sendClientBookingMail({
        clientEmail: booking.clientEmail,
        clientName: booking.clientName ?? clientName,
        serviceName: title,
        date: updatedBooking.startTime.toDateString(),
        time: updatedBooking.startTime.toLocaleTimeString(),
        endTime: updatedBooking.endTime.toLocaleTimeString(),
        durationMins: '',
        businessName: '',
        address: '',
      });
    } catch (err) {
      console.error(
        '[PaystackReconciliation] sendClientBookingMail failed:',
        err,
      );
    }

    if (vendorUser?.email) {
      try {
        await this.mailService.sendVendorBookingMail({
          vendorEmail: vendorUser.email,
          clientName: booking.clientName ?? clientName,
          clientEmail: booking.clientEmail,
          serviceName: title,
          date: updatedBooking.startTime.toDateString(),
          time: updatedBooking.startTime.toLocaleTimeString(),
          endTime: updatedBooking.endTime.toLocaleTimeString(),
          phone: booking.clientPhone ?? '',
          durationMins: '',
        });
      } catch (err) {
        console.error(
          '[PaystackReconciliation] sendVendorBookingMail failed:',
          err,
        );
      }

      try {
        await this.mailService.sendVendorReceiptMail({
          vendorEmail: vendorUser.email,
          bookingName: booking.name,
          clientName: booking.clientName ?? clientName,
          clientAddress: booking.clientAddress ?? undefined,
          clientPhone: booking.clientPhone ?? undefined,
          serviceName: title,
          date: updatedBooking.startTime.toDateString(),
          startTime: updatedBooking.startTime.toLocaleTimeString(),
          endTime: updatedBooking.endTime.toLocaleTimeString(),
          transactionRef: chargeData.reference,
        });
      } catch (err) {
        console.error(
          '[PaystackReconciliation] sendVendorReceiptMail failed:',
          err,
        );
      }
    }

    try {
      await this.mailService.sendClientReceiptMail({
        clientEmail: booking.clientEmail,
        bookingName: booking.name,
        vendorName: bookingVendor?.businessName ?? '',
        vendorAddress: bookingVendor
          ? `${bookingVendor.city} ${bookingVendor.state} ${bookingVendor.country ?? ''}`.trim()
          : undefined,
        vendorPhone: vendorUser?.phone ?? undefined,
        serviceName: title,
        date: updatedBooking.startTime.toDateString(),
        startTime: updatedBooking.startTime.toLocaleTimeString(),
        endTime: updatedBooking.endTime.toLocaleTimeString(),
        transactionRef: chargeData.reference,
      });
    } catch (err) {
      console.error(
        '[PaystackReconciliation] sendClientReceiptMail failed:',
        err,
      );
    }
  }

  async retryFailedSettlements() {
    const retryThreshold = new Date(Date.now() - SETTLEMENT_RETRY_MAX_AGE_MS);

    const failedSettlements = await this.prisma.settlement.findMany({
      where: {
        status: 'FAILED',
        createdAt: { gte: retryThreshold },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const settlement of failedSettlements) {
      if (!settlement.recipientCode) {
        continue;
      }

      try {
        const transfer = await this.paystackService.initiateTransfer({
          amount: settlement.amount,
          recipientCode: settlement.recipientCode,
          reason: `Settlement retry for booking ${settlement.bookingId}`,
          reference: `booking-${settlement.bookingId}-retry-${Date.now()}`,
        });

        const transferStatus = transfer.status?.toUpperCase() || 'PENDING';

        await this.prisma.settlement.update({
          where: { id: settlement.id },
          data: {
            transferCode: transfer.transfer_code,
            status: transferStatus,
          },
        });

        if (transferStatus === 'SUCCESS') {
          await this.prisma.transaction.updateMany({
            where: {
              bookingId: settlement.bookingId,
              status: { not: 'COMPLETED' },
            },
            data: { status: 'COMPLETED' },
          });
        }
      } catch (error) {
        console.error(
          `[PaystackReconciliation] Settlement retry failed for settlement ${settlement.id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  async cleanupExpiredSlotLocks() {
    try {
      await this.prisma.slotLock.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
    } catch (error) {
      console.error(
        '[PaystackReconciliation] Failed to clean up expired slot locks:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  async expireAbandonedVendorBookingLinks() {
    try {
      await this.prisma.booking.updateMany({
        where: {
          status: 'PENDING',
          source: 'VENDOR_CREATED',
          paymentMethod: 'PAY_BY_LINK',
          paymentExpiresAt: { lt: new Date() },
        },
        data: {
          status: 'CANCELLED',
          paymentVerification: 'UNVERIFIED',
        },
      });
    } catch (error) {
      console.error(
        '[PaystackReconciliation] Failed to expire abandoned vendor booking links:',
        error instanceof Error ? error.message : error,
      );
    }
  }
}
