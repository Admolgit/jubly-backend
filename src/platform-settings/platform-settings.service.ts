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
import { UpdateVendorPlatformSettingsDto } from './dto/vendor-platform-settings.dto';
import { PlatformSettings } from '@prisma/client';

const OVERRIDABLE_FIELDS = [
  'subscriptionsEnabled',
  'defaultPlatformPercentage',
  'subscriberPlatformPercentage',
  'manualBookingEnabled',
  'paidByHandEnabled',
  'subscriptionPriceNaira',
  'subscriptionDurationDays',
] as const;

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

  /**
   * The settings that actually apply to a given vendor: the global
   * PlatformSettings document, with any non-null field from that vendor's
   * VendorPlatformSettings override applied on top. A vendor with no
   * override document (or one with every field left null) is fully governed
   * by the global settings — nothing changes for them.
   */
  async getEffectiveSettings(vendorId?: string): Promise<PlatformSettings> {
    const global = await this.getOrCreateSettings();

    if (!vendorId) {
      return global;
    }

    const override = await this.prisma.vendorPlatformSettings.findUnique({
      where: { vendorId },
    });

    if (!override) {
      return global;
    }

    const effective: PlatformSettings = { ...global };

    for (const field of OVERRIDABLE_FIELDS) {
      const overrideValue = override[field];
      if (overrideValue !== null && overrideValue !== undefined) {
        (effective as any)[field] = overrideValue;
      }
    }

    return effective;
  }

  async resolvePlatformPercentage(vendorId: string): Promise<number> {
    const settings = await this.getEffectiveSettings(vendorId);

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
    const settings = await this.getEffectiveSettings(vendorId);

    if (!settings.paidByHandEnabled) {
      return false;
    }

    if (!settings.subscriptionsEnabled) {
      return true;
    }

    return this.subscriptionService.isVendorSubscribed(vendorId);
  }

  async isManualBookingEnabled(vendorId: string): Promise<boolean> {
    const settings = await this.getEffectiveSettings(vendorId);
    return settings.manualBookingEnabled;
  }

  async isSubscriptionsEnabled(vendorId?: string): Promise<boolean> {
    const settings = await this.getEffectiveSettings(vendorId);
    return settings.subscriptionsEnabled;
  }

  async getSubscriptionPricing(vendorId?: string): Promise<{
    priceNaira: number;
    durationDays: number;
  }> {
    const settings = await this.getEffectiveSettings(vendorId);

    return {
      priceNaira: settings.subscriptionPriceNaira,
      durationDays: settings.subscriptionDurationDays,
    };
  }

  // --- Per-vendor overrides (admin-managed) ---

  async getVendorOverride(vendorId: string) {
    try {
      const override = await this.prisma.vendorPlatformSettings.findUnique({
        where: { vendorId },
      });
      const effective = await this.getEffectiveSettings(vendorId);

      return successResponse(
        { override, effective },
        'Vendor platform settings fetched successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch vendor platform settings.',
        error.message as string,
      );
    }
  }

  async updateVendorOverride(
    vendorId: string,
    dto: UpdateVendorPlatformSettingsDto,
    adminUserId: string,
  ) {
    try {
      const updated = await this.prisma.vendorPlatformSettings.upsert({
        where: { vendorId },
        update: { ...dto, updatedBy: adminUserId },
        create: { vendorId, ...dto, updatedBy: adminUserId },
      });

      return successResponse(
        updated,
        'Vendor platform settings updated successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to update vendor platform settings.',
        error.message as string,
      );
    }
  }

  async clearVendorOverride(vendorId: string) {
    try {
      await this.prisma.vendorPlatformSettings.deleteMany({
        where: { vendorId },
      });

      return successResponse(
        null,
        'Vendor platform settings override removed — global settings now apply.',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to clear vendor platform settings.',
        error.message as string,
      );
    }
  }
}
