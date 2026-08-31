import { Injectable, Logger } from '@nestjs/common';
import {
  RescheduleNotificationEvent,
  RescheduleNotificationPayload,
} from './reschedule-notification.events';

@Injectable()
export class RescheduleNotificationService {
  private readonly logger = new Logger(RescheduleNotificationService.name);

  emit(
    event: RescheduleNotificationEvent,
    payload: RescheduleNotificationPayload,
  ): void {
    this.logger.log(
      `[notification-placeholder] ${event} -> user:${payload.recipientUserId} booking:${payload.bookingId}`,
    );
  }
}
