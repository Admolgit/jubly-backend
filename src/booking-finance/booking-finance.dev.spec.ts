/** Opt-in MongoDB replica-set concurrency checks. Only disposable jublyDev
 * fixtures are written; Paystack is always a stub. Never use a real API client. */
import { randomBytes } from 'crypto';
import { config } from 'dotenv';
import { PrismaService } from 'prisma/prisma.service';
import { BookingFinanceService } from './booking-finance.service';

const enabled = process.env.JUBLY_FINANCE_DEV_INTEGRATION === 'true';
const suite = enabled ? describe : describe.skip;
const id = () => randomBytes(12).toString('hex');

suite('Booking finance on jublyDev MongoDB', () => {
  let prisma: PrismaService;
  let first: BookingFinanceService;
  let second: BookingFinanceService;
  let gateway: any;
  let policies: any;
  let previousDispatch: string | undefined;
  const bookings: string[] = [];
  const vendors: string[] = [];
  const services: string[] = [];
  const charges = new Map<string, any>();
  const refunds: any[] = [];
  const transfers = new Map<string, any>();
  let refundStatus = 'processed';

  beforeAll(async () => {
    config({ quiet: true });
    if (
      new URL(process.env.DATABASE_URL!).pathname !== '/jublyDev' ||
      process.env.NODE_ENV === 'production'
    ) {
      throw new Error('Integration checks are restricted to jublyDev');
    }
    previousDispatch = process.env.JUBLY_FINANCIAL_DISPATCH_ENABLED;
    process.env.JUBLY_FINANCIAL_DISPATCH_ENABLED = 'true';
    prisma = new PrismaService();
    await prisma.$connect();
    gateway = {
      verifyTransaction: jest.fn(async (reference: string) => ({
        data: charges.get(reference),
      })),
      listRefunds: jest.fn(async (transactionId: string) =>
        refunds.filter((r) => String(r.transaction.id) === transactionId),
      ),
      listTransactionDisputes: jest.fn(async () => []),
      createRefund: jest.fn(async (payload: any) => {
        const charge = charges.get(payload.transaction);
        const refund = {
          id: refunds.length + 1,
          transaction: { id: charge.id, reference: charge.reference },
          amount: Math.round(payload.amount * 100),
          currency: 'NGN',
          status: refundStatus,
          merchant_note: payload.merchantNote,
        };
        refunds.push(refund);
        return refund;
      }),
      fetchRefund: jest.fn(async (providerId: string) =>
        refunds.find((r) => String(r.id) === providerId),
      ),
      createTransferRecipient: jest.fn(async () => ({
        recipient_code: 'TEST_RECIPIENT',
      })),
      initiateTransfer: jest.fn(async (payload: any) => {
        const transfer = {
          reference: payload.reference,
          amount: Math.round(payload.amount * 100),
          currency: 'NGN',
          recipient: { recipient_code: payload.recipientCode },
          status: 'success',
          transfer_code: `TEST_${payload.reference}`,
        };
        transfers.set(payload.reference, transfer);
        return transfer;
      }),
      verifyTransfer: jest.fn(
        async (reference: string) => transfers.get(reference) ?? null,
      ),
    };
    policies = {
      getFinancialPolicySnapshot: jest.fn(async () => ({
        policyId: 'test-policy',
        policyUpdatedAt: null,
        tiers: [
          {
            label: 'Fixture policy',
            minHoursBeforeStart: 0,
            clientRefundPercentage: 0.63,
            vendorCompensationPercentage: 0.37,
          },
        ],
        noShowPolicy: {
          clientRefundPercentage: 0,
          vendorCompensationPercentage: 1,
        },
      })),
    };
    first = new BookingFinanceService(prisma, gateway, policies);
    second = new BookingFinanceService(prisma, gateway, policies);
  });

  async function fixture() {
    const vendorId = id();
    vendors.push(vendorId);
    await prisma.vendor.create({
      data: {
        id: vendorId,
        userId: id(),
        businessName: 'FINANCE_TEST_ONLY',
        category: 'TEST',
        city: 'TEST',
        state: 'TEST',
        portfolioImages: [],
        bankAccountNumber: '0000000000',
        bankCode: 'TEST',
      },
    });
    const bookingId = id();
    bookings.push(bookingId);
    const serviceId = id();
    services.push(serviceId);
    await prisma.service.create({
      data: { id: serviceId, userId: id(), vendorId, name: 'FINANCE_TEST_ONLY', price: 20_000 },
    });
    const booking = await prisma.booking.create({
      data: {
        id: bookingId,
        vendorId,
        serviceId,
        name: 'FINANCE_TEST_ONLY',
        clientEmail: 'finance-fixture@example.invalid',
        status: 'CONFIRMED',
        date: new Date('2099-01-01'),
        startTime: new Date('2099-01-01T12:00:00Z'),
        endTime: new Date('2099-01-01T13:00:00Z'),
        paymentMethod: 'PAYSTACK',
      },
    });
    const reference = `TEST_FINANCE_${id()}`;
    const charge = {
      id: charges.size + 1000,
      reference,
      amount: 2_040_000,
      currency: 'NGN',
      status: 'success',
      metadata: { vendorId, serviceId, bookingId },
    };
    charges.set(reference, charge);
    const payment = await prisma.transaction.create({
      data: {
        vendorId,
        bookingId,
        amount: 20_000,
        providerRef: reference,
        status: 'PENDING',
        ...first.checkoutSnapshot(20_000, 20_400, 0.08, {
          vendorId,
          serviceId,
          bookingId,
        }),
      },
    });
    return { booking, payment, charge };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    refundStatus = 'processed';
  });

  afterAll(async () => {
    if (prisma) {
      // Delete only IDs created by this suite; never historical development data.
      await prisma.settlement.deleteMany({
        where: { bookingId: { in: bookings } },
      });
      await prisma.transaction.deleteMany({
        where: { bookingId: { in: bookings } },
      });
      await prisma.booking.deleteMany({ where: { id: { in: bookings } } });
      await prisma.service.deleteMany({ where: { id: { in: services } } });
      await prisma.vendor.deleteMany({ where: { id: { in: vendors } } });
      await prisma.$disconnect();
    }
    if (previousDispatch === undefined)
      delete process.env.JUBLY_FINANCIAL_DISPATCH_ENABLED;
    else process.env.JUBLY_FINANCIAL_DISPATCH_ENABLED = previousDispatch;
  });

  it('freezes one cancellation and dispatches one refund and one compensation across instances', async () => {
    const { booking, payment } = await fixture();
    const decisions = await Promise.all([
      first.cancel(booking.id, 'client', 'CLIENT'),
      second.cancel(booking.id, 'client', 'CLIENT'),
    ]);
    expect(decisions.filter((r) => r.changed)).toHaveLength(1);
    expect(
      await prisma.settlement.count({ where: { bookingId: booking.id } }),
    ).toBe(1);
    await Promise.all([
      first.processBooking(booking.id),
      second.processBooking(booking.id),
    ]);
    const current = await prisma.transaction.findUniqueOrThrow({
      where: { id: payment.id },
    });
    const settlement = await prisma.settlement.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    expect(current.refundState).toBe('SUCCESS');
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
    expect(gateway.createRefund.mock.calls[0][0].amount).toBe(12600);
    expect(gateway.initiateTransfer).toHaveBeenCalledTimes(1);
    expect(settlement.netTransferKobo).toBe(BigInt(680800));
    expect(
      settlement.refundAllocationKobo! +
        settlement.netTransferKobo! +
        settlement.commissionKobo!,
    ).toBe(settlement.principalKobo);
    await first.cancel(booking.id, 'client', 'CLIENT');
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
  }, 30000);

  it('does not release compensation until a pending refund has been confirmed', async () => {
    const { booking, payment } = await fixture();
    refundStatus = 'pending';
    await first.cancel(booking.id, 'client', 'CLIENT');
    await first.processBooking(booking.id);
    expect(gateway.initiateTransfer).not.toHaveBeenCalled();
    const refund = refunds.find(
      (r) => r.transaction.reference === payment.providerRef,
    )!;
    refund.status = 'processed';
    await first.handleWebhook('refund.processed', {
      transaction_reference: payment.providerRef,
      refund_reference: null,
    });
    await first.handleWebhook('refund.pending', {
      transaction_reference: payment.providerRef,
      refund_reference: null,
    });
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
    expect(gateway.initiateTransfer).toHaveBeenCalledTimes(1);
    expect(
      (
        await prisma.transaction.findUniqueOrThrow({
          where: { id: payment.id },
        })
      ).refundState,
    ).toBe('SUCCESS');
  }, 30000);

  it('reconciles a lost refund response using its durable operation marker without resubmission', async () => {
    const { booking, payment } = await fixture();
    const realMock = gateway.createRefund.getMockImplementation();
    gateway.createRefund.mockImplementationOnce(async (payload: any) => {
      await realMock(payload);
      throw new Error('ECONNRESET');
    });
    await first.cancel(booking.id, 'client', 'CLIENT');
    await first.processBooking(booking.id);
    expect(
      (
        await prisma.transaction.findUniqueOrThrow({
          where: { id: payment.id },
        })
      ).refundState,
    ).toBe('REQUIRES_VERIFICATION');
    expect(gateway.initiateTransfer).not.toHaveBeenCalled();
    await second.processBooking(booking.id);
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
    expect(gateway.initiateTransfer).toHaveBeenCalledTimes(1);
  }, 30000);

  it('blocks an unknown refund with no provider match instead of creating another', async () => {
    const { booking, payment } = await fixture();
    gateway.createRefund.mockRejectedValueOnce(new Error('timeout'));
    await first.cancel(booking.id, 'client', 'CLIENT');
    await first.processBooking(booking.id);
    await second.processBooking(booking.id);
    await first.processBooking(booking.id);
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
    expect(gateway.initiateTransfer).not.toHaveBeenCalled();
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .financialMode,
    ).toBe('REVIEW');
    expect(
      (
        await prisma.transaction.findUniqueOrThrow({
          where: { id: payment.id },
        })
      ).refundState,
    ).toBe('REQUIRES_VERIFICATION');
  }, 30000);

  it('replaces a definitely undispatched completion allocation with cancellation', async () => {
    const { booking } = await fixture();
    process.env.JUBLY_FINANCIAL_DISPATCH_ENABLED = 'false';
    await first.settleCompletion(booking.id);
    const before = await prisma.settlement.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    await second.cancel(booking.id, 'client', 'CLIENT');
    const after = await prisma.settlement.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    process.env.JUBLY_FINANCIAL_DISPATCH_ENABLED = 'true';
    expect(after.id).toBe(before.id);
    expect(after.financialVersion).toBe(before.financialVersion! + 1);
    expect(after.purpose).toBe('CANCELLATION_COMPENSATION');
    await expect(first.settleCompletion(booking.id)).rejects.toThrow();
    await first.processBooking(booking.id);
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
  }, 30000);

  it('does not refund a cancellation that races a dispatched completion transfer', async () => {
    const { booking } = await fixture();
    gateway.initiateTransfer.mockRejectedValueOnce(
      new Error('timeout after dispatch'),
    );
    await first.settleCompletion(booking.id);
    await second.cancel(booking.id, 'client', 'CLIENT');
    await first.processBooking(booking.id);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .financialMode,
    ).toBe('REVIEW');
    expect(gateway.createRefund).not.toHaveBeenCalled();
    expect(gateway.initiateTransfer).toHaveBeenCalledTimes(1);
  }, 30000);

  it('allows only a compatible allocation when completion and cancellation start together', async () => {
    const { booking } = await fixture();
    await Promise.allSettled([
      first.settleCompletion(booking.id),
      second.cancel(booking.id, 'client', 'CLIENT'),
    ]);
    const current = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    if (!['CANCELLED_BY_CLIENT', 'COMPLETED'].includes(current.status))
      await second.cancel(booking.id, 'client', 'CLIENT');
    await first.processBooking(booking.id);
    const plan = await prisma.settlement.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    if (gateway.createRefund.mock.calls.length)
      expect(plan.purpose).toBe('CANCELLATION_COMPENSATION');
    if (plan.purpose === 'NORMAL_COMPLETION')
      expect(gateway.createRefund).not.toHaveBeenCalled();
    expect(gateway.initiateTransfer.mock.calls.length).toBeLessThanOrEqual(1);
  }, 30000);

  it('uses vendor cancellation rules and retains the zero-payout settlement claim', async () => {
    const { booking } = await fixture();
    await Promise.all([
      first.cancel(booking.id, 'vendor', 'VENDOR'),
      second.cancel(booking.id, 'vendor', 'VENDOR'),
    ]);
    await first.processBooking(booking.id);
    expect(gateway.createRefund.mock.calls[0][0].amount).toBe(20_000);
    expect(gateway.initiateTransfer).not.toHaveBeenCalled();
    expect(
      (
        await prisma.vendor.findUniqueOrThrow({
          where: { id: booking.vendorId },
        })
      ).cancellationStrikes,
    ).toBe(1);
    expect(
      (
        await prisma.settlement.findUniqueOrThrow({
          where: { bookingId: booking.id },
        })
      ).operationState,
    ).toBe('NOT_REQUIRED');
  }, 30000);

  it('prevents two completion workers from paying the same booking', async () => {
    const { booking } = await fixture();
    await Promise.allSettled([
      first.settleCompletion(booking.id),
      second.settleCompletion(booking.id),
    ]);
    await second.processBooking(booking.id);
    expect(gateway.initiateTransfer).toHaveBeenCalledTimes(1);
    expect(
      await prisma.settlement.count({ where: { bookingId: booking.id } }),
    ).toBe(1);
  }, 30000);

  it('reconciles an accepted transfer after a lost response without sending it again', async () => {
    const { booking } = await fixture();
    const submit = gateway.initiateTransfer.getMockImplementation();
    gateway.initiateTransfer.mockImplementationOnce(async (payload: any) => {
      await submit(payload);
      throw new Error('Process lost response after provider acceptance');
    });
    await first.settleCompletion(booking.id);
    await second.processBooking(booking.id);
    expect(gateway.initiateTransfer).toHaveBeenCalledTimes(1);
    expect(
      (
        await prisma.settlement.findUniqueOrThrow({
          where: { bookingId: booking.id },
        })
      ).operationState,
    ).toBe('SUCCESS');
  }, 30000);

  it('does not let cancellation issue a refund while a completion HTTP request is in flight', async () => {
    const { booking } = await fixture();
    let release!: () => void;
    let started!: () => void;
    const submitted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const submit = gateway.initiateTransfer.getMockImplementation();
    gateway.initiateTransfer.mockImplementationOnce(async (payload: any) => {
      started();
      await resume;
      return submit(payload);
    });
    const completion = first
      .settleCompletion(booking.id)
      .catch((error) => error);
    await submitted;
    try {
      await second.cancel(booking.id, 'client', 'CLIENT');
    } finally {
      release();
    }
    await completion;
    await second.processBooking(booking.id);
    expect(gateway.createRefund).not.toHaveBeenCalled();
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .financialMode,
    ).toBe('REVIEW');
  }, 30000);

  it('keeps old attempts and blocks a contradictory late success after a confirmed-failure retry', async () => {
    const { booking } = await fixture();
    const submit = gateway.initiateTransfer.getMockImplementation();
    gateway.initiateTransfer.mockImplementationOnce(async (payload: any) => {
      const transfer = await submit(payload);
      transfer.status = 'failed';
      return transfer;
    });
    await first.settleCompletion(booking.id);
    const old = await prisma.settlement.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    await Promise.all([
      first.processBooking(booking.id),
      second.processBooking(booking.id),
    ]);
    await second.processBooking(booking.id);
    const current = await prisma.settlement.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    expect(current.reference).not.toBe(old.reference);
    expect(current.operationState).toBe('SUCCESS');
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .financialMode,
    ).toBe('COMPLETION');
    await first.handleWebhook('transfer.success', { reference: old.reference });
    const after = await prisma.settlement.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    expect(after.reference).toBe(current.reference);
    expect(after.operationState).toBe('SUCCESS');
    expect(after.attemptHistory).toHaveLength(2);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
        .financialMode,
    ).toBe('REVIEW');
  }, 30000);

  it('does not recalculate a cancellation after the administrator changes policy', async () => {
    const { booking } = await fixture();
    await first.cancel(booking.id, 'client', 'CLIENT');
    const original = await prisma.settlement.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    policies.getFinancialPolicySnapshot.mockResolvedValueOnce({
      policyId: 'changed-policy',
      policyUpdatedAt: null,
      tiers: [
        {
          label: 'New policy',
          minHoursBeforeStart: 0,
          clientRefundPercentage: 0.1,
          vendorCompensationPercentage: 0.9,
        },
      ],
      noShowPolicy: {
        clientRefundPercentage: 0,
        vendorCompensationPercentage: 1,
      },
    });
    // Retry does not consult the changed policy. The next new cancellation does.
    await second.cancel(booking.id, 'client', 'CLIENT');
    expect(
      (
        await prisma.settlement.findUniqueOrThrow({
          where: { bookingId: booking.id },
        })
      ).policySnapshot,
    ).toEqual(original.policySnapshot);
    const next = await fixture();
    const result = await first.cancel(next.booking.id, 'client', 'CLIENT');
    expect(result.booking.refundAmount).toBe(2000);
  }, 30000);

  it('does not create a refund when the configured client allocation is zero', async () => {
    const { booking } = await fixture();
    await prisma.booking.update({
      where: { id: booking.id },
      data: { startTime: new Date('2020-01-01') },
    });
    await first.cancel(booking.id, 'client', 'CLIENT');
    await first.processBooking(booking.id);
    expect(gateway.createRefund).not.toHaveBeenCalled();
    expect(gateway.initiateTransfer).toHaveBeenCalledTimes(1);
  }, 30000);

  it('does not let a stale automatic-completion job settle a request rejected during verification', async () => {
    const { booking } = await fixture();
    const pending = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: 'COMPLETION_PENDING_APPROVAL',
        completionRequestedAt: new Date('2020-01-01'),
      },
    });
    let started!: () => void;
    let release!: () => void;
    const verifying = new Promise<void>((resolve) => {
      started = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verify = gateway.verifyTransaction.getMockImplementation();
    gateway.verifyTransaction.mockImplementationOnce(
      async (reference: string) => {
        started();
        await resume;
        return verify(reference);
      },
    );
    const result = first
      .settleCompletion(booking.id, pending)
      .catch((error) => error);
    await verifying;
    try {
      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'CONFIRMED', completionRejectedAt: new Date() },
      });
    } finally {
      release();
    }
    expect(await result).toBeInstanceOf(Error);
    expect(
      await prisma.settlement.count({ where: { bookingId: booking.id } }),
    ).toBe(0);
    expect(gateway.initiateTransfer).not.toHaveBeenCalled();
  }, 30000);

  it('requires review for missing historical snapshots rather than using service price', async () => {
    const { booking, payment } = await fixture();
    await prisma.transaction.update({
      where: { id: payment.id },
      data: { checkoutSnapshot: null, servicePrincipalKobo: null },
    });
    const result = await first.cancel(booking.id, 'client', 'CLIENT');
    await first.processBooking(booking.id);
    expect(result.booking.financialMode).toBe('REVIEW');
    expect(result.booking.refundAmount).toBeNull();
    expect(gateway.createRefund).not.toHaveBeenCalled();
    expect(gateway.initiateTransfer).not.toHaveBeenCalled();
  }, 30000);
});
