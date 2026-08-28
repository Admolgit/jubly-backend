import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

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
}
