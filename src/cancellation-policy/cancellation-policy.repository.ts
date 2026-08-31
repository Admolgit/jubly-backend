import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import {
  CancellationPolicyTierConfig,
  NoShowPolicyConfig,
} from '@prisma/client';

@Injectable()
export class CancellationPolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  getSetting() {
    return this.prisma.cancellationPolicySetting.findFirst({
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsertSetting(data: {
    tiers: CancellationPolicyTierConfig[];
    noShowTier?: NoShowPolicyConfig;
    updatedBy: string;
  }) {
    const existing = await this.getSetting();

    if (!existing) {
      return this.prisma.cancellationPolicySetting.create({ data });
    }

    return this.prisma.cancellationPolicySetting.update({
      where: { id: existing.id },
      data,
    });
  }
}
