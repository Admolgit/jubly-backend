import { computeCancellationOutcome } from './cancellation-policy.util';

const HOUR = 60 * 60 * 1000;

function cancelAt(hoursBeforeStart: number, amount = 20000) {
  const appointmentStart = new Date('2026-01-01T12:00:00.000Z');
  const cancelledAt = new Date(
    appointmentStart.getTime() - hoursBeforeStart * HOUR,
  );

  return computeCancellationOutcome({
    amount,
    appointmentStart,
    cancelledAt,
    cancelledByRole: 'CLIENT',
  });
}

describe('computeCancellationOutcome', () => {
  it('gives a full refund 24+ hours before the appointment', () => {
    expect(cancelAt(30).tier.label).toBe('24+ hours before');
    expect(cancelAt(24)).toMatchObject({
      refundAmount: 20000,
      vendorCompensationAmount: 0,
    });
  });

  it('gives a 90%/10% split 12-24 hours before the appointment', () => {
    expect(cancelAt(23.99).tier.label).toBe('12-24 hours before');
    expect(cancelAt(12)).toMatchObject({
      refundAmount: 18000,
      vendorCompensationAmount: 2000,
    });
  });

  it('gives a 75%/25% split 2-12 hours before the appointment', () => {
    expect(cancelAt(11.99).tier.label).toBe('2-12 hours before');
    expect(cancelAt(2)).toMatchObject({
      refundAmount: 15000,
      vendorCompensationAmount: 5000,
    });
  });

  it('gives a 50%/50% split 1-2 hours before the appointment', () => {
    expect(cancelAt(1.99).tier.label).toBe('1-2 hours before');
    expect(cancelAt(1)).toMatchObject({
      refundAmount: 10000,
      vendorCompensationAmount: 10000,
    });
  });

  it('gives a 25%/75% split less than 1 hour before the appointment', () => {
    expect(cancelAt(0.99).tier.label).toBe('Less than 1 hour before');
    expect(cancelAt(0.5)).toMatchObject({
      refundAmount: 5000,
      vendorCompensationAmount: 15000,
    });
  });

  it('gives no refund after the appointment time / no-show', () => {
    expect(cancelAt(0)).toMatchObject({
      refundAmount: 0,
      vendorCompensationAmount: 20000,
    });
    expect(cancelAt(-1).tier.label).toBe('After appointment time / no-show');
  });

  it('always gives a full refund and no vendor compensation when the vendor cancels', () => {
    const appointmentStart = new Date('2026-01-01T12:00:00.000Z');

    const outcomes = [30, 5, 0.5, -2].map((hoursBeforeStart) =>
      computeCancellationOutcome({
        amount: 20000,
        appointmentStart,
        cancelledAt: new Date(
          appointmentStart.getTime() - hoursBeforeStart * HOUR,
        ),
        cancelledByRole: 'VENDOR',
      }),
    );

    for (const outcome of outcomes) {
      expect(outcome.tier.label).toBe('Vendor cancellation');
      expect(outcome.refundAmount).toBe(20000);
      expect(outcome.vendorCompensationAmount).toBe(0);
    }
  });
});
