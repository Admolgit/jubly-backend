/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { UpdatePlatformSettingsDto } from './dto/platform-settings.dto';
import { PlatformSettings } from '@prisma/client';

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  async getOrCreateSettings(): Promise<PlatformSettings> {
    const existing = await this.prisma.platformSettings.findFirst();

    if (existing) {
      return existing;
    }

    return this.prisma.platformSettings.create({ data: {} });
  }

  async getSettings() {
    try {
      const settings = await this.getOrCreateSettings();
      return successResponse(
        settings,
        'Platform settings fetched successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch platform settings.',
        error.message as string,
      );
    }
  }

  async updateSettings(dto: UpdatePlatformSettingsDto, adminUserId: string) {
    try {
      const current = await this.getOrCreateSettings();

      const updated = await this.prisma.platformSettings.update({
        where: { id: current.id },
        data: {
          ...dto,
          updatedBy: adminUserId,
        },
      });

      return successResponse(updated, 'Platform settings updated successfully');
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to update platform settings.',
        error.message as string,
      );
    }
  }

  async resolvePlatformPercentage(vendorId: string): Promise<number> {
    const settings = await this.getOrCreateSettings();

    if (!settings.subscriptionsEnabled) {
      return settings.defaultPlatformPercentage;
    }

    const isSubscribed =
      await this.subscriptionService.isVendorSubscribed(vendorId);

    return isSubscribed
      ? settings.subscriberPlatformPercentage
      : settings.defaultPlatformPercentage;
  }

  async canUsePaidByHand(vendorId: string): Promise<boolean> {
    const settings = await this.getOrCreateSettings();

    if (!settings.paidByHandEnabled) {
      return false;
    }

    if (!settings.subscriptionsEnabled) {
      return true;
    }

    return this.subscriptionService.isVendorSubscribed(vendorId);
  }

  async getSubscriptionPricing(): Promise<{
    priceNaira: number;
    durationDays: number;
  }> {
    const settings = await this.getOrCreateSettings();

    return {
      priceNaira: settings.subscriptionPriceNaira,
      durationDays: settings.subscriptionDurationDays,
    };
  }
}
