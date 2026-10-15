import {
  cancellationAllocation,
  kobo,
  vendorAllocation,
} from './financial-allocation';
import { calculateJublyCommission } from '../utils/paystackCalculation';
import { publicFinancialResponse } from './financial-response.interceptor';

const params = {
  amount: 2_000_000,
  appointmentStart: new Date('2026-10-01T12:00:00Z'),
  cancelledAt: new Date('2026-10-01T09:00:00Z'),
  cancelledByRole: 'CLIENT' as const,
  tiers: [
    {
      label: 'Custom admin policy',
      minHoursBeforeStart: 0,
      clientRefundPercentage: 0.63,
      vendorCompensationPercentage: 0.37,
    },
  ],
};

describe('Cancellation financial allocation', () => {
  it('uses configured allocations rather than default cancellation percentages', () => {
    const result = cancellationAllocation(params, 0.08);
    expect(result.refund).toBe(1_260_000);
    expect(result.gross).toBe(740_000);
    expect(result.refund + result.net + result.commission).toBe(params.amount);
  });

  it('preserves the existing vendor-cancellation policy regardless of client tiers', () => {
    expect(
      cancellationAllocation({ ...params, cancelledByRole: 'VENDOR' }, 0.08),
    ).toMatchObject({ refund: params.amount, gross: 0, net: 0, commission: 0 });
  });

  it('uses the configured no-show policy after the start', () => {
    expect(
      cancellationAllocation(
        {
          ...params,
          cancelledAt: new Date('2026-10-01T13:00:00Z'),
          noShowPolicy: {
            clientRefundPercentage: 0.2,
            vendorCompensationPercentage: 0.8,
          },
        },
        0.08,
      ),
    ).toMatchObject({ refund: 400_000, gross: 1_600_000 });
  });

  it('preserves the existing commission function including its cap', () => {
    const gross = kobo(5_000_000);
    const result = vendorAllocation(gross, 0.12);
    expect(result.commission).toBe(
      kobo(calculateJublyCommission(gross / 100, 0.12)),
    );
    expect(result.net + result.commission).toBe(gross);
  });

  it('blocks over-budget configuration instead of increasing the payout budget', () => {
    expect(() =>
      cancellationAllocation(
        {
          ...params,
          tiers: [
            {
              ...params.tiers[0],
              clientRefundPercentage: 0.8,
              vendorCompensationPercentage: 0.4,
            },
          ],
        },
        0.08,
      ),
    ).toThrow(/exceed/);
  });

  it('requires review if existing independent rounding exceeds the kobo budget', () => {
    expect(() =>
      cancellationAllocation(
        {
          ...params,
          amount: 1,
          tiers: [
            {
              ...params.tiers[0],
              clientRefundPercentage: 0.5,
              vendorCompensationPercentage: 0.5,
            },
          ],
        },
        0.08,
      ),
    ).toThrow(/rounding/);
  });

  it('rejects unsafe amounts and invalid commission rates', () => {
    expect(() => kobo(Infinity)).toThrow();
    expect(() => kobo(Number.MAX_SAFE_INTEGER)).toThrow();
    expect(() => vendorAllocation(100, NaN)).toThrow();
  });
});

describe('Existing HTTP response contracts', () => {
  it('removes only the added model fields, including nested financial records', () => {
    const now = new Date();
    const response = {
      status: 200,
      message: 'ok',
      meta: null,
      data: {
        id: 'booking',
        status: 'CANCELLED_BY_CLIENT',
        createdAt: now,
        refundAmount: 12,
        financialMode: 'CANCELLATION',
        financialVersion: 1,
        financialReviewReason: null,
        Transaction: [
          {
            id: 'payment',
            amount: 20,
            currency: 'NGN',
            servicePrincipalKobo: BigInt(2000),
            refundOperation: {},
          },
        ],
      },
    };
    const result = publicFinancialResponse(response);
    expect(result).toEqual({
      status: 200,
      message: 'ok',
      meta: null,
      data: {
        id: 'booking',
        status: 'CANCELLED_BY_CLIENT',
        createdAt: now,
        refundAmount: 12,
        Transaction: [{ id: 'payment', amount: 20, currency: 'NGN' }],
      },
    });
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(response.data.financialMode).toBe('CANCELLATION');
  });

  it('leaves provider refund payloads untouched', () => {
    const provider = {
      id: 12,
      status: 'processed',
      amount: 1200,
      currency: 'NGN',
      transaction: { id: 2, reference: 'ref' },
    };
    expect(publicFinancialResponse(provider)).toEqual(provider);
  });
});
