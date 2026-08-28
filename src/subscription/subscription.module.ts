import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { PaystackService } from 'src/paystack/paystack.service';
import { PlatformSettingsService } from 'src/platform-settings/platform-settings.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  controllers: [SubscriptionController],
  providers: [
    PrismaService,
    SubscriptionService,
    PaystackService,
    PlatformSettingsService,
  ],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
