"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RescheduleService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
const activityLog_service_1 = require("../activity/activityLog.service");
const google_service_1 = require("../google/google.service");
const nodemailer_service_1 = require("../nodemailer/nodemailer.service");
const reschedule_repository_1 = require("./reschedule.repository");
const reschedule_notification_events_1 = require("./events/reschedule-notification.events");
const reschedule_notification_service_1 = require("./events/reschedule-notification.service");
const cancellation_policy_util_1 = require("./cancellation-policy.util");
const cancellation_policy_service_1 = require("../cancellation-policy/cancellation-policy.service");
const NON_ACTIONABLE_STATUSES = [
    client_1.BookingStatus.CANCELLED,
    client_1.BookingStatus.CANCELLED_BY_CLIENT,
    client_1.BookingStatus.CANCELLED_BY_VENDOR,
];
let RescheduleService = class RescheduleService {
    constructor(prisma, repository, activityService, googleCalendarService, notifications, nodemailerService, cancellationPolicyService) {
        this.prisma = prisma;
        this.repository = repository;
        this.activityService = activityService;
        this.googleCalendarService = googleCalendarService;
        this.notifications = notifications;
        this.nodemailerService = nodemailerService;
        this.cancellationPolicyService = cancellationPolicyService;
        this.bookingTimezone = 'Africa/Lagos';
    }
    async loadUser(userId) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        return user;
    }
    async loadBooking(bookingId) {
        const booking = await this.repository.findBookingById(bookingId);
        if (!booking) {
            throw new common_1.NotFoundException('Booking not found');
        }
        return booking;
    }
    resolveParticipant(booking, user) {
        if (booking.vendor.userId === user.id) {
            return {
                role: client_1.UserRole.VENDOR,
                counterpartUserId: booking.clientId ?? undefined,
            };
        }
        if (booking.clientId === user.id || booking.clientEmail === user.email) {
            return {
                role: client_1.UserRole.CLIENT,
                counterpartUserId: booking.vendor.userId,
            };
        }
        throw new common_1.ForbiddenException('Not allowed to manage this booking');
    }
    assertNotCompleted(booking, message) {
        if (booking.status === client_1.BookingStatus.COMPLETED) {
            throw new common_1.BadRequestException(message);
        }
    }
    assertNotCancelled(booking, message) {
        if (NON_ACTIONABLE_STATUSES.includes(booking.status)) {
            throw new common_1.BadRequestException(message);
        }
    }
    assertProposedDateInFuture(proposedDate) {
        if (Number.isNaN(proposedDate.getTime())) {
            throw new common_1.BadRequestException('proposedDate is invalid');
        }
        if (proposedDate <= new Date()) {
            throw new common_1.BadRequestException('Proposed date must be in the future');
        }
    }
    getDatePartsInBookingTimezone(value) {
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
    computeNewSchedule(booking, proposedDate) {
        const durationMs = booking.endTime.getTime() - booking.startTime.getTime();
        const start = proposedDate;
        const end = new Date(start.getTime() + durationMs);
        const date = new Date(this.getDatePartsInBookingTimezone(start));
        return { start, end, date };
    }
    notify(event, payload) {
        if (!payload.recipientUserId)
            return;
        this.notifications.emit(event, payload);
    }
    resolveContact(booking, role) {
        if (role === client_1.UserRole.VENDOR) {
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
    async sendMailSafely(send) {
        try {
            await send();
        }
        catch (err) {
            console.error('Reschedule/cancellation email failed:', err.message);
        }
    }
    async requestReschedule(bookingId, userId, dto) {
        try {
            const user = await this.loadUser(userId);
            const booking = await this.loadBooking(bookingId);
            const participant = this.resolveParticipant(booking, user);
            this.assertNotCompleted(booking, 'Completed bookings cannot be rescheduled');
            this.assertNotCancelled(booking, 'Cancelled bookings cannot be rescheduled');
            const active = await this.repository.findActiveRescheduleRequest(bookingId);
            if (active) {
                throw new common_1.BadRequestException('An active reschedule request already exists for this booking');
            }
            if (booking.rescheduleCount > 0) {
                throw new common_1.BadRequestException('This booking has already been rescheduled once. An admin override is required to reschedule again.');
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
                status: client_1.BookingStatus.RESCHEDULE_REQUESTED,
            });
            await this.activityService.createLog({
                vendorId: booking.vendorId,
                userId: user.id,
                action: 'BOOKING_RESCHEDULE_REQUESTED',
                description: `Booking #${booking.id} reschedule requested by ${participant.role.toLowerCase()}.`,
                actor: participant.role === client_1.UserRole.VENDOR
                    ? booking.vendor.businessName
                    : (booking.clientName ?? user.email),
                actorType: participant.role,
                color: 'yellow',
                metadata: {
                    oldStatus: booking.status,
                    newStatus: client_1.BookingStatus.RESCHEDULE_REQUESTED,
                    reason: dto.reason,
                    proposedDate,
                },
            });
            this.notify(reschedule_notification_events_1.RescheduleNotificationEvent.BOOKING_RESCHEDULE_REQUESTED, {
                bookingId,
                recipientUserId: participant.counterpartUserId ?? '',
                triggeredByUserId: user.id,
                reason: dto.reason,
                proposedDate,
            });
            const counterpartRole = participant.role === client_1.UserRole.VENDOR
                ? client_1.UserRole.CLIENT
                : client_1.UserRole.VENDOR;
            const recipient = this.resolveContact(booking, counterpartRole);
            await this.sendMailSafely(() => this.nodemailerService.rescheduleRequestedMail({
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
            }));
            return (0, response_1.successResponse)(request, 'Reschedule requested successfully', 201);
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to request reschedule.', error.message);
        }
    }
    async acceptReschedule(bookingId, userId, dto) {
        try {
            const user = await this.loadUser(userId);
            const booking = await this.loadBooking(bookingId);
            const participant = this.resolveParticipant(booking, user);
            const active = await this.repository.findActiveRescheduleRequest(bookingId);
            if (!active) {
                throw new common_1.NotFoundException('No active reschedule request for this booking');
            }
            if (active.initiatedBy === user.id) {
                throw new common_1.ForbiddenException('You cannot accept your own reschedule request');
            }
            const { start, end, date } = this.computeNewSchedule(booking, active.proposedDate);
            const conflict = await this.repository.findConflictingBooking(booking.vendorId, bookingId, start, end);
            if (conflict) {
                throw new common_1.BadRequestException('The proposed time slot is no longer available');
            }
            const updatedBooking = await this.repository.updateBooking(bookingId, {
                startTime: start,
                endTime: end,
                date,
                status: client_1.BookingStatus.CONFIRMED,
                rescheduleCount: { increment: 1 },
            });
            await this.repository.updateRescheduleRequest(active.id, {
                status: client_1.RescheduleStatus.ACCEPTED,
                respondedBy: user.id,
                respondedAt: new Date(),
                responseReason: dto.reason,
            });
            if (booking.googleEventId) {
                try {
                    const calendarIntegration = await this.prisma.vendorCalendar.findFirst({
                        where: {
                            userId: booking.vendor.userId,
                            provider: { in: ['google', 'GOOGLE'] },
                            linked: true,
                        },
                    });
                    if (calendarIntegration) {
                        const calendarApi = await this.googleCalendarService.calendarEnv(calendarIntegration);
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
                }
                catch (err) {
                    console.error('Google Calendar update failed:', err.message);
                }
            }
            await this.activityService.createLog({
                vendorId: booking.vendorId,
                userId: user.id,
                action: 'BOOKING_RESCHEDULE_ACCEPTED',
                description: `Booking #${booking.id} reschedule accepted by ${participant.role.toLowerCase()}.`,
                actor: participant.role === client_1.UserRole.VENDOR
                    ? booking.vendor.businessName
                    : (booking.clientName ?? user.email),
                actorType: participant.role,
                color: 'green',
                metadata: {
                    oldStatus: booking.status,
                    newStatus: client_1.BookingStatus.CONFIRMED,
                    reason: dto.reason,
                    startTime: start,
                    endTime: end,
                },
            });
            this.notify(reschedule_notification_events_1.RescheduleNotificationEvent.BOOKING_RESCHEDULE_ACCEPTED, {
                bookingId,
                recipientUserId: active.initiatedBy,
                triggeredByUserId: user.id,
                reason: dto.reason,
                proposedDate: start,
            });
            const initiatorContact = this.resolveContact(booking, active.initiatedByRole);
            await this.sendMailSafely(() => this.nodemailerService.rescheduleAcceptedMail({
                recipientEmail: initiatorContact.email,
                recipientName: initiatorContact.name,
                serviceName: booking.services.name,
                vendorName: booking.vendor.businessName,
                newStart: start,
                newEnd: end,
            }));
            return (0, response_1.successResponse)(updatedBooking, 'Reschedule accepted successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to accept reschedule.', error.message);
        }
    }
    async rejectReschedule(bookingId, userId, dto) {
        try {
            const user = await this.loadUser(userId);
            const booking = await this.loadBooking(bookingId);
            const participant = this.resolveParticipant(booking, user);
            const active = await this.repository.findActiveRescheduleRequest(bookingId);
            if (!active) {
                throw new common_1.NotFoundException('No active reschedule request for this booking');
            }
            if (active.initiatedBy === user.id) {
                throw new common_1.ForbiddenException('You cannot reject your own reschedule request');
            }
            await this.repository.updateRescheduleRequest(active.id, {
                status: client_1.RescheduleStatus.REJECTED,
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
                actor: participant.role === client_1.UserRole.VENDOR
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
            this.notify(reschedule_notification_events_1.RescheduleNotificationEvent.BOOKING_RESCHEDULE_REJECTED, {
                bookingId,
                recipientUserId: active.initiatedBy,
                triggeredByUserId: user.id,
                reason: dto.reason,
            });
            const initiatorContact = this.resolveContact(booking, active.initiatedByRole);
            await this.sendMailSafely(() => this.nodemailerService.rescheduleRejectedMail({
                recipientEmail: initiatorContact.email,
                recipientName: initiatorContact.name,
                serviceName: booking.services.name,
                vendorName: booking.vendor.businessName,
                reason: dto.reason,
            }));
            return (0, response_1.successResponse)(updatedBooking, 'Reschedule rejected successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to reject reschedule.', error.message);
        }
    }
    async counterPropose(bookingId, userId, dto) {
        try {
            const user = await this.loadUser(userId);
            const booking = await this.loadBooking(bookingId);
            const participant = this.resolveParticipant(booking, user);
            const active = await this.repository.findActiveRescheduleRequest(bookingId);
            if (!active) {
                throw new common_1.NotFoundException('No active reschedule request for this booking');
            }
            if (active.initiatedBy === user.id) {
                throw new common_1.ForbiddenException('You cannot counter-propose your own reschedule request');
            }
            const proposedDate = new Date(dto.proposedDate);
            this.assertProposedDateInFuture(proposedDate);
            await this.repository.updateRescheduleRequest(active.id, {
                status: client_1.RescheduleStatus.COUNTER_PROPOSED,
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
                actor: participant.role === client_1.UserRole.VENDOR
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
            this.notify(reschedule_notification_events_1.RescheduleNotificationEvent.BOOKING_RESCHEDULE_COUNTER_PROPOSED, {
                bookingId,
                recipientUserId: active.initiatedBy,
                triggeredByUserId: user.id,
                reason: dto.reason,
                proposedDate,
            });
            const originalInitiatorContact = this.resolveContact(booking, active.initiatedByRole);
            await this.sendMailSafely(() => this.nodemailerService.rescheduleCounterProposedMail({
                recipientEmail: originalInitiatorContact.email,
                recipientName: originalInitiatorContact.name,
                serviceName: booking.services.name,
                vendorName: booking.vendor.businessName,
                proposedDate,
                reason: dto.reason,
            }));
            return (0, response_1.successResponse)(counterRequest, 'Counter-proposal submitted successfully', 201);
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to submit counter-proposal.', error.message);
        }
    }
    async cancelBooking(bookingId, userId, dto) {
        try {
            const user = await this.loadUser(userId);
            const booking = await this.loadBooking(bookingId);
            const participant = this.resolveParticipant(booking, user);
            this.assertNotCompleted(booking, 'Completed bookings cannot be cancelled');
            this.assertNotCancelled(booking, 'This booking is already cancelled');
            const newStatus = participant.role === client_1.UserRole.VENDOR
                ? client_1.BookingStatus.CANCELLED_BY_VENDOR
                : client_1.BookingStatus.CANCELLED_BY_CLIENT;
            const active = await this.repository.findActiveRescheduleRequest(bookingId);
            if (active) {
                await this.repository.updateRescheduleRequest(active.id, {
                    status: client_1.RescheduleStatus.REJECTED,
                    respondedBy: user.id,
                    respondedAt: new Date(),
                    responseReason: 'Booking was cancelled',
                });
            }
            const cancelledAt = new Date();
            const { tiers, noShowPolicy } = await this.cancellationPolicyService.getActiveTiers();
            const { tier, refundAmount, vendorCompensationAmount } = (0, cancellation_policy_util_1.computeCancellationOutcome)({
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
            if (participant.role === client_1.UserRole.VENDOR) {
                await this.repository.incrementVendorCancellationStrikes(booking.vendorId);
            }
            await this.activityService.createLog({
                vendorId: booking.vendorId,
                userId: user.id,
                action: 'BOOKING_CANCELLED',
                description: `Booking #${booking.id} was cancelled by ${participant.role.toLowerCase()}.`,
                actor: participant.role === client_1.UserRole.VENDOR
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
            this.notify(reschedule_notification_events_1.RescheduleNotificationEvent.BOOKING_CANCELLED, {
                bookingId,
                recipientUserId: participant.counterpartUserId ?? '',
                triggeredByUserId: user.id,
                reason: dto.reason,
                cancellationTier: tier.label,
                refundAmount,
                vendorCompensationAmount,
            });
            const counterpartRole = participant.role === client_1.UserRole.VENDOR
                ? client_1.UserRole.CLIENT
                : client_1.UserRole.VENDOR;
            const recipient = this.resolveContact(booking, counterpartRole);
            await this.sendMailSafely(() => this.nodemailerService.bookingCancelledMail({
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
            }));
            return (0, response_1.successResponse)(updatedBooking, 'Booking cancelled successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to cancel booking.', error.message);
        }
    }
    async getRescheduleHistory(bookingId, userId) {
        try {
            const user = await this.loadUser(userId);
            const booking = await this.loadBooking(bookingId);
            if (user.role !== client_1.UserRole.ADMIN) {
                this.resolveParticipant(booking, user);
            }
            const history = await this.repository.listRescheduleHistory(bookingId);
            return (0, response_1.successResponse)(history, 'Reschedule history fetched successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to fetch reschedule history.', error.message);
        }
    }
    async overrideRescheduleLimit(bookingId, adminUserId) {
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
                actorType: client_1.UserRole.ADMIN,
                color: 'purple',
                metadata: {
                    oldStatus: booking.status,
                    newStatus: booking.status,
                    previousRescheduleCount: booking.rescheduleCount,
                },
            });
            return (0, response_1.successResponse)(updatedBooking, 'Reschedule limit override applied successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to override reschedule limit.', error.message);
        }
    }
};
exports.RescheduleService = RescheduleService;
exports.RescheduleService = RescheduleService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        reschedule_repository_1.RescheduleRepository,
        activityLog_service_1.ActivityService,
        google_service_1.GoogleCalendarService,
        reschedule_notification_service_1.RescheduleNotificationService,
        nodemailer_service_1.NodemailerService,
        cancellation_policy_service_1.CancellationPolicyService])
], RescheduleService);
