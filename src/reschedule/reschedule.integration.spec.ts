import { Test, TestingModule } from '@nestjs/testing';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import { BookingStatus, RescheduleStatus, UserRole } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { ActivityService } from 'src/activity/activityLog.service';
import { GoogleCalendarService } from 'src/google/google.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { RescheduleModule } from './reschedule.module';

class HeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = {
      id: req.headers['x-test-user-id'],
      email: req.headers['x-test-user-email'],
      role: req.headers['x-test-user-role'],
    };
    return true;
  }
}

const CLIENT_ID = 'client-1';
const VENDOR_USER_ID = 'vendor-1';
const BOOKING_ID = 'booking-1';

function asClient() {
  return {
    'x-test-user-id': CLIENT_ID,
    'x-test-user-email': 'client@example.com',
    'x-test-user-role': UserRole.CLIENT,
  };
}

function asVendor() {
  return {
    'x-test-user-id': VENDOR_USER_ID,
    'x-test-user-email': 'vendor@example.com',
    'x-test-user-role': UserRole.VENDOR,
  };
}

function asAdmin() {
  return {
    'x-test-user-id': 'admin-1',
    'x-test-user-email': 'admin@example.com',
    'x-test-user-role': UserRole.ADMIN,
  };
}

function buildBookingRow(overrides: Partial<any> = {}): any {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    id: BOOKING_ID,
    vendorId: 'vendor-doc-1',
    clientId: CLIENT_ID,
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

function buildRescheduleRow(overrides: Partial<any> = {}): any {
  return {
    id: 'rr-1',
    bookingId: BOOKING_ID,
    initiatedBy: CLIENT_ID,
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

describe('Reschedule endpoints (integration)', () => {
  let app: INestApplication;
  let prisma: {
    user: { findUnique: jest.Mock };
    booking: { findUnique: jest.Mock; update: jest.Mock; findFirst: jest.Mock };
    rescheduleRequest: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    vendorCalendar: { findFirst: jest.Mock };
    cancellationPolicySetting: { findFirst: jest.Mock };
    vendor: { update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      booking: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
      },
      rescheduleRequest: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      vendorCalendar: { findFirst: jest.fn() },
      cancellationPolicySetting: { findFirst: jest.fn().mockResolvedValue(null) },
      vendor: { update: jest.fn() },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [RescheduleModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ActivityService)
      .useValue({ createLog: jest.fn().mockResolvedValue({}) })
      .overrideProvider(GoogleCalendarService)
      .useValue({ calendarEnv: jest.fn() })
      .overrideProvider(NodemailerService)
      .useValue({
        rescheduleRequestedMail: jest.fn().mockResolvedValue(undefined),
        rescheduleAcceptedMail: jest.fn().mockResolvedValue(undefined),
        rescheduleRejectedMail: jest.fn().mockResolvedValue(undefined),
        rescheduleCounterProposedMail: jest.fn().mockResolvedValue(undefined),
        bookingCancelledMail: jest.fn().mockResolvedValue(undefined),
      })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderAuthGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /booking/:id/reschedule creates a request as the client', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: CLIENT_ID,
      email: 'client@example.com',
      role: UserRole.CLIENT,
    });
    prisma.booking.findUnique.mockResolvedValue(buildBookingRow());
    prisma.rescheduleRequest.findFirst.mockResolvedValue(null);
    prisma.rescheduleRequest.create.mockResolvedValue(buildRescheduleRow());
    prisma.booking.update.mockResolvedValue(
      buildBookingRow({ status: BookingStatus.RESCHEDULE_REQUESTED }),
    );

    const response = await request(app.getHttpServer())
      .post(`/booking/${BOOKING_ID}/reschedule`)
      .set(asClient())
      .send({
        proposedDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        reason: 'Need a later slot',
      });

    expect(response.status).toBe(201);
    expect(response.body.message).toBe('Reschedule requested successfully');
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { status: BookingStatus.RESCHEDULE_REQUESTED },
    });
  });

  it('POST /booking/:id/reschedule rejects an invalid proposedDate via the ValidationPipe', async () => {
    const response = await request(app.getHttpServer())
      .post(`/booking/${BOOKING_ID}/reschedule`)
      .set(asClient())
      .send({ proposedDate: 'not-a-date' });

    expect(response.status).toBe(400);
    expect(prisma.booking.findUnique).not.toHaveBeenCalled();
  });

  it('POST /booking/:id/reschedule/accept lets the vendor confirm the booking', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: VENDOR_USER_ID,
      email: 'vendor@example.com',
      role: UserRole.VENDOR,
    });
    prisma.booking.findUnique.mockResolvedValue(
      buildBookingRow({ status: BookingStatus.RESCHEDULE_REQUESTED }),
    );
    prisma.rescheduleRequest.findFirst.mockResolvedValue(buildRescheduleRow());
    prisma.booking.findFirst.mockResolvedValue(null); // no conflicting booking
    prisma.booking.update.mockResolvedValue(
      buildBookingRow({ status: BookingStatus.CONFIRMED }),
    );

    const response = await request(app.getHttpServer())
      .post(`/booking/${BOOKING_ID}/reschedule/accept`)
      .set(asVendor())
      .send({});

    expect(response.status).toBe(200);
    expect(prisma.rescheduleRequest.update).toHaveBeenCalledWith({
      where: { id: 'rr-1' },
      data: expect.objectContaining({ status: RescheduleStatus.ACCEPTED }),
    });
  });

  it('POST /booking/:id/cancel marks the booking CANCELLED_BY_CLIENT', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: CLIENT_ID,
      email: 'client@example.com',
      role: UserRole.CLIENT,
    });
    prisma.booking.findUnique.mockResolvedValue(buildBookingRow());
    prisma.rescheduleRequest.findFirst.mockResolvedValue(null);
    prisma.booking.update.mockResolvedValue(
      buildBookingRow({ status: BookingStatus.CANCELLED_BY_CLIENT }),
    );

    const response = await request(app.getHttpServer())
      .post(`/booking/${BOOKING_ID}/cancel`)
      .set(asClient())
      .send({ reason: 'Change of plans' });

    expect(response.status).toBe(200);
    expect(prisma.booking.update).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: expect.objectContaining({
        status: BookingStatus.CANCELLED_BY_CLIENT,
        cancellationReason: 'Change of plans',
      }),
    });
  });

  it('POST /booking/:id/cancel returns 403 for a user who is not a participant', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'stranger',
      email: 'stranger@example.com',
      role: UserRole.CLIENT,
    });
    prisma.booking.findUnique.mockResolvedValue(buildBookingRow());

    const response = await request(app.getHttpServer())
      .post(`/booking/${BOOKING_ID}/cancel`)
      .set({
        'x-test-user-id': 'stranger',
        'x-test-user-email': 'stranger@example.com',
        'x-test-user-role': UserRole.CLIENT,
      })
      .send({});

    expect(response.status).toBe(403);
  });

  it('GET /booking/:id/reschedule-history returns 200 for an admin', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    });
    prisma.booking.findUnique.mockResolvedValue(buildBookingRow());
    prisma.rescheduleRequest.findMany.mockResolvedValue([buildRescheduleRow()]);

    const response = await request(app.getHttpServer())
      .get(`/booking/${BOOKING_ID}/reschedule-history`)
      .set(asAdmin());

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it('POST /booking/:id/reschedule/override is rejected for a non-admin role', async () => {
    const response = await request(app.getHttpServer())
      .post(`/booking/${BOOKING_ID}/reschedule/override`)
      .set(asClient())
      .send({});

    expect(response.status).toBe(403);
    expect(prisma.booking.findUnique).not.toHaveBeenCalled();
  });
});
