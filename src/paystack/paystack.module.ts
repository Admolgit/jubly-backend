/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { PaystackService } from './paystack.service';
import { PaystackController } from './paystack.controller';
import { PaystackReconciliationService } from './paystack-reconciliation.service';
import { TransactionService } from 'src/transaction/transaction.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { BookingService } from 'src/booking/booking.service';
import { GoogleCalendarService } from 'src/google/google.service';
import { AuthService } from 'src/auth/auth.service';
import { ConfigService } from '@nestjs/config';
import { ActivityService } from 'src/activity/activityLog.service';
import { PlatformSettingsService } from 'src/platform-settings/platform-settings.service';
import { SubscriptionService } from 'src/subscription/subscription.service';

@Module({
  providers: [
    PrismaService,
    PaystackService,
    PaystackReconciliationService,
    TransactionService,
    NodemailerService,
    BookingService,
    GoogleCalendarService,
    AuthService,
    ConfigService,
    ActivityService,
    PlatformSettingsService,
    SubscriptionService,
  ],
  exports: [PaystackService],
  controllers: [PaystackController],
  imports: [],
})
export class PaystackModule {}
