import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  Booking,
  BookingStatus,
  Prisma,
  Settlement,
  Transaction,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from 'prisma/prisma.service';
import { CancellationPolicyService } from '../cancellation-policy/cancellation-policy.service';
import { PaystackService } from '../paystack/paystack.service';
import {
  cancellationAllocation,
  exactKobo,
  kobo,
  vendorAllocation,
} from './financial-allocation';

type RefundInstruction = {
  id: string;
  version: number;
  amountKobo: string;
  currency: string;
  reference: string;
  state: string;
  createdAt: string;
  dispatchedAt?: string;
  providerId?: string;
  providerState?: string;
  response?: any;
  attempts: Array<{
    id: string;
    dispatchedAt: string;
    state: string;
    checkedAt?: string;
  }>;
};
const cancelled: BookingStatus[] = [
  'CANCELLED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_VENDOR',
];
const active: BookingStatus[] = ['CONFIRMED', 'COMPLETION_PENDING_APPROVAL'];
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint' ? item.toString() : item,
    ),
  );
const nextCheck = () => new Date(Date.now() + 60_000);

@Injectable()
export class BookingFinanceService {
  private readonly logger = new Logger(BookingFinanceService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly policies: CancellationPolicyService,
  ) {}

  // Explicit rollout gate: enable only after ALL old payout/refund processes
  // have been replaced. A database claim cannot fence an old binary.
  private get dispatchEnabled() {
    return process.env.JUBLY_FINANCIAL_DISPATCH_ENABLED === 'true';
  }

  checkoutSnapshot(
    principal: number,
    gross: number,
    rate: number,
    identity: {
      vendorId: string;
      serviceId: string;
      bookingId?: string;
    },
  ) {
    const principalKobo = kobo(principal);
    const grossKobo = kobo(gross);
    vendorAllocation(principalKobo, rate);
    if (grossKobo < principalKobo)
      throw new ConflictException('Invalid checkout amount');
    return {
      servicePrincipalKobo: BigInt(principalKobo),
      expectedGrossChargeKobo: BigInt(grossKobo),
      processingMarkupKobo: BigInt(grossKobo - principalKobo),
      percentageFee: rate,
      paymentEvidenceState: 'AWAITING_VERIFICATION',
      checkoutSnapshot: json({
        ...identity,
        currency: 'NGN',
        commissionRate: rate,
        capturedAt: new Date().toISOString(),
      }),
    };
  }

  private validateCharge(payment: Transaction, charge: any) {
    const snapshot = payment.checkoutSnapshot as any;
    if (
      !snapshot ||
      payment.servicePrincipalKobo == null ||
      payment.expectedGrossChargeKobo == null ||
      payment.processingMarkupKobo == null ||
      payment.percentageFee == null ||
      !payment.providerRef ||
      payment.providerRef.startsWith('MANUAL-')
    ) {
      throw new Error('Payment has no trustworthy checkout snapshot');
    }
    const principal = exactKobo(payment.servicePrincipalKobo);
    const gross = exactKobo(payment.expectedGrossChargeKobo);
    if (
      !principal ||
      kobo(payment.amount) !== principal ||
      gross - principal !== exactKobo(payment.processingMarkupKobo) ||
      snapshot.vendorId !== payment.vendorId ||
      snapshot.currency !== 'NGN' ||
      payment.currency !== 'NGN' ||
      snapshot.commissionRate !== payment.percentageFee ||
      charge?.status !== 'success' ||
      charge.reference !== payment.providerRef ||
      charge.currency !== 'NGN' ||
      !Number.isSafeInteger(charge.amount) ||
      charge.amount !== gross ||
      !charge.id ||
      !Number.isSafeInteger(Number(charge.id)) ||
      charge.metadata?.vendorId !== payment.vendorId ||
      charge.metadata?.serviceId !== snapshot.serviceId ||
      (snapshot.bookingId &&
        charge.metadata?.bookingId !== snapshot.bookingId) ||
      (payment.providerTransactionId &&
        String(charge.id) !== payment.providerTransactionId)
    ) {
      throw new Error('Payment evidence does not match the original checkout');
    }
    return principal;
  }

  // Called for verified charge events/reconciliation BEFORE booking fulfillment.
  // Legacy checkouts can still fulfill existing booking behavior, but never gain
  // invented financial evidence or permission to move money automatically.
  async recordVerifiedCharge(reference: string, charge?: any) {
    const payment = await this.prisma.transaction.findUnique({
      where: { providerRef: reference },
    });
    if (!payment)
      throw new ConflictException('Transaction was not initialized');
    if (!payment.checkoutSnapshot) return;
    const verified =
      charge ?? (await this.paystack.verifyTransaction(reference)).data;
    try {
      this.validateCharge(payment, verified);
    } catch (error) {
      await this.prisma.transaction.update({
        where: { id: payment.id },
        data: { paymentEvidenceState: 'REQUIRES_REVIEW' },
      });
      throw new ConflictException('Payment evidence requires financial review');
    }
    await this.prisma.transaction.updateMany({
      where: { id: payment.id, updatedAt: payment.updatedAt },
      data: {
        paymentEvidenceState: 'VERIFIED',
        paymentVerifiedAt: new Date(),
        providerTransactionId: String(verified.id),
        verifiedChargedAmountKobo: BigInt(verified.amount),
      },
    });
  }

  private async evidence(booking: Booking) {
    if (booking.paymentMethod === 'PAID_BY_HAND')
      throw new Error('Cash payment requires manual financial handling');
    const payments = await this.prisma.transaction.findMany({
      where: { bookingId: booking.id },
    });
    if (payments.length !== 1)
      throw new Error('Missing or ambiguous booking payment');
    const payment = payments[0];
    if (
      payment.vendorId !== booking.vendorId ||
      (payment.checkoutSnapshot as any)?.serviceId !== booking.serviceId ||
      ((payment.checkoutSnapshot as any)?.bookingId &&
        (payment.checkoutSnapshot as any).bookingId !== booking.id) ||
      payment.paymentEvidenceState === 'REQUIRES_REVIEW'
    )
      throw new Error('Payment identity requires review');
    const charge = (await this.paystack.verifyTransaction(payment.providerRef))
      .data;
    const principal = this.validateCharge(payment, charge);
    const [refunds, disputes] = await Promise.all([
      this.paystack.listRefunds(String(charge.id)),
      this.paystack.listTransactionDisputes(String(charge.id)),
    ]);
    if (
      refunds.length ||
      disputes.length ||
      payment.refundOperation ||
      ['REFUNDED', 'REFUND_PENDING', 'REVERSED'].includes(
        payment.status.toUpperCase(),
      )
    ) {
      throw new Error('Existing refund, reversal or dispute requires review');
    }
    return { payment, principal, charge };
  }

  private async atomic<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(work);
      } catch (error) {
        if (error.code === 'P2034' && attempt < 3) continue;
        if (error.code === 'P2034' || error.code === 'P2002')
          throw new ConflictException(
            'Financial decision changed; retry the request',
          );
        throw error;
      }
    }
  }

  private async touch(
    tx: Prisma.TransactionClient,
    booking: Booking,
    data: Prisma.BookingUpdateManyMutationInput = {},
  ) {
    const result = await tx.booking.updateMany({
      where: {
        id: booking.id,
        updatedAt: booking.updatedAt,
        status: booking.status,
      },
      data: {
        ...data,
        updatedAt: new Date(
          Math.max(Date.now(), booking.updatedAt.getTime() + 1),
        ),
      },
    });
    if (result.count !== 1)
      throw new ConflictException('Booking changed; retry the request');
  }

  async review(bookingId: string, reason: string) {
    await this.atomic(async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      await this.touch(tx, booking, {
        financialMode: 'REVIEW',
        financialReviewReason: reason,
      });
    });
  }

  async cancel(
    bookingId: string,
    userId: string,
    role: 'CLIENT' | 'VENDOR',
    reason?: string,
  ) {
    const original = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    if (cancelled.includes(original.status)) {
      if (!original.financialMode)
        await this.review(
          bookingId,
          'Historical cancellation has no verified financial allocation',
        );
      return {
        booking: await this.prisma.booking.findUniqueOrThrow({
          where: { id: bookingId },
        }),
        changed: false,
      };
    }
    if (original.status === 'COMPLETED')
      throw new ConflictException('Completed bookings cannot be cancelled');
    const cancelledAt = new Date();
    const policy = await this.policies.getFinancialPolicySnapshot();
    let evidence:
      | Awaited<ReturnType<BookingFinanceService['evidence']>>
      | undefined;
    let allocation: ReturnType<typeof cancellationAllocation> | undefined;
    let servicePriceKobo: number | undefined;
    let reviewReason: string | undefined;
    try {
      evidence = await this.evidence(original);
      const service = await this.prisma.service.findUniqueOrThrow({
        where: { id: original.serviceId },
        select: { price: true },
      });
      servicePriceKobo = kobo(service.price);
      allocation = cancellationAllocation(
        {
          amount: servicePriceKobo,
          appointmentStart: original.startTime,
          cancelledAt,
          cancelledByRole: role,
          tiers: policy.tiers,
          noShowPolicy: policy.noShowPolicy,
        },
        evidence.payment.percentageFee!,
      );
      if (allocation.refund + allocation.gross > evidence.principal) {
        throw new Error(
          'Service-price cancellation allocation exceeds the verified payment budget',
        );
      }
    } catch (error) {
      reviewReason =
        error instanceof Error ? error.message : 'Payment evidence unavailable';
    }
    return this.atomic(async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      if (cancelled.includes(booking.status))
        return { booking, changed: false };
      if (booking.status === 'COMPLETED')
        throw new ConflictException('Completed bookings cannot be cancelled');
      if (booking.startTime.getTime() !== original.startTime.getTime())
        throw new ConflictException(
          'Booking schedule changed; retry cancellation',
        );
      const settlement = await tx.settlement.findUnique({
        where: { bookingId },
      });
      // PENDING means definitely undispatched only for our new, versioned records.
      const replaceable =
        settlement?.purpose === 'NORMAL_COMPLETION' &&
        settlement.operationState === 'PENDING' &&
        !settlement.dispatchStartedAt &&
        Array.isArray(settlement.attemptHistory) &&
        !settlement.attemptHistory.length;
      const blocked =
        (settlement && !replaceable) || booking.financialMode === 'REVIEW';
      const financialReviewReason = blocked
        ? 'Existing vendor payout/financial decision requires reconciliation'
        : reviewReason;
      const version = (booking.financialVersion ?? 0) + 1;
      const data: Prisma.BookingUpdateManyMutationInput = {
        status:
          role === 'VENDOR' ? 'CANCELLED_BY_VENDOR' : 'CANCELLED_BY_CLIENT',
        cancelledBy: userId,
        cancelledByRole: role,
        cancelledAt,
        cancellationReason: reason,
        financialMode: financialReviewReason ? 'REVIEW' : 'CANCELLATION',
        financialVersion: version,
        financialReviewReason: financialReviewReason ?? null,
      };
      if (allocation && !financialReviewReason)
        Object.assign(data, {
          cancellationTier: allocation.tier.label,
          refundPercentage: allocation.tier.clientRefundPercentage,
          vendorCompensationPercentage:
            allocation.tier.vendorCompensationPercentage,
          refundAmount: allocation.refund / 100,
          vendorCompensationAmount: allocation.gross / 100,
        });
      await this.touch(tx, booking, data);
      await tx.rescheduleRequest.updateMany({
        where: { bookingId, status: { in: ['PENDING', 'COUNTER_PROPOSED'] } },
        data: {
          status: 'REJECTED',
          respondedBy: userId,
          respondedAt: cancelledAt,
          responseReason: 'Booking was cancelled',
        },
      });
      if (role === 'VENDOR')
        await tx.vendor.update({
          where: { id: booking.vendorId },
          data: { cancellationStrikes: { increment: 1 } },
        });
      if (!financialReviewReason && evidence && allocation) {
        const current = await tx.transaction.findUniqueOrThrow({
          where: { id: evidence.payment.id },
        });
        if (
          current.updatedAt.getTime() !==
            evidence.payment.updatedAt.getTime() ||
          current.refundOperation
        ) {
          throw new ConflictException('Payment changed; retry cancellation');
        }
        const refund: RefundInstruction = {
          id: randomUUID(),
          version,
          amountKobo: String(allocation.refund),
          currency: current.currency,
          reference: current.providerRef,
          state: allocation.refund ? 'PENDING' : 'NOT_REQUIRED',
          createdAt: cancelledAt.toISOString(),
          attempts: [],
        };
        await tx.transaction.update({
          where: { id: current.id },
          data: {
            refundState: allocation.refund ? 'PENDING' : 'NOT_REQUIRED',
            refundOperation: json(refund),
            providerTransactionId: String(evidence.charge.id),
            verifiedChargedAmountKobo: BigInt(evidence.charge.amount),
            paymentEvidenceState: 'VERIFIED',
            paymentVerifiedAt: new Date(),
          },
        });
        const plan = {
          bookingId,
          purpose: 'CANCELLATION_COMPENSATION' as const,
          transactionId: current.id,
          currency: current.currency,
          financialVersion: version,
          principalKobo: BigInt(evidence.principal),
          refundAllocationKobo: BigInt(allocation.refund),
          grossVendorAllocationKobo: BigInt(allocation.gross),
          commissionKobo: BigInt(allocation.commission),
          netTransferKobo: BigInt(allocation.net),
          commissionRate: current.percentageFee,
          amount: allocation.net / 100,
          reference: randomUUID(),
          status: allocation.net ? 'PENDING' : 'NOT_REQUIRED',
          operationState: allocation.net
            ? ('PENDING' as const)
            : ('NOT_REQUIRED' as const),
          dispatchStartedAt: null,
          transferCode: null,
          providerState: null,
          attemptHistory: json([]),
          reconcileAfter: new Date(),
          policySnapshot: json({
            ...policy,
            selectedTier: allocation.tier,
            cancelledAt,
            appointmentStart: booking.startTime,
            cancelledByRole: role,
            principalKobo: evidence.principal,
            servicePriceKobo,
            refundKobo: allocation.refund,
            grossVendorKobo: allocation.gross,
            commissionRate: current.percentageFee,
            commissionKobo: allocation.commission,
            netVendorKobo: allocation.net,
          }),
        };
        await tx.settlement.upsert({
          where: { bookingId },
          create: plan,
          update: plan,
        });
      }
      return {
        booking: await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
        }),
        changed: true,
      };
    });
  }

  async settleCompletion(
    bookingId: string,
    expected?: Pick<Booking, 'status' | 'updatedAt'>,
  ) {
    let booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    if (
      expected &&
      (booking.status !== expected.status ||
        booking.updatedAt.getTime() !== expected.updatedAt.getTime())
    ) {
      throw new ConflictException(
        'Completion request changed; retry with the current booking',
      );
    }
    if (
      !active.includes(booking.status) ||
      ['CANCELLATION', 'REVIEW'].includes(booking.financialMode ?? '')
    ) {
      throw new ConflictException(
        'Booking cannot authorize completion settlement',
      );
    }
    if (booking.paymentMethod === 'PAID_BY_HAND') {
      await this.review(
        bookingId,
        'Cash payment; no Jubly-held funds to settle',
      );
      return {
        transaction: await this.prisma.transaction.findFirst({
          where: { bookingId },
        }),
        settlement: null,
      };
    }
    let settlement = await this.prisma.settlement.findUnique({
      where: { bookingId },
    });
    if (!settlement) {
      let verified: Awaited<ReturnType<BookingFinanceService['evidence']>>;
      try {
        verified = await this.evidence(booking);
      } catch (error) {
        await this.review(bookingId, error.message);
        throw new ConflictException('Payment requires financial review');
      }
      const allocation = vendorAllocation(
        verified.principal,
        verified.payment.percentageFee!,
      );
      settlement = await this.atomic(async (tx) => {
        const current = await tx.booking.findUniqueOrThrow({
          where: { id: bookingId },
        });
        if (
          current.status !== booking.status ||
          current.updatedAt.getTime() !== booking.updatedAt.getTime()
        ) {
          throw new ConflictException(
            'Completion request changed while verifying payment',
          );
        }
        if (
          !active.includes(current.status) ||
          (current.financialMode && current.financialMode !== 'UNDECIDED')
        ) {
          throw new ConflictException(
            'Booking already has a financial decision',
          );
        }
        const payment = await tx.transaction.findUniqueOrThrow({
          where: { id: verified.payment.id },
        });
        if (
          payment.updatedAt.getTime() !== verified.payment.updatedAt.getTime()
        )
          throw new ConflictException('Payment changed; retry completion');
        const version = (current.financialVersion ?? 0) + 1;
        await this.touch(tx, current, {
          financialMode: 'COMPLETION',
          financialVersion: version,
        });
        await tx.transaction.update({
          where: { id: payment.id },
          data: {
            paymentEvidenceState: 'VERIFIED',
            paymentVerifiedAt: new Date(),
            verifiedChargedAmountKobo: BigInt(verified.charge.amount),
            providerTransactionId: String(verified.charge.id),
          },
        });
        return tx.settlement.create({
          data: {
            bookingId,
            transactionId: payment.id,
            purpose: 'NORMAL_COMPLETION',
            financialVersion: version,
            amount: allocation.net / 100,
            currency: payment.currency,
            reference: randomUUID(),
            principalKobo: BigInt(verified.principal),
            refundAllocationKobo: BigInt(0),
            grossVendorAllocationKobo: BigInt(verified.principal),
            commissionKobo: BigInt(allocation.commission),
            netTransferKobo: BigInt(allocation.net),
            commissionRate: payment.percentageFee,
            operationState: allocation.net ? 'PENDING' : 'NOT_REQUIRED',
            status: allocation.net ? 'PENDING' : 'NOT_REQUIRED',
            attemptHistory: json([]),
            reconcileAfter: new Date(),
          },
        });
      });
    }
    if (!settlement.purpose || settlement.purpose !== 'NORMAL_COMPLETION') {
      await this.review(
        bookingId,
        'Historical or conflicting vendor settlement requires review',
      );
      throw new ConflictException('Settlement requires financial review');
    }
    await this.processBooking(bookingId);
    settlement = await this.prisma.settlement.findUniqueOrThrow({
      where: { bookingId },
    });
    booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    if (booking.financialMode !== 'COMPLETION')
      throw new ConflictException('Financial decision changed');
    return {
      transaction: await this.prisma.transaction.findUnique({
        where: { id: settlement.transactionId! },
      }),
      settlement,
    };
  }

  private matchesPlan(booking: Booking, settlement: Settlement) {
    return (
      settlement.financialVersion != null &&
      booking.financialVersion === settlement.financialVersion &&
      ((booking.financialMode === 'COMPLETION' &&
        settlement.purpose === 'NORMAL_COMPLETION' &&
        [...active, 'COMPLETED'].includes(booking.status)) ||
        (booking.financialMode === 'CANCELLATION' &&
          settlement.purpose === 'CANCELLATION_COMPENSATION' &&
          cancelled.includes(booking.status)))
    );
  }

  private budget(settlement: Settlement) {
    const {
      principalKobo: principal,
      refundAllocationKobo: refund,
      netTransferKobo: net,
      commissionKobo: fee,
      grossVendorAllocationKobo: gross,
    } = settlement;
    if (
      principal == null ||
      refund == null ||
      net == null ||
      fee == null ||
      gross == null ||
      [principal, refund, net, fee, gross].some((v) => v < BigInt(0)) ||
      net + fee !== gross ||
      refund + gross > principal
    ) {
      throw new Error('Financial plan budget is invalid');
    }
  }

  async processBooking(bookingId: string) {
    try {
      await this.processRefund(bookingId);
      await this.processTransfer(bookingId);
    } catch (error) {
      // Durable PENDING/PROCESSING claims survive every worker exception.
      this.logger.warn(
        `Financial processing deferred for booking ${bookingId}: ${error.message}`,
      );
    }
  }

  private async processRefund(bookingId: string) {
    const plan = await this.prisma.settlement.findUnique({
      where: { bookingId },
    });
    if (!plan?.transactionId || plan.purpose !== 'CANCELLATION_COMPENSATION')
      return;
    let payment = await this.prisma.transaction.findUniqueOrThrow({
      where: { id: plan.transactionId },
    });
    const operation =
      payment.refundOperation as unknown as RefundInstruction | null;
    if (
      !operation ||
      [
        'NOT_REQUIRED',
        'SUCCESS',
        'FAILED',
        'REQUIRES_REVIEW',
        'REVERSED',
      ].includes(payment.refundState ?? '')
    )
      return;
    if (payment.refundState !== 'PENDING') return this.reconcileRefund(payment);
    if (!this.dispatchEnabled) return;
    // Recheck external conflicts before authorizing first dispatch. Any unknown
    // check blocks dispatch; no HTTP call occurs within the MongoDB transaction.
    if (!(await this.checkExternalConflicts(plan, payment))) return;
    const claimed = await this.atomic(async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      const settlement = await tx.settlement.findUniqueOrThrow({
        where: { bookingId },
      });
      const current = await tx.transaction.findUniqueOrThrow({
        where: { id: payment.id },
      });
      const op = current.refundOperation as unknown as RefundInstruction;
      if (
        !this.matchesPlan(booking, settlement) ||
        current.refundState !== 'PENDING' ||
        op?.id !== operation.id ||
        op.version !== settlement.financialVersion ||
        op.dispatchedAt ||
        BigInt(op.amountKobo) !== settlement.refundAllocationKobo ||
        op.reference !== current.providerRef ||
        op.currency !== current.currency
      )
        return null;
      this.budget(settlement);
      await this.touch(tx, booking);
      const dispatchedAt = new Date().toISOString();
      const instruction: RefundInstruction = {
        ...op,
        state: 'PROCESSING',
        dispatchedAt,
        attempts: [
          ...op.attempts,
          { id: randomUUID(), dispatchedAt, state: 'PROCESSING' },
        ],
      };
      await tx.transaction.update({
        where: { id: current.id },
        data: { refundState: 'PROCESSING', refundOperation: json(instruction) },
      });
      return instruction;
    });
    if (!claimed) return;
    try {
      const response = await this.paystack.createRefund({
        transaction: claimed.reference,
        amount: exactKobo(BigInt(claimed.amountKobo)) / 100,
        currency: claimed.currency,
        merchantNote: `Jubly cancellation ${claimed.id}`,
      });
      payment = await this.prisma.transaction.findUniqueOrThrow({
        where: { id: payment.id },
      });
      await this.applyRefundOutcome(payment, claimed.id, response);
    } catch (_error) {
      await this.markRefundUnknown(payment.id, claimed.id);
    }
  }

  private async checkExternalConflicts(plan: Settlement, payment: Transaction) {
    try {
      const charge = (
        await this.paystack.verifyTransaction(payment.providerRef)
      ).data;
      try {
        this.validateCharge(payment, charge);
      } catch (_error) {
        await this.review(
          plan.bookingId,
          'Payment evidence changed after financial allocation',
        );
        return false;
      }
      const [refunds, disputes] = await Promise.all([
        this.paystack.listRefunds(payment.providerTransactionId!),
        this.paystack.listTransactionDisputes(payment.providerTransactionId!),
      ]);
      const op = payment.refundOperation as unknown as RefundInstruction | null;
      if (
        disputes.length ||
        refunds.some(
          (refund) =>
            !op?.providerId ||
            String(refund.id) !== op.providerId ||
            !this.refundMatches(payment, op, refund) ||
            (payment.refundState === 'SUCCESS' &&
              refund.status !== 'processed'),
        )
      ) {
        await this.review(
          plan.bookingId,
          'External refund/dispute conflicts with financial allocation',
        );
        return false;
      }
      return true;
    } catch (_error) {
      // Provider availability failures can be retried before dispatch safely.
      return false;
    }
  }

  private async markRefundUnknown(paymentId: string, operationId: string) {
    await this.atomic(async (tx) => {
      const payment = await tx.transaction.findUniqueOrThrow({
        where: { id: paymentId },
      });
      const op = payment.refundOperation as unknown as RefundInstruction;
      if (op?.id !== operationId || payment.refundState !== 'PROCESSING')
        return;
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: payment.bookingId! },
      });
      await this.touch(tx, booking);
      await tx.transaction.update({
        where: { id: payment.id },
        data: {
          refundState: 'REQUIRES_VERIFICATION',
          refundOperation: json({
            ...op,
            state: 'REQUIRES_VERIFICATION',
            attempts: op.attempts.map((a) => ({
              ...a,
              state: 'REQUIRES_VERIFICATION',
            })),
          }),
        },
      });
    });
  }

  private refundMatches(
    payment: Transaction,
    operation: RefundInstruction,
    refund: any,
  ) {
    const reference =
      refund?.transaction?.reference ?? refund?.transaction_reference;
    const transactionId =
      refund?.transaction?.id ??
      (typeof refund?.transaction !== 'object'
        ? refund?.transaction
        : undefined);
    return (
      refund?.id != null &&
      Number.isSafeInteger(Number(refund.amount)) &&
      Number(refund.amount) === exactKobo(BigInt(operation.amountKobo)) &&
      refund.currency === operation.currency &&
      (reference === payment.providerRef ||
        (transactionId != null &&
          String(transactionId) === payment.providerTransactionId)) &&
      (!operation.providerId || String(refund.id) === operation.providerId)
    );
  }

  private async applyRefundOutcome(
    payment: Transaction,
    operationId: string,
    refund: any,
  ) {
    await this.atomic(async (tx) => {
      const current = await tx.transaction.findUniqueOrThrow({
        where: { id: payment.id },
      });
      const op = current.refundOperation as unknown as RefundInstruction;
      if (op?.id !== operationId || !op.dispatchedAt) return;
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: current.bookingId! },
      });
      const settlement = await tx.settlement.findUniqueOrThrow({
        where: { bookingId: booking.id },
      });
      if (
        op.version !== settlement.financialVersion ||
        !this.refundMatches(current, op, refund)
      ) {
        await this.touch(tx, booking, {
          financialMode: 'REVIEW',
          financialReviewReason:
            'Refund result does not match its frozen instruction',
        });
        return;
      }
      const providerState = String(refund.status).toLowerCase();
      const state =
        providerState === 'processed'
          ? 'SUCCESS'
          : providerState === 'failed'
            ? 'FAILED'
            : providerState === 'needs-attention'
              ? 'REQUIRES_REVIEW'
              : ['pending', 'processing'].includes(providerState)
                ? 'PROCESSING'
                : 'REQUIRES_VERIFICATION';
      if (current.refundState === 'SUCCESS') {
        if (state === 'FAILED')
          await this.touch(tx, booking, {
            financialMode: 'REVIEW',
            financialReviewReason: 'Conflicting terminal refund results',
          });
        return;
      }
      if (current.refundState === 'FAILED' && state !== 'FAILED') {
        await this.touch(tx, booking, {
          financialMode: 'REVIEW',
          financialReviewReason: 'Conflicting terminal refund results',
        });
        return;
      }
      const recovered =
        state === 'SUCCESS' &&
        booking.financialMode === 'REVIEW' &&
        booking.financialVersion === op.version &&
        booking.financialReviewReason ===
          'Refund submission outcome is unproven; do not submit another refund';
      await this.touch(
        tx,
        booking,
        ['FAILED', 'REQUIRES_REVIEW'].includes(state)
          ? {
              financialMode: 'REVIEW',
              financialReviewReason:
                'Client refund requires provider/manual resolution',
            }
          : recovered
            ? { financialMode: 'CANCELLATION', financialReviewReason: null }
            : {},
      );
      await tx.transaction.update({
        where: { id: current.id },
        data: {
          refundState: state,
          status: state === 'SUCCESS' ? 'REFUNDED' : 'REFUND_PENDING',
          refundOperation: json({
            ...op,
            state,
            providerId: String(refund.id),
            providerState,
            response: refund,
            attempts: op.attempts.map((a) => ({
              ...a,
              state,
              checkedAt: new Date().toISOString(),
            })),
          }),
        },
      });
    });
  }

  private async reconcileRefund(payment: Transaction) {
    const op = payment.refundOperation as unknown as RefundInstruction;
    if (!op?.dispatchedAt) return;
    try {
      if (op.providerId) {
        return this.applyRefundOutcome(
          payment,
          op.id,
          await this.paystack.fetchRefund(op.providerId),
        );
      }
      const refunds = await this.paystack.listRefunds(
        payment.providerTransactionId!,
      );
      // An amount alone does not identify our refund. Require the durable marker
      // echoed in merchant_note when recovering a response lost after submission.
      const matches = refunds.filter(
        (refund) =>
          this.refundMatches(payment, op, refund) &&
          String(refund.merchant_note ?? '').includes(op.id),
      );
      if (matches.length === 1 && refunds.length === 1)
        return this.applyRefundOutcome(payment, op.id, matches[0]);
      await this.markRefundUnknown(payment.id, op.id);
      await this.review(
        payment.bookingId!,
        'Refund submission outcome is unproven; do not submit another refund',
      );
    } catch (_error) {
      await this.markRefundUnknown(payment.id, op.id);
    }
  }

  private async processTransfer(bookingId: string) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { bookingId },
    });
    if (!settlement?.purpose || !settlement.transactionId) return;
    if (
      ['PROCESSING', 'REQUIRES_VERIFICATION', 'FAILED'].includes(
        settlement.operationState ?? '',
      )
    ) {
      return this.reconcileTransfer(settlement);
    }
    if (settlement.operationState !== 'PENDING' || !this.dispatchEnabled)
      return;
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { vendor: true },
    });
    if (!this.matchesPlan(booking, settlement)) return;
    const payment = await this.prisma.transaction.findUniqueOrThrow({
      where: { id: settlement.transactionId },
    });
    if (
      settlement.purpose === 'CANCELLATION_COMPENSATION' &&
      !['SUCCESS', 'NOT_REQUIRED'].includes(payment.refundState ?? '')
    )
      return;
    if (!(await this.checkExternalConflicts(settlement, payment))) return;
    if (!booking.vendor.bankAccountNumber || !booking.vendor.bankCode) {
      await this.review(bookingId, 'Vendor settlement account is missing');
      return;
    }
    const recipient = settlement.recipientCode
      ? { recipient_code: settlement.recipientCode }
      : await this.paystack.createTransferRecipient({
          name: booking.vendor.businessName,
          accountNumber: booking.vendor.bankAccountNumber,
          bankCode: booking.vendor.bankCode,
        });
    const claimed = await this.atomic(async (tx) => {
      const currentBooking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      const current = await tx.settlement.findUniqueOrThrow({
        where: { bookingId },
      });
      const currentPayment = await tx.transaction.findUniqueOrThrow({
        where: { id: current.transactionId! },
      });
      if (
        !this.matchesPlan(currentBooking, current) ||
        current.operationState !== 'PENDING' ||
        current.dispatchStartedAt ||
        (current.purpose === 'CANCELLATION_COMPENSATION' &&
          !['SUCCESS', 'NOT_REQUIRED'].includes(
            currentPayment.refundState ?? '',
          ))
      )
        return null;
      this.budget(current);
      await this.touch(tx, currentBooking);
      const dispatchedAt = new Date();
      return tx.settlement.update({
        where: { id: current.id },
        data: {
          operationState: 'PROCESSING',
          dispatchStartedAt: dispatchedAt,
          recipientCode: recipient.recipient_code,
          reconcileAfter: nextCheck(),
          attemptHistory: json([
            ...((current.attemptHistory as any[]) ?? []),
            {
              reference: current.reference,
              version: current.financialVersion,
              amountKobo: current.netTransferKobo?.toString(),
              currency: current.currency,
              recipientCode: recipient.recipient_code,
              dispatchedAt,
              state: 'PROCESSING',
            },
          ]),
        },
      });
    });
    if (!claimed) return;
    try {
      const transfer = await this.paystack.initiateTransfer({
        amount: exactKobo(claimed.netTransferKobo!) / 100,
        recipientCode: claimed.recipientCode!,
        reference: claimed.reference!,
        reason: `Settlement for booking ${bookingId}`,
      });
      await this.applyTransferOutcome(claimed, transfer);
    } catch (_error) {
      await this.prisma.settlement.updateMany({
        where: {
          id: claimed.id,
          reference: claimed.reference,
          operationState: 'PROCESSING',
        },
        data: {
          operationState: 'REQUIRES_VERIFICATION',
          reconcileAfter: nextCheck(),
        },
      });
    }
  }

  private async applyTransferOutcome(expected: Settlement, transfer: any) {
    await this.atomic(async (tx) => {
      const current = await tx.settlement.findUniqueOrThrow({
        where: { id: expected.id },
      });
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: current.bookingId },
      });
      const recipient =
        typeof transfer.recipient === 'object'
          ? transfer.recipient?.recipient_code
          : transfer.recipient;
      if (current.reference !== expected.reference) {
        if (
          ['success', 'reversed'].includes(
            String(transfer.status).toLowerCase(),
          )
        ) {
          await this.touch(tx, booking, {
            financialMode: 'REVIEW',
            financialReviewReason:
              'Late outcome from an older transfer attempt',
          });
        }
        // Another reconciler may already have rotated a confirmed failed
        // attempt. Its delayed failed/pending result cannot change the new one.
        return;
      }
      if (
        transfer.reference !== expected.reference ||
        transfer.currency !== expected.currency ||
        !Number.isSafeInteger(transfer.amount) ||
        transfer.amount !== exactKobo(expected.netTransferKobo!) ||
        recipient !== expected.recipientCode ||
        !transfer.transfer_code ||
        (current.transferCode &&
          transfer.transfer_code !== current.transferCode)
      ) {
        await this.touch(tx, booking, {
          financialMode: 'REVIEW',
          financialReviewReason:
            'Transfer outcome conflicts with financial instruction',
        });
        return;
      }
      const providerState = String(transfer.status).toLowerCase();
      const state =
        providerState === 'success'
          ? 'SUCCESS'
          : providerState === 'failed'
            ? 'FAILED'
            : providerState === 'reversed'
              ? 'REVERSED'
              : ['pending', 'otp', 'received', 'queued'].includes(providerState)
                ? 'PROCESSING'
                : 'REQUIRES_VERIFICATION';
      if (
        current.operationState === 'REVERSED' ||
        (current.operationState === 'SUCCESS' && state !== 'REVERSED')
      )
        return;
      if (
        current.operationState === 'FAILED' &&
        !['FAILED', 'REVERSED'].includes(state)
      ) {
        await this.touch(tx, booking, {
          financialMode: 'REVIEW',
          financialReviewReason: 'Conflicting terminal transfer results',
        });
        return;
      }
      await this.touch(
        tx,
        booking,
        state === 'REVERSED'
          ? {
              financialMode: 'REVIEW',
              financialReviewReason: 'Vendor transfer reversed',
            }
          : {},
      );
      await tx.settlement.update({
        where: { id: current.id },
        data: {
          operationState: state,
          status: state,
          providerState,
          transferCode: transfer.transfer_code,
          reconcileAfter: nextCheck(),
          attemptHistory: json(
            ((current.attemptHistory as any[]) ?? []).map((attempt) =>
              attempt.reference === current.reference
                ? {
                    ...attempt,
                    state,
                    transferCode: transfer.transfer_code,
                    checkedAt: new Date().toISOString(),
                  }
                : attempt,
            ),
          ),
        },
      });
      if (
        state === 'SUCCESS' &&
        current.purpose === 'NORMAL_COMPLETION' &&
        current.transactionId
      ) {
        await tx.transaction.updateMany({
          where: { id: current.transactionId, status: 'PENDING' },
          data: { status: 'COMPLETED' },
        });
      }
    });
  }

  private async reconcileTransfer(settlement: Settlement) {
    if (!settlement.reference)
      return this.review(
        settlement.bookingId,
        'Missing historical transfer reference',
      );
    try {
      const transfer = await this.paystack.verifyTransfer(settlement.reference);
      if (!transfer) {
        // A stale worker may still dispatch after losing its lease. Never reclaim
        // its instruction or release its budget based on a temporary not-found.
        await this.prisma.settlement.updateMany({
          where: {
            id: settlement.id,
            reference: settlement.reference,
            operationState: { in: ['PROCESSING', 'REQUIRES_VERIFICATION'] },
          },
          data: {
            operationState: 'REQUIRES_VERIFICATION',
            reconcileAfter: nextCheck(),
          },
        });
        return;
      }
      await this.applyTransferOutcome(settlement, transfer);
      if (transfer.status?.toLowerCase() !== 'failed') return;
      // A new reference is allowed only after definitive provider failure, and
      // only while the SAME financial allocation still owns the booking.
      await this.atomic(async (tx) => {
        const booking = await tx.booking.findUniqueOrThrow({
          where: { id: settlement.bookingId },
        });
        const current = await tx.settlement.findUniqueOrThrow({
          where: { id: settlement.id },
        });
        if (
          !this.matchesPlan(booking, current) ||
          current.reference !== settlement.reference ||
          current.operationState !== 'FAILED'
        )
          return;
        await this.touch(tx, booking);
        await tx.settlement.update({
          where: { id: current.id },
          data: {
            reference: randomUUID(),
            operationState: 'PENDING',
            status: 'PENDING',
            transferCode: null,
            dispatchStartedAt: null,
            providerState: null,
            reconcileAfter: nextCheck(),
          },
        });
      });
    } catch (_error) {
      await this.prisma.settlement.updateMany({
        where: {
          id: settlement.id,
          reference: settlement.reference,
          operationState: { in: ['PROCESSING', 'REQUIRES_VERIFICATION'] },
        },
        data: {
          operationState: 'REQUIRES_VERIFICATION',
          reconcileAfter: nextCheck(),
        },
      });
    }
  }

  async reconcile() {
    const plans = await this.prisma.settlement.findMany({
      where: {
        purpose: { in: ['NORMAL_COMPLETION', 'CANCELLATION_COMPENSATION'] },
        operationState: {
          in: [
            'PENDING',
            'PROCESSING',
            'REQUIRES_VERIFICATION',
            'FAILED',
            'NOT_REQUIRED',
          ],
        },
        OR: [
          { reconcileAfter: { lte: new Date() } },
          { reconcileAfter: null },
          { reconcileAfter: { isSet: false } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 25,
    });
    for (const plan of plans) {
      await this.processBooking(plan.bookingId);
      await this.prisma.settlement.updateMany({
        where: { id: plan.id },
        data: { reconcileAfter: nextCheck() },
      });
    }
  }

  async handleWebhook(event: string, data: any) {
    if (event.startsWith('refund.')) {
      const reference =
        data?.transaction_reference ?? data?.transaction?.reference;
      if (!reference) return;
      const payment = await this.prisma.transaction.findUnique({
        where: { providerRef: reference },
      });
      if (!payment?.bookingId) return;
      if (!payment.refundOperation)
        return this.review(
          payment.bookingId,
          'Unplanned Paystack refund event',
        );
      if (payment.refundState === 'NOT_REQUIRED')
        return this.review(
          payment.bookingId,
          'Unplanned refund against a zero-refund cancellation',
        );
      const instruction =
        payment.refundOperation as unknown as RefundInstruction;
      if (instruction.providerId) {
        const refunds = await this.paystack.listRefunds(
          payment.providerTransactionId!,
        );
        if (
          refunds.some((refund) => String(refund.id) !== instruction.providerId)
        ) {
          return this.review(
            payment.bookingId,
            'Additional provider refund conflicts with the frozen allocation',
          );
        }
      }
      // Webhooks may omit refund ID; re-fetch authoritative state instead of
      // applying generic data.reference or an out-of-order status directly.
      await this.reconcileRefund(payment);
      return this.processBooking(payment.bookingId);
    }
    if (event.startsWith('charge.dispute.')) {
      const reference =
        data?.transaction?.reference ?? data?.transaction_reference;
      if (!reference) return;
      const payment = await this.prisma.transaction.findUnique({
        where: { providerRef: reference },
      });
      if (payment?.bookingId)
        await this.review(payment.bookingId, 'Paystack payment dispute');
      return;
    }
    if (!event.startsWith('transfer.')) return;
    const settlement = await this.prisma.settlement.findFirst({
      where: {
        OR: [
          ...(data?.reference ? [{ reference: String(data.reference) }] : []),
          ...(data?.transfer_code
            ? [{ transferCode: String(data.transfer_code) }]
            : []),
        ],
      },
    });
    if (settlement?.purpose) return this.reconcileTransfer(settlement);
    if (settlement)
      return this.review(
        settlement.bookingId,
        'Historical transfer event requires reconciliation',
      );
    // Older attempt references are kept in the embedded history. They cannot
    // overwrite the current attempt; a contradictory late success needs review.
    if (
      data?.reference &&
      ['transfer.success', 'transfer.reversed'].includes(event)
    ) {
      // Prisma 5's Mongo JSON filter cannot query isSet/nested array paths.
      // Filter the embedded attempt history in Mongo rather than loading every
      // settlement or creating another collection just to look up attempts.
      const matches = (await this.prisma.settlement.aggregateRaw({
        pipeline: [
          { $match: { 'attemptHistory.reference': String(data.reference) } },
          { $project: { bookingId: 1 } },
        ],
      })) as unknown as Array<{ bookingId: { $oid: string } | string }>;
      for (const match of matches) {
        const bookingId =
          typeof match.bookingId === 'string'
            ? match.bookingId
            : match.bookingId.$oid;
        await this.review(
          bookingId,
          'Late outcome from an older transfer attempt',
        );
      }
    }
  }

  async refundResponse(bookingId: string) {
    await this.processBooking(bookingId);
    const plan = await this.prisma.settlement.findUnique({
      where: { bookingId },
    });
    const payment = plan?.transactionId
      ? await this.prisma.transaction.findUnique({
          where: { id: plan.transactionId },
        })
      : null;
    const op = payment?.refundOperation as unknown as RefundInstruction | null;
    if (op?.response) return op.response;
    throw new ConflictException(
      op?.state === 'NOT_REQUIRED'
        ? 'Cancellation policy requires no client refund'
        : 'Cancellation refund is pending verification or financial review',
    );
  }
}
