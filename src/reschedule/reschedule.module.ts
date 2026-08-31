import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'prisma/prisma.service';
import { ActivityService } from 'src/activity/activityLog.service';
import { GoogleCalendarService } from 'src/google/google.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { CancellationPolicyModule } from 'src/cancellation-policy/cancellation-policy.module';
import { RescheduleController } from './reschedule.controller';
import { RescheduleService } from './reschedule.service';
import { RescheduleRepository } from './reschedule.repository';
import { RescheduleNotificationService } from './events/reschedule-notification.service';

@Module({
  imports: [CancellationPolicyModule],
  controllers: [RescheduleController],
  providers: [
    PrismaService,
    ConfigService,
    ActivityService,
    GoogleCalendarService,
    NodemailerService,
    RescheduleRepository,
    RescheduleNotificationService,
    RescheduleService,
  ],
  exports: [RescheduleService],
})
export class RescheduleModule {}
