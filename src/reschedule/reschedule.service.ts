/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { BookingStatus, RescheduleStatus, UserRole } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';
import { ActivityService } from 'src/activity/activityLog.service';
import { GoogleCalendarService } from 'src/google/google.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import {
  BookingWithRelations,
  RescheduleRepository,
} from './reschedule.repository';
import {
  CancelBookingDto,
  CounterProposeRescheduleDto,
  RequestRescheduleDto,
  RespondRescheduleDto,
} from './dto/reschedule.dto';
import {
  RescheduleNotificationEvent,
  RescheduleNotificationPayload,
} from './events/reschedule-notification.events';
import { RescheduleNotificationService } from './events/reschedule-notification.service';
import { computeCancellationOutcome } from './cancellation-policy.util';
import { CancellationPolicyService } from 'src/cancellation-policy/cancellation-policy.service';

const NON_ACTIONABLE_STATUSES: readonly BookingStatus[] = [
  BookingStatus.CANCELLED,
  BookingStatus.CANCELLED_BY_CLIENT,
  BookingStatus.CANCELLED_BY_VENDOR,
];

interface Participant {
  role: typeof UserRole.CLIENT | typeof UserRole.VENDOR;
  counterpartUserId?: string;
}

@Injectable()
export class RescheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: RescheduleRepository,
    private readonly activityService: ActivityService,
    private readonly googleCalendarService: GoogleCalendarService,
    private readonly notifications: RescheduleNotificationService,
    private readonly nodemailerService: NodemailerService,
    private readonly cancellationPolicyService: CancellationPolicyService,
  ) {}

  private readonly bookingTimezone = 'Africa/Lagos';

  private async loadUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private async loadBooking(bookingId: string): Promise<BookingWithRelations> {
    const booking = await this.repository.findBookingById(bookingId);

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return booking;
  }

  private resolveParticipant(
    booking: BookingWithRelations,
    user: { id: string; email: string; role: UserRole },
  ): Participant {
    if (booking.vendor.userId === user.id) {
      return {
        role: UserRole.VENDOR,
        counterpartUserId: booking.clientId ?? undefined,
      };
    }

    if (booking.clientId === user.id || booking.clientEmail === user.email) {
      return {
        role: UserRole.CLIENT,
        counterpartUserId: booking.vendor.userId,
      };
    }

    throw new ForbiddenException('Not allowed to manage this booking');
  }

  private assertNotCompleted(booking: BookingWithRelations, message: string) {
    if (booking.status === BookingStatus.COMPLETED) {
      throw new BadRequestException(message);
    }
  }

  private assertNotCancelled(booking: BookingWithRelations, message: string) {
    if (NON_ACTIONABLE_STATUSES.includes(booking.status)) {
      throw new BadRequestException(message);
    }
  }

  private assertProposedDateInFuture(proposedDate: Date) {
    if (Number.isNaN(proposedDate.getTime())) {
      throw new BadRequestException('proposedDate is invalid');
    }

    if (proposedDate <= new Date()) {
      throw new BadRequestException('Proposed date must be in the future');
    }
  }

  private getDatePartsInBookingTimezone(value: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.bookingTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    return `${year}-${month}-${day}T00:00:00.000+01:00`;
  }

  private computeNewSchedule(
    booking: BookingWithRelations,
    proposedDate: Date,
  ) {
    const durationMs = booking.endTime.getTime() - booking.startTime.getTime();
    const start = proposedDate;
    const end = new Date(start.getTime() + durationMs);
    const date = new Date(this.getDatePartsInBookingTimezone(start));

    return { start, end, date };
  }

  private notify(
    event: RescheduleNotificationEvent,
    payload: RescheduleNotificationPayload,
  ) {
    if (!payload.recipientUserId) return;
    this.notifications.emit(event, payload);
  }

  private resolveContact(booking: BookingWithRelations, role: UserRole) {
    if (role === UserRole.VENDOR) {
      return {
        email: booking.vendor.user.email,
        name: booking.vendor.businessName,
      };
    }

    return {
      email: booking.clientEmail,
      name: booking.clientName ?? booking.clientEmail,
    };
  }

  private async sendMailSafely(send: () => Promise<void>) {
    try {
      await send();
    } catch (err: any) {
      console.error('Reschedule/cancellation email failed:', err.message);
    }
  }

  async requestReschedule(
    bookingId: string,
    userId: string,
    dto: RequestRescheduleDto,
  ) {
    try {
      const user = await this.loadUser(userId);
      const booking = await this.loadBooking(bookingId);
      const participant = this.resolveParticipant(booking, user);

      this.assertNotCompleted(
        booking,
        'Completed bookings cannot be rescheduled',
      );
      this.assertNotCancelled(
        booking,
        'Cancelled bookings cannot be rescheduled',
      );

      const active =
        await this.repository.findActiveRescheduleRequest(bookingId);
      if (active) {
        throw new BadRequestException(
          'An active reschedule request already exists for this booking',
        );
      }

      if (booking.rescheduleCount > 0) {
        throw new BadRequestException(
          'This booking has already been rescheduled once. An admin override is required to reschedule again.',
        );
      }

      const proposedDate = new Date(dto.proposedDate);
      this.assertProposedDateInFuture(proposedDate);

      const request = await this.repository.createRescheduleRequest({
        bookingId,
        initiatedBy: user.id,
        initiatedByRole: participant.role,
        proposedDate,
        reason: dto.reason,
        bookingStatusBeforeRequest: booking.status,
      });

      await this.repository.updateBooking(bookingId, {
        status: BookingStatus.RESCHEDULE_REQUESTED,
      });

      await this.activityService.createLog({
        vendorId: booking.vendorId,
        userId: user.id,
        action: 'BOOKING_RESCHEDULE_REQUESTED',
        description: `Booking #${booking.id} reschedule requested by ${participant.role.toLowerCase()}.`,
        actor:
          participant.role === UserRole.VENDOR
            ? booking.vendor.businessName
            : (booking.clientName ?? user.email),
        actorType: participant.role,
        color: 'yellow',
        metadata: {
          oldStatus: booking.status,
          newStatus: BookingStatus.RESCHEDULE_REQUESTED,
          reason: dto.reason,
          proposedDate,
        },
      });

      this.notify(RescheduleNotificationEvent.BOOKING_RESCHEDULE_REQUESTED, {
        bookingId,
        recipientUserId: participant.counterpartUserId ?? '',
        triggeredByUserId: user.id,
        reason: dto.reason,
        proposedDate,
      });

      const counterpartRole =
        participant.role === UserRole.VENDOR
          ? UserRole.CLIENT
          : UserRole.VENDOR;
      const recipient = this.resolveContact(booking, counterpartRole);

      await this.sendMailSafely(() =>
        this.nodemailerService.rescheduleRequestedMail({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          requestedByLabel: participant.role.toLowerCase(),
          serviceName: booking.services.name,
          vendorName: booking.vendor.businessName,
          currentDate: booking.date,
          currentStart: booking.startTime,
          currentEnd: booking.endTime,
          proposedDate,
          reason: dto.reason,
        }),
      );

      return successResponse(request, 'Reschedule requested successfully', 201);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to request reschedule.',
        error.message as string,
      );
    }
  }

  async acceptReschedule(
    bookingId: string,
    userId: string,
    dto: RespondRescheduleDto,
  ) {
    try {
      const user = await this.loadUser(userId);
      const booking = await this.loadBooking(bookingId);
      const participant = this.resolveParticipant(booking, user);

      const active =
        await this.repository.findActiveRescheduleRequest(bookingId);
      if (!active) {
        throw new NotFoundException(
          'No active reschedule request for this booking',
        );
      }

      if (active.initiatedBy === user.id) {
        throw new ForbiddenException(
          'You cannot accept your own reschedule request',
        );
      }

      const { start, end, date } = this.computeNewSchedule(
        booking,
        active.proposedDate,
      );

      const conflict = await this.repository.findConflictingBooking(
        booking.vendorId,
        bookingId,
        start,
        end,
      );

      if (conflict) {
        throw new BadRequestException(
          'The proposed time slot is no longer available',
        );
      }

      const updatedBooking = await this.repository.updateBooking(bookingId, {
        startTime: start,
        endTime: end,
        date,
        status: BookingStatus.CONFIRMED,
        rescheduleCount: { increment: 1 },
      });

      await this.repository.updateRescheduleRequest(active.id, {
        status: RescheduleStatus.ACCEPTED,
        respondedBy: user.id,
        respondedAt: new Date(),
        responseReason: dto.reason,
      });

      if (booking.googleEventId) {
        try {
          const calendarIntegration =
            await this.prisma.vendorCalendar.findFirst({
              where: {
                userId: booking.vendor.userId,
                provider: { in: ['google', 'GOOGLE'] },
                linked: true,
              },
            });

          if (calendarIntegration) {
            const calendarApi =
              await this.googleCalendarService.calendarEnv(calendarIntegration);

            await calendarApi.events.update({
              calendarId: 'primary',
              eventId: booking.googleEventId,
              sendUpdates: 'all',
              requestBody: {
                start: {
                  dateTime: start.toISOString(),
                  timeZone: this.bookingTimezone,
                },
                end: {
                  dateTime: end.toISOString(),
                  timeZone: this.bookingTimezone,
                },
              },
            });
          }
        } catch (err: any) {
          console.error('Google Calendar update failed:', err.message);
        }
      }

      await this.activityService.createLog({
        vendorId: booking.vendorId,
        userId: user.id,
        action: 'BOOKING_RESCHEDULE_ACCEPTED',
        description: `Booking #${booking.id} reschedule accepted by ${participant.role.toLowerCase()}.`,
        actor:
          participant.role === UserRole.VENDOR
            ? booking.vendor.businessName
            : (booking.clientName ?? user.email),
        actorType: participant.role,
        color: 'green',
        metadata: {
          oldStatus: booking.status,
          newStatus: BookingStatus.CONFIRMED,
          reason: dto.reason,
          startTime: start,
          endTime: end,
        },
      });

      this.notify(RescheduleNotificationEvent.BOOKING_RESCHEDULE_ACCEPTED, {
        bookingId,
        recipientUserId: active.initiatedBy,
        triggeredByUserId: user.id,
        reason: dto.reason,
        proposedDate: start,
      });

      const initiatorContact = this.resolveContact(
        booking,
        active.initiatedByRole,
      );

      await this.sendMailSafely(() =>
        this.nodemailerService.rescheduleAcceptedMail({
          recipientEmail: initiatorContact.email,
          recipientName: initiatorContact.name,
          serviceName: booking.services.name,
          vendorName: booking.vendor.businessName,
          newStart: start,
          newEnd: end,
        }),
      );

      return successResponse(
        updatedBooking,
        'Reschedule accepted successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to accept reschedule.',
        error.message as string,
      );
    }
  }

  async rejectReschedule(
    bookingId: string,
    userId: string,
    dto: RespondRescheduleDto,
  ) {
    try {
      const user = await this.loadUser(userId);
      const booking = await this.loadBooking(bookingId);
      const participant = this.resolveParticipant(booking, user);

      const active =
        await this.repository.findActiveRescheduleRequest(bookingId);
      if (!active) {
        throw new NotFoundException(
          'No active reschedule request for this booking',
        );
      }

      if (active.initiatedBy === user.id) {
        throw new ForbiddenException(
          'You cannot reject your own reschedule request',
        );
      }

      await this.repository.updateRescheduleRequest(active.id, {
        status: RescheduleStatus.REJECTED,
        respondedBy: user.id,
        respondedAt: new Date(),
        responseReason: dto.reason,
      });

      const updatedBooking = await this.repository.updateBooking(bookingId, {
        status: active.bookingStatusBeforeRequest,
      });

      await this.activityService.createLog({
        vendorId: booking.vendorId,
        userId: user.id,
        action: 'BOOKING_RESCHEDULE_REJECTED',
        description: `Booking #${booking.id} reschedule rejected by ${participant.role.toLowerCase()}.`,
        actor:
          participant.role === UserRole.VENDOR
            ? booking.vendor.businessName
            : (booking.clientName ?? user.email),
        actorType: participant.role,
        color: 'red',
        metadata: {
          oldStatus: booking.status,
          newStatus: active.bookingStatusBeforeRequest,
          reason: dto.reason,
        },
      });

      this.notify(RescheduleNotificationEvent.BOOKING_RESCHEDULE_REJECTED, {
        bookingId,
        recipientUserId: active.initiatedBy,
        triggeredByUserId: user.id,
        reason: dto.reason,
      });

      const initiatorContact = this.resolveContact(
        booking,
        active.initiatedByRole,
      );

      await this.sendMailSafely(() =>
        this.nodemailerService.rescheduleRejectedMail({
          recipientEmail: initiatorContact.email,
          recipientName: initiatorContact.name,
          serviceName: booking.services.name,
          vendorName: booking.vendor.businessName,
          reason: dto.reason,
        }),
      );

      return successResponse(
        updatedBooking,
        'Reschedule rejected successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to reject reschedule.',
        error.message as string,
      );
    }
  }

  async counterPropose(
    bookingId: string,
    userId: string,
    dto: CounterProposeRescheduleDto,
  ) {
    try {
      const user = await this.loadUser(userId);
      const booking = await this.loadBooking(bookingId);
      const participant = this.resolveParticipant(booking, user);

      const active =
        await this.repository.findActiveRescheduleRequest(bookingId);
      if (!active) {
        throw new NotFoundException(
          'No active reschedule request for this booking',
        );
      }

      if (active.initiatedBy === user.id) {
        throw new ForbiddenException(
          'You cannot counter-propose your own reschedule request',
        );
      }

      const proposedDate = new Date(dto.proposedDate);
      this.assertProposedDateInFuture(proposedDate);

      await this.repository.updateRescheduleRequest(active.id, {
        status: RescheduleStatus.COUNTER_PROPOSED,
        respondedBy: user.id,
        respondedAt: new Date(),
        responseReason: dto.reason,
      });

      const counterRequest = await this.repository.createRescheduleRequest({
        bookingId,
        initiatedBy: user.id,
        initiatedByRole: participant.role,
        proposedDate,
        previousProposedDate: active.proposedDate,
        reason: dto.reason,
        bookingStatusBeforeRequest: active.bookingStatusBeforeRequest,
      });

      await this.activityService.createLog({
        vendorId: booking.vendorId,
        userId: user.id,
        action: 'BOOKING_RESCHEDULE_COUNTER_PROPOSED',
        description: `Booking #${booking.id} reschedule counter-proposed by ${participant.role.toLowerCase()}.`,
        actor:
          participant.role === UserRole.VENDOR
            ? booking.vendor.businessName
            : (booking.clientName ?? user.email),
        actorType: participant.role,
        color: 'orange',
        metadata: {
          oldStatus: booking.status,
          newStatus: booking.status,
          reason: dto.reason,
          previousProposedDate: active.proposedDate,
          proposedDate,
        },
      });

      this.notify(
        RescheduleNotificationEvent.BOOKING_RESCHEDULE_COUNTER_PROPOSED,
        {
          bookingId,
          recipientUserId: active.initiatedBy,
          triggeredByUserId: user.id,
          reason: dto.reason,
          proposedDate,
        },
      );

      const originalInitiatorContact = this.resolveContact(
        booking,
        active.initiatedByRole,
      );

      await this.sendMailSafely(() =>
        this.nodemailerService.rescheduleCounterProposedMail({
          recipientEmail: originalInitiatorContact.email,
          recipientName: originalInitiatorContact.name,
          serviceName: booking.services.name,
          vendorName: booking.vendor.businessName,
          proposedDate,
          reason: dto.reason,
        }),
      );

      return successResponse(
        counterRequest,
        'Counter-proposal submitted successfully',
        201,
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to submit counter-proposal.',
        error.message as string,
      );
    }
  }

  async cancelBooking(
    bookingId: string,
    userId: string,
    dto: CancelBookingDto,
  ) {
    try {
      const user = await this.loadUser(userId);
      const booking = await this.loadBooking(bookingId);
      const participant = this.resolveParticipant(booking, user);

      this.assertNotCompleted(
        booking,
        'Completed bookings cannot be cancelled',
      );
      this.assertNotCancelled(booking, 'This booking is already cancelled');

      const newStatus =
        participant.role === UserRole.VENDOR
          ? BookingStatus.CANCELLED_BY_VENDOR
          : BookingStatus.CANCELLED_BY_CLIENT;

      const active =
        await this.repository.findActiveRescheduleRequest(bookingId);
      if (active) {
        await this.repository.updateRescheduleRequest(active.id, {
          status: RescheduleStatus.REJECTED,
          respondedBy: user.id,
          respondedAt: new Date(),
          responseReason: 'Booking was cancelled',
        });
      }

      const cancelledAt = new Date();
      const { tiers, noShowPolicy } =
        await this.cancellationPolicyService.getActiveTiers();
      const { tier, refundAmount, vendorCompensationAmount } =
        computeCancellationOutcome({
          amount: booking.services.price,
          appointmentStart: booking.startTime,
          cancelledAt,
          cancelledByRole: participant.role,
          tiers,
          noShowPolicy,
        });

      const updatedBooking = await this.repository.updateBooking(bookingId, {
        status: newStatus,
        cancelledBy: user.id,
        cancelledByRole: participant.role,
        cancelledAt,
        cancellationReason: dto.reason,
        cancellationTier: tier.label,
        refundPercentage: tier.clientRefundPercentage,
        vendorCompensationPercentage: tier.vendorCompensationPercentage,
        refundAmount,
        vendorCompensationAmount,
      });

      if (participant.role === UserRole.VENDOR) {
        await this.repository.incrementVendorCancellationStrikes(
          booking.vendorId,
        );
      }

      await this.activityService.createLog({
        vendorId: booking.vendorId,
        userId: user.id,
        action: 'BOOKING_CANCELLED',
        description: `Booking #${booking.id} was cancelled by ${participant.role.toLowerCase()}.`,
        actor:
          participant.role === UserRole.VENDOR
            ? booking.vendor.businessName
            : (booking.clientName ?? user.email),
        actorType: participant.role,
        color: 'red',
        metadata: {
          oldStatus: booking.status,
          newStatus,
          reason: dto.reason,
          cancellationTier: tier.label,
          refundAmount,
          vendorCompensationAmount,
        },
      });

      this.notify(RescheduleNotificationEvent.BOOKING_CANCELLED, {
        bookingId,
        recipientUserId: participant.counterpartUserId ?? '',
        triggeredByUserId: user.id,
        reason: dto.reason,
        cancellationTier: tier.label,
        refundAmount,
        vendorCompensationAmount,
      });

      const counterpartRole =
        participant.role === UserRole.VENDOR
          ? UserRole.CLIENT
          : UserRole.VENDOR;
      const recipient = this.resolveContact(booking, counterpartRole);

      await this.sendMailSafely(() =>
        this.nodemailerService.bookingCancelledMail({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          serviceName: booking.services.name,
          vendorName: booking.vendor.businessName,
          cancelledByLabel: participant.role.toLowerCase(),
          reason: dto.reason,
          cancellationTier: tier.label,
          refundAmount,
          refundPercentage: tier.clientRefundPercentage,
          vendorCompensationAmount,
        }),
      );

      return successResponse(updatedBooking, 'Booking cancelled successfully');
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to cancel booking.',
        error.message as string,
      );
    }
  }

  async getRescheduleHistory(bookingId: string, userId: string) {
    try {
      const user = await this.loadUser(userId);
      const booking = await this.loadBooking(bookingId);

      if (user.role !== UserRole.ADMIN) {
        this.resolveParticipant(booking, user);
      }

      const history = await this.repository.listRescheduleHistory(bookingId);

      return successResponse(
        history,
        'Reschedule history fetched successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch reschedule history.',
        error.message as string,
      );
    }
  }

  async overrideRescheduleLimit(bookingId: string, adminUserId: string) {
    try {
      const booking = await this.loadBooking(bookingId);

      this.assertNotCompleted(booking, 'Completed bookings cannot be modified');
      this.assertNotCancelled(booking, 'Cancelled bookings cannot be modified');

      const updatedBooking = await this.repository.updateBooking(bookingId, {
        rescheduleCount: 0,
      });

      await this.activityService.createLog({
        vendorId: booking.vendorId,
        userId: adminUserId,
        action: 'BOOKING_RESCHEDULE_LIMIT_OVERRIDDEN',
        description: `Admin override: booking #${booking.id} reschedule limit reset.`,
        actor: 'Admin',
        actorType: UserRole.ADMIN,
        color: 'purple',
        metadata: {
          oldStatus: booking.status,
          newStatus: booking.status,
          previousRescheduleCount: booking.rescheduleCount,
        },
      });

      return successResponse(
        updatedBooking,
        'Reschedule limit override applied successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to override reschedule limit.',
        error.message as string,
      );
    }
  }
}
