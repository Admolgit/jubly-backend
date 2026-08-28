import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async isVendorSubscribed(vendorId: string): Promise<boolean> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { vendorId },
    });

    if (!subscription || subscription.status !== 'ACTIVE') {
      return false;
    }

    if (subscription.expiresAt && subscription.expiresAt < new Date()) {
      return false;
    }

    return true;
  }

  async getStatus(vendorId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { vendorId },
    });

    const isActive = await this.isVendorSubscribed(vendorId);

    return successResponse(
      {
        isActive,
        plan: subscription?.plan ?? null,
        status: subscription?.status ?? null,
        expiresAt: subscription?.expiresAt ?? null,
      },
      'Subscription status fetched successfully',
    );
  }

  async activateSubscription(params: {
    vendorId: string;
    plan: string;
    durationDays: number;
    reference: string;
    amount: number;
  }) {
    const { vendorId, plan, durationDays, reference, amount } = params;

    const existing = await this.prisma.subscription.findUnique({
      where: { vendorId },
    });

    if (existing?.lastPaymentReference === reference) {
      return existing;
    }

    const now = new Date();
    const stillActive =
      existing?.status === 'ACTIVE' &&
      existing.expiresAt &&
      existing.expiresAt > now;

    const startPoint = stillActive ? existing!.expiresAt! : now;
    const expiresAt = new Date(
      startPoint.getTime() + durationDays * 24 * 60 * 60 * 1000,
    );

    return this.prisma.subscription.upsert({
      where: { vendorId },
      update: {
        plan,
        status: 'ACTIVE',
        expiresAt,
        cancelledAt: null,
        lastPaymentReference: reference,
        lastPaymentAmount: amount,
        lastPaidAt: now,
      },
      create: {
        vendorId,
        plan,
        status: 'ACTIVE',
        startedAt: now,
        expiresAt,
        lastPaymentReference: reference,
        lastPaymentAmount: amount,
        lastPaidAt: now,
      },
    });
  }
}
