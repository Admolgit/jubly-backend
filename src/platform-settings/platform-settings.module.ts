import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';

@Module({
  controllers: [PlatformSettingsController],
  providers: [PrismaService, PlatformSettingsService, SubscriptionService],
  exports: [PlatformSettingsService],
})
export class PlatformSettingsModule {}
