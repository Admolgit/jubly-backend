/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  CancellationTier,
  DEFAULT_NO_SHOW_POLICY,
  NoShowPolicy,
  STANDARD_CANCELLATION_TIERS,
} from 'src/reschedule/cancellation-policy.util';
import { successResponse } from 'src/utils/response';
import { CancellationPolicyRepository } from './cancellation-policy.repository';
import { UpdateCancellationPolicyDto } from './dto/cancellation-policy.dto';

@Injectable()
export class CancellationPolicyService {
  constructor(private readonly repository: CancellationPolicyRepository) {}

  private toEffectiveTiers(
    setting: Awaited<ReturnType<CancellationPolicyRepository['getSetting']>>,
  ): { tiers: CancellationTier[]; noShowPolicy: NoShowPolicy } {
    if (!setting || setting.tiers.length === 0) {
      return {
        tiers: STANDARD_CANCELLATION_TIERS,
        noShowPolicy: DEFAULT_NO_SHOW_POLICY,
      };
    }

    return {
      tiers: setting.tiers,
      noShowPolicy: setting.noShowTier ?? DEFAULT_NO_SHOW_POLICY,
    };
  }

  async getActiveTiers(): Promise<{
    tiers: CancellationTier[];
    noShowPolicy: NoShowPolicy;
  }> {
    const setting = await this.repository.getSetting();
    return this.toEffectiveTiers(setting);
  }

  async getPolicy() {
    try {
      const setting = await this.repository.getSetting();
      const { tiers, noShowPolicy } = this.toEffectiveTiers(setting);

      return successResponse(
        {
          tiers,
          noShowTier: noShowPolicy,
          isCustomized: Boolean(setting),
        },
        'Cancellation policy fetched successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch cancellation policy.',
        error.message as string,
      );
    }
  }

  async updatePolicy(dto: UpdateCancellationPolicyDto, adminUserId: string) {
    try {
      this.assertValidTiers(dto.tiers);

      const updated = await this.repository.upsertSetting({
        tiers: dto.tiers,
        noShowTier: dto.noShowTier,
        updatedBy: adminUserId,
      });

      return successResponse(
        updated,
        'Cancellation policy updated successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to update cancellation policy.',
        error.message as string,
      );
    }
  }

  private assertValidTiers(tiers: UpdateCancellationPolicyDto['tiers']) {
    if (!tiers || tiers.length === 0) {
      throw new BadRequestException('At least one tier is required');
    }

    const thresholds = tiers.map((tier) => tier.minHoursBeforeStart);
    const uniqueThresholds = new Set(thresholds);

    if (uniqueThresholds.size !== thresholds.length) {
      throw new BadRequestException(
        'Tiers cannot share the same minHoursBeforeStart threshold',
      );
    }

    if (!thresholds.includes(0)) {
      throw new BadRequestException(
        'At least one tier must have minHoursBeforeStart set to 0, to cover the window up to the appointment time',
      );
    }
  }
}
