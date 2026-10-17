import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaService } from 'prisma/prisma.service';
import { CancellationPolicyModule } from '../cancellation-policy/cancellation-policy.module';
import { PaystackService } from '../paystack/paystack.service';
import { BookingFinanceService } from './booking-finance.service';
import { FinancialResponseInterceptor } from './financial-response.interceptor';
import { PlatformSettingsService } from 'src/platform-settings/platform-settings.service';
import { SubscriptionService } from 'src/subscription/subscription.service';

@Module({
  imports: [CancellationPolicyModule],
  providers: [
    PrismaService,
    PaystackService,
    BookingFinanceService,
    SubscriptionService,
    PlatformSettingsService,
    { provide: APP_INTERCEPTOR, useClass: FinancialResponseInterceptor },
  ],
  exports: [BookingFinanceService],
})
export class BookingFinanceModule {}
