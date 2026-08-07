export enum RescheduleNotificationEvent {
  BOOKING_RESCHEDULE_REQUESTED = 'BOOKING_RESCHEDULE_REQUESTED',
  BOOKING_RESCHEDULE_ACCEPTED = 'BOOKING_RESCHEDULE_ACCEPTED',
  BOOKING_RESCHEDULE_REJECTED = 'BOOKING_RESCHEDULE_REJECTED',
  BOOKING_RESCHEDULE_COUNTER_PROPOSED = 'BOOKING_RESCHEDULE_COUNTER_PROPOSED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
}

export interface RescheduleNotificationPayload {
  bookingId: string;
  recipientUserId: string;
  triggeredByUserId: string;
  reason?: string;
  proposedDate?: Date;
}
