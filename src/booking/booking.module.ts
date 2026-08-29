import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { PrismaService } from 'prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { BookingService } from './booking.service';
import { GoogleCalendarService } from 'src/google/google.service';
import { AuthService } from 'src/auth/auth.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { PaystackService } from 'src/paystack/paystack.service';
import { ActivityService } from 'src/activity/activityLog.service';
import { PlatformSettingsService } from 'src/platform-settings/platform-settings.service';
import { SubscriptionService } from 'src/subscription/subscription.service';

@Module({
  controllers: [BookingController],
  imports: [],
  exports: [BookingService],
  providers: [
    PrismaService,
    BookingService,
    GoogleCalendarService,
    ConfigService,
    AuthService,
    NodemailerService,
    PaystackService,
    ActivityService,
    PlatformSettingsService,
    SubscriptionService,
  ],
})
export class BookingModule {}
