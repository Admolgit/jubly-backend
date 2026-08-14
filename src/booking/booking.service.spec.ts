import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { GoogleCalendarService } from 'src/google/google.service';
import { AuthService } from 'src/auth/auth.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { PaystackService } from 'src/paystack/paystack.service';
import { ActivityService } from 'src/activity/activityLog.service';
import { JwtService } from '@nestjs/jwt';
import { BookingService } from './booking.service';

const CLIENT_USER_ID = 'client-1';
const VENDOR_USER_ID = 'vendor-user-1';
const BOOKING_ID = 'booking-1';

function buildBookingRow(overrides: Partial<any> = {}): any {
  return {
    id: BOOKING_ID,
    vendorId: 'vendor-doc-1',
    clientId: CLIENT_USER_ID,
    clientEmail: 'client@example.com',
    clientName: 'Jane Client',
    status: 'CONFIRMED',
    completionRequestedBy: null,
    completionRequestedAt: null,
    completionApprovedAt: null,
    completionRejectedAt: null,
    completionRejectionReason: null,
    services: { id: 'service-1', name: 'Bridal Makeup', price: 20000 },
    vendor: {
      id: 'vendor-doc-1',
      userId: VENDOR_USER_ID,
      businessName: 'Glow Studio',
      bankAccountNumber: '0123456789',
      bankCode: '058',
      user: { id: VENDOR_USER_ID, email: 'vendor@example.com' },
    },
    ...overrides,
  };
}

describe('BookingService completion flow', () => {
  let service: BookingService;
  let prisma: {
    user: { findUnique: jest.Mock };
    booking: { findUnique: jest.Mock; update: jest.Mock };
    settlement: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    transaction: { findFirst: jest.Mock; update: jest.Mock };
  };
  let activityService: { createLog: jest.Mock };
  let nodemailerService: {
    bookingCompletedMail: jest.Mock;
    bookingCompletionRequestMail: jest.Mock;
    bookingCompletionRejectedMail: jest.Mock;
  };
  let paystackService: {
    createTransferRecipient: jest.Mock;
    initiateTransfer: jest.Mock;
  };
  let jwtService: { sign: jest.Mock; verify: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      booking: { findUnique: jest.fn(), update: jest.fn() },
      settlement: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      transaction: { findFirst: jest.fn(), update: jest.fn() },
    };
    activityService = { createLog: jest.fn().mockResolvedValue({}) };
    nodemailerService = {
      bookingCompletedMail: jest.fn().mockResolvedValue(undefined),
      bookingCompletionRequestMail: jest.fn().mockResolvedValue(undefined),
      bookingCompletionRejectedMail: jest.fn().mockResolvedValue(undefined),
    };
    paystackService = {
      createTransferRecipient: jest
        .fn()
        .mockResolvedValue({ recipient_code: 'rec_1' }),
      initiateTransfer: jest
        .fn()
        .mockResolvedValue({ transfer_code: 'trf_1', status: 'success' }),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn().mockReturnValue({
        purpose: 'booking-completion-approval',
        bookingId: BOOKING_ID,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: PrismaService, useValue: prisma },
        { provide: GoogleCalendarService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: NodemailerService, useValue: nodemailerService },
        { provide: PaystackService, useValue: paystackService },
        { provide: ActivityService, useValue: activityService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(BookingService);

    prisma.settlement.create.mockResolvedValue({ id: 'settlement-1' });
    prisma.settlement.update.mockResolvedValue({});
    prisma.transaction.update.mockResolvedValue({});
    prisma.booking.update.mockImplementation((args: any) =>
      Promise.resolve(buildBookingRow(args.data)),
    );
  });

  describe('markAsCompleted — client', () => {
    it('settles payment immediately when the client marks the booking complete', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: CLIENT_USER_ID,
        email: 'client@example.com',
        role: UserRole.CLIENT,
      });
      prisma.booking.findUnique.mockResolvedValue(buildBookingRow());
      prisma.settlement.findFirst.mockResolvedValue(null);
      prisma.transaction.findFirst.mockResolvedValue({
        id: 'txn-1',
        amount: 20000,
      });

      await service.markAsCompleted(BOOKING_ID, CLIENT_USER_ID);

      expect(paystackService.createTransferRecipient).toHaveBeenCalled();
      expect(paystackService.initiateTransfer).toHaveBeenCalled();
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'COMPLETED' } }),
      );
      expect(nodemailerService.bookingCompletedMail).toHaveBeenCalledTimes(2);
    });
  });

  describe('markAsCompleted — vendor', () => {
    it('requests client approval instead of transferring immediately', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: VENDOR_USER_ID,
        email: 'vendor@example.com',
        role: UserRole.VENDOR,
      });
      prisma.booking.findUnique.mockResolvedValue(buildBookingRow());

      await service.markAsCompleted(BOOKING_ID, VENDOR_USER_ID);

      expect(paystackService.initiateTransfer).not.toHaveBeenCalled();
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'COMPLETION_PENDING_APPROVAL',
            completionRequestedBy: VENDOR_USER_ID,
          }),
        }),
      );
      expect(
        nodemailerService.bookingCompletionRequestMail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewUrl: expect.stringContaining('signed-token'),
        }),
      );
    });
  });

  describe('approveCompletion', () => {
    it('settles payment and completes the booking for a valid pending-approval token', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        buildBookingRow({ status: 'COMPLETION_PENDING_APPROVAL' }),
      );
      prisma.settlement.findFirst.mockResolvedValue(null);
      prisma.transaction.findFirst.mockResolvedValue({
        id: 'txn-1',
        amount: 20000,
      });

      await service.approveCompletion('valid-token');

      expect(paystackService.initiateTransfer).toHaveBeenCalled();
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('is idempotent when the booking is already completed', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        buildBookingRow({ status: 'COMPLETED' }),
      );

      const result = await service.approveCompletion('valid-token');

      expect(paystackService.initiateTransfer).not.toHaveBeenCalled();
      expect(result.message).toContain('already been completed');
    });

    it('rejects an invalid or expired token', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.approveCompletion('bad-token')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.booking.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a token signed for a different purpose', async () => {
      jwtService.verify.mockReturnValue({
        purpose: 'password-reset',
        bookingId: BOOKING_ID,
      });

      await expect(service.approveCompletion('wrong-purpose')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('logs the real settlement amount even on a retry after settlement already exists (bug regression)', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        buildBookingRow({ status: 'COMPLETION_PENDING_APPROVAL' }),
      );
      prisma.settlement.findFirst.mockResolvedValue({
        id: 'settlement-1',
        status: 'SUCCESS',
      });
      prisma.transaction.findFirst.mockResolvedValue({
        id: 'txn-1',
        amount: 20000,
      });

      await service.approveCompletion('valid-token');

      expect(paystackService.initiateTransfer).not.toHaveBeenCalled();
      expect(activityService.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('₦20,000'),
        }),
      );
    });
  });

  describe('rejectCompletion', () => {
    it('reverts the booking to CONFIRMED and notifies the vendor, without touching payment', async () => {
      prisma.booking.findUnique.mockResolvedValue(
        buildBookingRow({ status: 'COMPLETION_PENDING_APPROVAL' }),
      );

      await service.rejectCompletion('valid-token', 'Work not finished');

      expect(paystackService.initiateTransfer).not.toHaveBeenCalled();
      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CONFIRMED',
            completionRejectionReason: 'Work not finished',
          }),
        }),
      );
      expect(
        nodemailerService.bookingCompletionRejectedMail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'Work not finished' }),
      );
    });
  });
});
