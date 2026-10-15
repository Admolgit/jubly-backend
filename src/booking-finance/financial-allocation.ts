import { calculateJublyCommission } from '../utils/paystackCalculation';
import { computeCancellationOutcome } from '../reschedule/cancellation-policy.util';

export function kobo(naira: number): number {
  const value = Math.round(naira * 100);
  if (!Number.isFinite(naira) || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid monetary amount');
  }
  return value;
}

export function exactKobo(value: bigint | number): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Unrepresentable monetary amount');
  }
  return amount;
}

export function vendorAllocation(gross: number, rate: number) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error('Invalid captured commission rate');
  }
  // Keep the existing net-payout rounding and commission cap implementation.
  const net = kobo(gross / 100 - calculateJublyCommission(gross / 100, rate));
  return { net, commission: gross - net };
}

export function cancellationAllocation(
  params: Parameters<typeof computeCancellationOutcome>[0],
  rate: number,
) {
  const outcome = computeCancellationOutcome(params);
  const {
    clientRefundPercentage: refundRate,
    vendorCompensationPercentage: vendorRate,
  } = outcome.tier;
  if (
    ![refundRate, vendorRate].every(
      (r) => Number.isFinite(r) && r >= 0 && r <= 1,
    ) ||
    refundRate + vendorRate > 1
  ) {
    throw new Error('Configured cancellation allocations exceed the principal');
  }
  const refund = exactKobo(outcome.refundAmount);
  const gross = exactKobo(outcome.vendorCompensationAmount);
  // Do not invent a rounding priority when independently rounded allocations
  // exceed the budget by a kobo. Such a cancellation needs financial review.
  if (refund + gross > params.amount)
    throw new Error('Cancellation rounding exceeds the principal');
  return { ...outcome, refund, gross, ...vendorAllocation(gross, rate) };
}
