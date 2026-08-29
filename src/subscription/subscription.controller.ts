/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { PaystackService } from 'src/paystack/paystack.service';
import { PlatformSettingsService } from 'src/platform-settings/platform-settings.service';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
export class SubscriptionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackService: PaystackService,
    private readonly platformSettingsService: PlatformSettingsService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  async getStatus(@Req() req: { user: { id: string } }) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { userId: req.user.id },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    return this.subscriptionService.getStatus(vendor.id);
  }

  @Post('upgrade')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  async upgrade(@Req() req: { user: { id: string } }) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { userId: req.user.id },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const platformSettings =
      await this.platformSettingsService.getOrCreateSettings();

    if (!platformSettings.subscriptionsEnabled) {
      throw new BadRequestException(
        'Subscriptions are not required while Jubly is free — there is nothing to upgrade to right now.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: req.user.id },
    });

    // Price and duration always come from admin-managed platform settings —
    // never from the frontend.
    const { priceNaira, durationDays } =
      await this.platformSettingsService.getSubscriptionPricing();

    const { authorizationUrl, reference } =
      await this.paystackService.initializeTransaction(
        user?.email ?? '',
        priceNaira,
        {
          type: 'SUBSCRIPTION_UPGRADE',
          vendorId: vendor.id,
          plan: 'PREMIUM',
          durationDays,
        },
      );

    return { paymentUrl: authorizationUrl, reference };
  }
}
