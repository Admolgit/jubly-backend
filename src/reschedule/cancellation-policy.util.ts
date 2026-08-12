export interface CancellationTier {
  label: string;
  minHoursBeforeStart: number;
  clientRefundPercentage: number;
  vendorCompensationPercentage: number;
}

export const STANDARD_CANCELLATION_TIERS: CancellationTier[] = [
  {
    label: '24+ hours before',
    minHoursBeforeStart: 24,
    clientRefundPercentage: 1,
    vendorCompensationPercentage: 0,
  },
  {
    label: '12-24 hours before',
    minHoursBeforeStart: 12,
    clientRefundPercentage: 0.9,
    vendorCompensationPercentage: 0.1,
  },
  {
    label: '2-12 hours before',
    minHoursBeforeStart: 2,
    clientRefundPercentage: 0.75,
    vendorCompensationPercentage: 0.25,
  },
  {
    label: '1-2 hours before',
    minHoursBeforeStart: 1,
    clientRefundPercentage: 0.5,
    vendorCompensationPercentage: 0.5,
  },
  {
    label: 'Less than 1 hour before',
    minHoursBeforeStart: 0,
    clientRefundPercentage: 0.25,
    vendorCompensationPercentage: 0.75,
  },
];

export const NO_SHOW_TIER: CancellationTier = {
  label: 'After appointment time / no-show',
  minHoursBeforeStart: -Infinity,
  clientRefundPercentage: 0,
  vendorCompensationPercentage: 1,
};

export const VENDOR_CANCELLATION_TIER: CancellationTier = {
  label: 'Vendor cancellation',
  minHoursBeforeStart: -Infinity,
  clientRefundPercentage: 1,
  vendorCompensationPercentage: 0,
};

export function getClientCancellationTier(
  hoursUntilStart: number,
): CancellationTier {
  if (hoursUntilStart <= 0) {
    return NO_SHOW_TIER;
  }

  return (
    STANDARD_CANCELLATION_TIERS.find(
      (tier) => hoursUntilStart >= tier.minHoursBeforeStart,
    ) ?? NO_SHOW_TIER
  );
}

export interface CancellationOutcome {
  tier: CancellationTier;
  refundAmount: number;
  vendorCompensationAmount: number;
}

export function computeCancellationOutcome(params: {
  amount: number;
  appointmentStart: Date;
  cancelledAt: Date;
  cancelledByRole: 'CLIENT' | 'VENDOR';
}): CancellationOutcome {
  const { amount, appointmentStart, cancelledAt, cancelledByRole } = params;

  if (cancelledByRole === 'VENDOR') {
    return {
      tier: VENDOR_CANCELLATION_TIER,
      refundAmount: Math.round(
        amount * VENDOR_CANCELLATION_TIER.clientRefundPercentage,
      ),
      vendorCompensationAmount: 0,
    };
  }

  const hoursUntilStart =
    (appointmentStart.getTime() - cancelledAt.getTime()) / (60 * 60 * 1000);
  const tier = getClientCancellationTier(hoursUntilStart);

  return {
    tier,
    refundAmount: Math.round(amount * tier.clientRefundPercentage),
    vendorCompensationAmount: Math.round(
      amount * tier.vendorCompensationPercentage,
    ),
  };
}
