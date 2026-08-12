import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, RescheduleStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activityLog.service';
import { GoogleCalendarService } from '../google/google.service';
import { NodemailerService } from '../nodemailer/nodemailer.service';
import { RescheduleService } from './reschedule.service';
import { RescheduleRepository } from './reschedule.repository';
import { RescheduleNotificationService } from './events/reschedule-notification.service';

const CLIENT_USER_ID = 'client-1';
const VENDOR_USER_ID = 'vendor-1';
const BOOKING_ID = 'booking-1';

function buildUser(overrides: Partial<any> = {}): any {
  return {
    id: CLIENT_USER_ID,
    email: 'client@example.com',
    role: UserRole.CLIENT,
    ...overrides,
  };
}

function buildBooking(overrides: Partial<any> = {}): any {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    id: BOOKING_ID,
    vendorId: 'vendor-doc-1',
    clientId: CLIENT_USER_ID,
    clientEmail: 'client@example.com',
    clientName: 'Jane Client',
    googleEventId: null,
    serviceId: 'service-1',
    date: start,
    startTime: start,
    endTime: end,
    status: BookingStatus.CONFIRMED,
    rescheduleCount: 0,
    cancelledBy: null,
    cancelledByRole: null,
    cancelledAt: null,
    cancellationReason: null,
    services: { id: 'service-1', name: 'Bridal Makeup', price: 1000 },
    vendor: {
      id: 'vendor-doc-1',
      userId: VENDOR_USER_ID,
      businessName: 'Glow Studio',
      user: { id: VENDOR_USER_ID, email: 'vendor@example.com' },
    },
    ...overrides,
  };
}

function buildRescheduleRequest(overrides: Partial<any> = {}): any {
  return {
    id: 'rr-1',
    bookingId: BOOKING_ID,
    initiatedBy: CLIENT_USER_ID,
    initiatedByRole: UserRole.CLIENT,
    proposedDate: new Date(Date.now() + 72 * 60 * 60 * 1000),
    previousProposedDate: null,
    reason: null,
    status: RescheduleStatus.PENDING,
    bookingStatusBeforeRequest: BookingStatus.CONFIRMED,
    respondedBy: null,
    respondedAt: null,
    responseReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('RescheduleService', () => {
  let service: RescheduleService;
  let prisma: { user: { findUnique: jest.Mock }; vendorCalendar: { findFirst: jest.Mock } };
  let repository: jest.Mocked<
    Pick<
      RescheduleRepository,
      | 'findBookingById'
      | 'findActiveRescheduleRequest'
      | 'createRescheduleRequest'
      | 'updateRescheduleRequest'
      | 'listRescheduleHistory'
      | 'updateBooking'
      | 'findConflictingBooking'
      | 'incrementVendorCancellationStrikes'
    >
  >;
  let activityService: { createLog: jest.Mock };
  let googleCalendarService: { calendarEnv: jest.Mock };
  let notifications: { emit: jest.Mock };
  let nodemailerService: {
    rescheduleRequestedMail: jest.Mock;
    rescheduleAcceptedMail: jest.Mock;
    rescheduleRejectedMail: jest.Mock;
    rescheduleCounterProposedMail: jest.Mock;
    bookingCancelledMail: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      vendorCalendar: { findFirst: jest.fn() },
    };
    repository = {
      findBookingById: jest.fn(),
      findActiveRescheduleRequest: jest.fn(),
      createRescheduleRequest: jest.fn(),
      updateRescheduleRequest: jest.fn(),
      listRescheduleHistory: jest.fn(),
      updateBooking: jest.fn(),
      findConflictingBooking: jest.fn(),
      incrementVendorCancellationStrikes: jest.fn(),
    } as any;
    activityService = { createLog: jest.fn().mockResolvedValue({}) };
    googleCalendarService = { calendarEnv: jest.fn() };
    notifications = { emit: jest.fn() };
    nodemailerService = {
      rescheduleRequestedMail: jest.fn().mockResolvedValue(undefined),
      rescheduleAcceptedMail: jest.fn().mockResolvedValue(undefined),
      rescheduleRejectedMail: jest.fn().mockResolvedValue(undefined),
      rescheduleCounterProposedMail: jest.fn().mockResolvedValue(undefined),
      bookingCancelledMail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RescheduleService,
        { provide: PrismaService, useValue: prisma },
        { provide: RescheduleRepository, useValue: repository },
        { provide: ActivityService, useValue: activityService },
        { provide: GoogleCalendarService, useValue: googleCalendarService },
        { provide: RescheduleNotificationService, useValue: notifications },
        { provide: NodemailerService, useValue: nodemailerService },
      ],
    }).compile();

    service = module.get(RescheduleService);
  });

  describe('requestReschedule', () => {
    const dto = {
      proposedDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      reason: 'Need a later slot',
    };

    it('creates a PENDING request and flips the booking to RESCHEDULE_REQUESTED', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(buildBooking());
      repository.findActiveRescheduleRequest.mockResolvedValue(null);
      repository.createRescheduleRequest.mockResolvedValue(
        buildRescheduleRequest(),
      );
      repository.updateBooking.mockResolvedValue(buildBooking({ status: BookingStatus.RESCHEDULE_REQUESTED }));

      const result = await service.requestReschedule(BOOKING_ID, CLIENT_USER_ID, dto as any);

      expect(repository.createRescheduleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: BOOKING_ID,
          initiatedBy: CLIENT_USER_ID,
          initiatedByRole: UserRole.CLIENT,
          bookingStatusBeforeRequest: BookingStatus.CONFIRMED,
        }),
      );
      expect(repository.updateBooking).toHaveBeenCalledWith(BOOKING_ID, {
        status: BookingStatus.RESCHEDULE_REQUESTED,
      });
      expect(notifications.emit).toHaveBeenCalled();
      expect(result.data).toBeDefined();

      // client requested, so the vendor gets emailed
      expect(nodemailerService.rescheduleRequestedMail).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientEmail: 'vendor@example.com',
          requestedByLabel: 'client',
        }),
      );
    });

    it('rejects a user who is neither the client nor the vendor on the booking', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ id: 'stranger', email: 'stranger@example.com' }),
      );
      repository.findBookingById.mockResolvedValue(buildBooking());

      await expect(
        service.requestReschedule(BOOKING_ID, 'stranger', dto as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the booking is already completed', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(
        buildBooking({ status: BookingStatus.COMPLETED }),
      );

      await expect(
        service.requestReschedule(BOOKING_ID, CLIENT_USER_ID, dto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the booking is already cancelled', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(
        buildBooking({ status: BookingStatus.CANCELLED_BY_CLIENT }),
      );

      await expect(
        service.requestReschedule(BOOKING_ID, CLIENT_USER_ID, dto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when an active reschedule request already exists', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(buildBooking());
      repository.findActiveRescheduleRequest.mockResolvedValue(
        buildRescheduleRequest({ id: 'rr-existing' }),
      );

      await expect(
        service.requestReschedule(BOOKING_ID, CLIENT_USER_ID, dto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when the booking has already been rescheduled once', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(
        buildBooking({ rescheduleCount: 1 }),
      );
      repository.findActiveRescheduleRequest.mockResolvedValue(null);

      await expect(
        service.requestReschedule(BOOKING_ID, CLIENT_USER_ID, dto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a proposed date in the past', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(buildBooking());
      repository.findActiveRescheduleRequest.mockResolvedValue(null);

      await expect(
        service.requestReschedule(BOOKING_ID, CLIENT_USER_ID, {
          proposedDate: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('acceptReschedule', () => {
    it('lets the vendor accept a client-initiated request and confirms the booking', async () => {
      const proposedDate = new Date(Date.now() + 72 * 60 * 60 * 1000);
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ id: VENDOR_USER_ID, email: 'vendor@example.com', role: UserRole.VENDOR }),
      );
      repository.findBookingById.mockResolvedValue(
        buildBooking({ status: BookingStatus.RESCHEDULE_REQUESTED }),
      );
      repository.findActiveRescheduleRequest.mockResolvedValue(
        buildRescheduleRequest({ proposedDate }),
      );
      repository.findConflictingBooking.mockResolvedValue(null);
      repository.updateBooking.mockResolvedValue(
        buildBooking({ status: BookingStatus.CONFIRMED, startTime: proposedDate }),
      );

      await service.acceptReschedule(BOOKING_ID, VENDOR_USER_ID, {});

      expect(repository.updateBooking).toHaveBeenCalledWith(
        BOOKING_ID,
        expect.objectContaining({
          status: BookingStatus.CONFIRMED,
          rescheduleCount: { increment: 1 },
        }),
      );
      expect(repository.updateRescheduleRequest).toHaveBeenCalledWith(
        'rr-1',
        expect.objectContaining({ status: RescheduleStatus.ACCEPTED }),
      );

      // the client initiated, so the client gets the acceptance email
      expect(nodemailerService.rescheduleAcceptedMail).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'client@example.com' }),
      );
    });

    it('forbids the initiator from accepting their own request', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(
        buildBooking({ status: BookingStatus.RESCHEDULE_REQUESTED }),
      );
      repository.findActiveRescheduleRequest.mockResolvedValue(
        buildRescheduleRequest(),
      );

      await expect(
        service.acceptReschedule(BOOKING_ID, CLIENT_USER_ID, {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('fails when there is no active reschedule request', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(buildBooking());
      repository.findActiveRescheduleRequest.mockResolvedValue(null);

      await expect(
        service.acceptReschedule(BOOKING_ID, CLIENT_USER_ID, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects acceptance when the proposed slot now conflicts with another booking', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ id: VENDOR_USER_ID, email: 'vendor@example.com', role: UserRole.VENDOR }),
      );
      repository.findBookingById.mockResolvedValue(
        buildBooking({ status: BookingStatus.RESCHEDULE_REQUESTED }),
      );
      repository.findActiveRescheduleRequest.mockResolvedValue(
        buildRescheduleRequest(),
      );
      repository.findConflictingBooking.mockResolvedValue({
        id: 'other-booking',
      } as any);

      await expect(
        service.acceptReschedule(BOOKING_ID, VENDOR_USER_ID, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectReschedule', () => {
    it('reverts the booking to its pre-request status', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ id: VENDOR_USER_ID, email: 'vendor@example.com', role: UserRole.VENDOR }),
      );
      repository.findBookingById.mockResolvedValue(
        buildBooking({ status: BookingStatus.RESCHEDULE_REQUESTED }),
      );
      repository.findActiveRescheduleRequest.mockResolvedValue(
        buildRescheduleRequest(),
      );
      repository.updateBooking.mockResolvedValue(
        buildBooking({ status: BookingStatus.CONFIRMED }),
      );

      await service.rejectReschedule(BOOKING_ID, VENDOR_USER_ID, {
        reason: 'Not available',
      });

      expect(repository.updateBooking).toHaveBeenCalledWith(BOOKING_ID, {
        status: BookingStatus.CONFIRMED,
      });
      expect(repository.updateRescheduleRequest).toHaveBeenCalledWith(
        'rr-1',
        expect.objectContaining({ status: RescheduleStatus.REJECTED }),
      );

      // the client initiated, so the client gets the rejection email
      expect(nodemailerService.rescheduleRejectedMail).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientEmail: 'client@example.com',
          reason: 'Not available',
        }),
      );
    });
  });

  describe('counterPropose', () => {
    it('closes the active request as COUNTER_PROPOSED and opens a new PENDING one', async () => {
      const newDate = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ id: VENDOR_USER_ID, email: 'vendor@example.com', role: UserRole.VENDOR }),
      );
      repository.findBookingById.mockResolvedValue(
        buildBooking({ status: BookingStatus.RESCHEDULE_REQUESTED }),
      );
      repository.findActiveRescheduleRequest.mockResolvedValue(
        buildRescheduleRequest(),
      );
      repository.createRescheduleRequest.mockResolvedValue(
        buildRescheduleRequest({ id: 'rr-2' }),
      );

      await service.counterPropose(BOOKING_ID, VENDOR_USER_ID, {
        proposedDate: newDate,
      } as any);

      expect(repository.updateRescheduleRequest).toHaveBeenCalledWith(
        'rr-1',
        expect.objectContaining({ status: RescheduleStatus.COUNTER_PROPOSED }),
      );
      expect(repository.createRescheduleRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          initiatedBy: VENDOR_USER_ID,
          initiatedByRole: UserRole.VENDOR,
          bookingStatusBeforeRequest: BookingStatus.CONFIRMED,
        }),
      );

      // the vendor countered, so the original (client) initiator gets emailed
      expect(
        nodemailerService.rescheduleCounterProposedMail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: 'client@example.com' }),
      );
    });
  });

  describe('cancelBooking', () => {
    it('marks the booking CANCELLED_BY_CLIENT when the client cancels', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(buildBooking());
      repository.findActiveRescheduleRequest.mockResolvedValue(null);
      repository.updateBooking.mockResolvedValue(
        buildBooking({ status: BookingStatus.CANCELLED_BY_CLIENT }),
      );

      await service.cancelBooking(BOOKING_ID, CLIENT_USER_ID, {
        reason: 'Change of plans',
      });

      expect(repository.updateBooking).toHaveBeenCalledWith(
        BOOKING_ID,
        expect.objectContaining({
          status: BookingStatus.CANCELLED_BY_CLIENT,
          cancelledBy: CLIENT_USER_ID,
          cancelledByRole: UserRole.CLIENT,
          cancellationReason: 'Change of plans',
        }),
      );

      // the client cancelled, so the vendor gets emailed
      expect(nodemailerService.bookingCancelledMail).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientEmail: 'vendor@example.com',
          cancelledByLabel: 'client',
        }),
      );
    });

    it('marks the booking CANCELLED_BY_VENDOR when the vendor cancels', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ id: VENDOR_USER_ID, email: 'vendor@example.com', role: UserRole.VENDOR }),
      );
      repository.findBookingById.mockResolvedValue(buildBooking());
      repository.findActiveRescheduleRequest.mockResolvedValue(null);
      repository.updateBooking.mockResolvedValue(
        buildBooking({ status: BookingStatus.CANCELLED_BY_VENDOR }),
      );

      await service.cancelBooking(BOOKING_ID, VENDOR_USER_ID, {});

      expect(repository.updateBooking).toHaveBeenCalledWith(
        BOOKING_ID,
        expect.objectContaining({ status: BookingStatus.CANCELLED_BY_VENDOR }),
      );

      // the vendor cancelled, so the client gets emailed
      expect(nodemailerService.bookingCancelledMail).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientEmail: 'client@example.com',
          cancelledByLabel: 'vendor',
        }),
      );
    });

    function bookingStartingIn(hours: number) {
      const start = new Date(Date.now() + hours * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      return buildBooking({
        startTime: start,
        endTime: end,
        services: { id: 'service-1', name: 'Bridal Makeup', price: 20000 },
      });
    }

    it.each([
      [30, 20000, 0, '24+ hours before'],
      [18, 18000, 2000, '12-24 hours before'],
      [6, 15000, 5000, '2-12 hours before'],
      [1.5, 10000, 10000, '1-2 hours before'],
      [0.5, 5000, 15000, 'Less than 1 hour before'],
    ])(
      'when the client cancels %sh before start, refunds %s and compensates the vendor %s (%s)',
      async (hoursBeforeStart, refundAmount, vendorCompensationAmount, label) => {
        prisma.user.findUnique.mockResolvedValue(buildUser());
        repository.findBookingById.mockResolvedValue(
          bookingStartingIn(hoursBeforeStart as number),
        );
        repository.findActiveRescheduleRequest.mockResolvedValue(null);
        repository.updateBooking.mockResolvedValue(buildBooking());

        await service.cancelBooking(BOOKING_ID, CLIENT_USER_ID, {});

        expect(repository.updateBooking).toHaveBeenCalledWith(
          BOOKING_ID,
          expect.objectContaining({
            cancellationTier: label,
            refundAmount,
            vendorCompensationAmount,
          }),
        );
        expect(repository.incrementVendorCancellationStrikes).not.toHaveBeenCalled();
      },
    );

    it('gives no refund when the client cancels after the appointment time has passed (no-show)', async () => {
      const start = new Date(Date.now() - 60 * 60 * 1000);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(
        buildBooking({
          startTime: start,
          endTime: end,
          services: { id: 'service-1', name: 'Bridal Makeup', price: 20000 },
        }),
      );
      repository.findActiveRescheduleRequest.mockResolvedValue(null);
      repository.updateBooking.mockResolvedValue(buildBooking());

      await service.cancelBooking(BOOKING_ID, CLIENT_USER_ID, {});

      expect(repository.updateBooking).toHaveBeenCalledWith(
        BOOKING_ID,
        expect.objectContaining({
          cancellationTier: 'After appointment time / no-show',
          refundAmount: 0,
          vendorCompensationAmount: 20000,
        }),
      );
    });

    it('always gives a full refund and records a strike when the vendor cancels, regardless of timing', async () => {
      const start = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes out
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ id: VENDOR_USER_ID, email: 'vendor@example.com', role: UserRole.VENDOR }),
      );
      repository.findBookingById.mockResolvedValue(
        buildBooking({
          startTime: start,
          endTime: end,
          services: { id: 'service-1', name: 'Bridal Makeup', price: 20000 },
        }),
      );
      repository.findActiveRescheduleRequest.mockResolvedValue(null);
      repository.updateBooking.mockResolvedValue(buildBooking());

      await service.cancelBooking(BOOKING_ID, VENDOR_USER_ID, {});

      expect(repository.updateBooking).toHaveBeenCalledWith(
        BOOKING_ID,
        expect.objectContaining({
          cancellationTier: 'Vendor cancellation',
          refundAmount: 20000,
          vendorCompensationAmount: 0,
        }),
      );
      expect(repository.incrementVendorCancellationStrikes).toHaveBeenCalledWith(
        'vendor-doc-1',
      );
    });

    it('rejects cancelling a completed booking', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(
        buildBooking({ status: BookingStatus.COMPLETED }),
      );

      await expect(
        service.cancelBooking(BOOKING_ID, CLIENT_USER_ID, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cancelling an already-cancelled booking', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());
      repository.findBookingById.mockResolvedValue(
        buildBooking({ status: BookingStatus.CANCELLED_BY_VENDOR }),
      );

      await expect(
        service.cancelBooking(BOOKING_ID, CLIENT_USER_ID, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getRescheduleHistory', () => {
    it('allows an admin to view history without being a participant', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ id: 'admin-1', email: 'admin@example.com', role: UserRole.ADMIN }),
      );
      repository.findBookingById.mockResolvedValue(buildBooking());
      repository.listRescheduleHistory.mockResolvedValue([]);

      const result = await service.getRescheduleHistory(BOOKING_ID, 'admin-1');

      expect(result.data).toEqual([]);
    });

    it('rejects a non-participant, non-admin user', async () => {
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ id: 'stranger', email: 'stranger@example.com' }),
      );
      repository.findBookingById.mockResolvedValue(buildBooking());

      await expect(
        service.getRescheduleHistory(BOOKING_ID, 'stranger'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
