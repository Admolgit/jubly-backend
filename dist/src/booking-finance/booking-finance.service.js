"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var BookingFinanceService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingFinanceService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_service_1 = require("../../prisma/prisma.service");
const cancellation_policy_service_1 = require("../cancellation-policy/cancellation-policy.service");
const paystack_service_1 = require("../paystack/paystack.service");
const financial_allocation_1 = require("./financial-allocation");
const cancelled = [
    'CANCELLED',
    'CANCELLED_BY_CLIENT',
    'CANCELLED_BY_VENDOR',
];
const active = ['CONFIRMED', 'COMPLETION_PENDING_APPROVAL'];
const json = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
const nextCheck = () => new Date(Date.now() + 60_000);
let BookingFinanceService = BookingFinanceService_1 = class BookingFinanceService {
    constructor(prisma, paystack, policies) {
        this.prisma = prisma;
        this.paystack = paystack;
        this.policies = policies;
        this.logger = new common_1.Logger(BookingFinanceService_1.name);
    }
    get dispatchEnabled() {
        return process.env.JUBLY_FINANCIAL_DISPATCH_ENABLED === 'true';
    }
    checkoutSnapshot(servicePrincipal, paymentPrincipal, gross, rate, identity) {
        const servicePrincipalKobo = (0, financial_allocation_1.kobo)(servicePrincipal);
        const paymentPrincipalKobo = (0, financial_allocation_1.kobo)(paymentPrincipal);
        const grossKobo = (0, financial_allocation_1.kobo)(gross);
        (0, financial_allocation_1.vendorAllocation)(paymentPrincipalKobo, rate);
        if (paymentPrincipalKobo > servicePrincipalKobo) {
            throw new common_1.ConflictException('Payment exceeds service balance');
        }
        if (grossKobo < paymentPrincipalKobo) {
            throw new common_1.ConflictException('Invalid checkout amount');
        }
        return {
            servicePrincipalKobo: BigInt(servicePrincipalKobo),
            paymentPrincipalKobo: BigInt(paymentPrincipalKobo),
            expectedGrossChargeKobo: BigInt(grossKobo),
            processingMarkupKobo: BigInt(grossKobo - paymentPrincipalKobo),
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
    validateCharge(payment, charge) {
        const snapshot = payment.checkoutSnapshot;
        if (!snapshot ||
            payment.servicePrincipalKobo == null ||
            payment.expectedGrossChargeKobo == null ||
            payment.processingMarkupKobo == null ||
            payment.percentageFee == null ||
            !payment.providerRef ||
            payment.providerRef.startsWith('MANUAL-')) {
            throw new Error('Payment has no trustworthy checkout snapshot');
        }
        const principal = (0, financial_allocation_1.exactKobo)(payment.servicePrincipalKobo);
        const paymentPrincipal = (0, financial_allocation_1.kobo)(payment.amount);
        const gross = (0, financial_allocation_1.exactKobo)(payment.expectedGrossChargeKobo);
        const processingMarkup = (0, financial_allocation_1.exactKobo)(payment.processingMarkupKobo);
        if (!principal ||
            !paymentPrincipal ||
            gross - paymentPrincipal !== processingMarkup ||
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
                String(charge.id) !== payment.providerTransactionId)) {
            throw new Error('Payment evidence does not match the original checkout');
        }
        return paymentPrincipal;
    }
    async recordVerifiedCharge(reference, charge) {
        const payment = await this.prisma.transaction.findUnique({
            where: { providerRef: reference },
        });
        if (!payment)
            throw new common_1.ConflictException('Transaction was not initialized');
        if (!payment.checkoutSnapshot)
            return;
        const verified = charge ?? (await this.paystack.verifyTransaction(reference)).data;
        try {
            this.validateCharge(payment, verified);
        }
        catch (error) {
            console.log(error);
            await this.prisma.transaction.update({
                where: { id: payment.id },
                data: { paymentEvidenceState: 'REQUIRES_REVIEW' },
            });
            throw new common_1.ConflictException('Payment evidence requires financial review');
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
    async evidence(booking) {
        if (booking.paymentMethod === 'PAID_BY_HAND') {
            throw new Error('Cash payment requires manual financial handling');
        }
        const payments = await this.prisma.transaction.findMany({
            where: { bookingId: booking.id },
            orderBy: { createdAt: 'asc' },
        });
        if (payments.length === 0) {
            throw new Error('No booking payment records found');
        }
        const initialPayments = payments.filter((payment) => payment.paymentType === 'BOOKING_INITIAL');
        if (initialPayments.length !== 1) {
            throw new Error('Missing or ambiguous initial booking payment');
        }
        const supportedTypes = new Set([
            'BOOKING_INITIAL',
            'BOOKING_OUTSTANDING_PAYMENT',
        ]);
        if (payments.some((payment) => !supportedTypes.has(payment.paymentType ?? ''))) {
            throw new Error('Unsupported payment type requires financial review');
        }
        const verifiedPayments = [];
        const seenReferences = new Set();
        const seenProviderIds = new Set();
        for (const payment of payments) {
            const snapshot = payment.checkoutSnapshot;
            if (payment.bookingId !== booking.id ||
                payment.vendorId !== booking.vendorId ||
                !snapshot ||
                snapshot.vendorId !== booking.vendorId ||
                snapshot.serviceId !== booking.serviceId ||
                snapshot.currency !== payment.currency ||
                (snapshot.bookingId && snapshot.bookingId !== booking.id)) {
                throw new Error(`Payment identity mismatch for transaction ${payment.id}`);
            }
            if (payment.paymentEvidenceState === 'REQUIRES_REVIEW' ||
                payment.refundOperation ||
                ['REFUNDED', 'REFUND_PENDING', 'REVERSED'].includes(payment.status.toUpperCase())) {
                throw new Error(`Payment ${payment.id} requires financial review`);
            }
            if (!payment.providerRef ||
                payment.providerRef.startsWith('MANUAL-') ||
                seenReferences.has(payment.providerRef)) {
                throw new Error(`Missing or duplicate provider reference for ${payment.id}`);
            }
            seenReferences.add(payment.providerRef);
            const charge = (await this.paystack.verifyTransaction(payment.providerRef)).data;
            const principal = this.validateCharge(payment, charge);
            const providerId = String(charge.id);
            if (seenProviderIds.has(providerId)) {
                throw new Error('Multiple payment records reference the same Paystack charge');
            }
            seenProviderIds.add(providerId);
            const [refunds, disputes] = await Promise.all([
                this.paystack.listRefunds(providerId),
                this.paystack.listTransactionDisputes(providerId),
            ]);
            if (refunds.length > 0 ||
                disputes.length > 0 ||
                payment.refundOperation ||
                ['REFUNDED', 'REFUND_PENDING', 'REVERSED'].includes(payment.status.toUpperCase())) {
                throw new Error(`Refund, reversal or dispute found for ${payment.id}`);
            }
            verifiedPayments.push({
                payment,
                principal,
                charge,
            });
        }
        const initial = verifiedPayments.filter((item) => item.payment.paymentType === 'BOOKING_INITIAL');
        const outstanding = verifiedPayments.filter((item) => item.payment.paymentType === 'BOOKING_OUTSTANDING_PAYMENT');
        if (initial.length !== 1 || verifiedPayments.length !== payments.length) {
            throw new Error('Booking payment history is incomplete or ambiguous');
        }
        const commissionRates = new Set(verifiedPayments.map((item) => item.payment.percentageFee));
        if (commissionRates.has(null) ||
            commissionRates.has(undefined) ||
            commissionRates.size !== 1) {
            throw new Error('Payment commission rates are inconsistent');
        }
        const principal = verifiedPayments.reduce((total, item) => total + item.principal, 0);
        if (!Number.isSafeInteger(principal) || principal <= 0) {
            throw new Error('Verified booking principal is invalid');
        }
        return {
            payments: verifiedPayments,
            initialPayment: initial[0],
            outstandingPayments: outstanding,
            principal,
            percentageFee: initial[0].payment.percentageFee,
        };
    }
    async atomic(work) {
        for (let attempt = 0;; attempt++) {
            try {
                return await this.prisma.$transaction(work);
            }
            catch (error) {
                if (error.code === 'P2034' && attempt < 3)
                    continue;
                if (error.code === 'P2034' || error.code === 'P2002')
                    throw new common_1.ConflictException('Financial decision changed; retry the request');
                throw error;
            }
        }
    }
    async touch(tx, booking, data = {}) {
        const result = await tx.booking.updateMany({
            where: {
                id: booking.id,
                updatedAt: booking.updatedAt,
                status: booking.status,
            },
            data: {
                ...data,
                updatedAt: new Date(Math.max(Date.now(), booking.updatedAt.getTime() + 1)),
            },
        });
        if (result.count !== 1)
            throw new common_1.ConflictException('Booking changed; retry the request');
    }
    async review(bookingId, reason) {
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
    async cancel(bookingId, userId, role, reason) {
        const original = await this.prisma.booking.findUniqueOrThrow({
            where: { id: bookingId },
        });
        if (cancelled.includes(original.status)) {
            if (!original.financialMode)
                await this.review(bookingId, 'Historical cancellation has no verified financial allocation');
            return {
                booking: await this.prisma.booking.findUniqueOrThrow({
                    where: { id: bookingId },
                }),
                changed: false,
            };
        }
        if (original.status === 'COMPLETED')
            throw new common_1.ConflictException('Completed bookings cannot be cancelled');
        const cancelledAt = new Date();
        const policy = await this.policies.getFinancialPolicySnapshot();
        let evidence;
        let allocation;
        let servicePriceKobo;
        let reviewReason;
        try {
            evidence = await this.evidence(original);
            if (evidence.payments.length !== 1) {
                throw new Error('Cancellation with multiple payments requires manual financial review');
            }
            const service = await this.prisma.service.findUniqueOrThrow({
                where: { id: original.serviceId },
                select: { price: true },
            });
            servicePriceKobo = (0, financial_allocation_1.kobo)(service.price);
            allocation = (0, financial_allocation_1.cancellationAllocation)({
                amount: servicePriceKobo,
                appointmentStart: original.startTime,
                cancelledAt,
                cancelledByRole: role,
                tiers: policy.tiers,
                noShowPolicy: policy.noShowPolicy,
            }, evidence.initialPayment.payment.percentageFee);
            if (allocation.refund + allocation.gross > evidence.principal) {
                throw new Error('Service-price cancellation allocation exceeds the verified payment budget');
            }
        }
        catch (error) {
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
                throw new common_1.ConflictException('Completed bookings cannot be cancelled');
            if (booking.startTime.getTime() !== original.startTime.getTime())
                throw new common_1.ConflictException('Booking schedule changed; retry cancellation');
            const settlement = await tx.settlement.findUnique({
                where: { bookingId },
            });
            const replaceable = settlement?.purpose === 'NORMAL_COMPLETION' &&
                settlement.operationState === 'PENDING' &&
                !settlement.dispatchStartedAt &&
                Array.isArray(settlement.attemptHistory) &&
                !settlement.attemptHistory.length;
            const blocked = (settlement && !replaceable) || booking.financialMode === 'REVIEW';
            const financialReviewReason = blocked
                ? 'Existing vendor payout/financial decision requires reconciliation'
                : reviewReason;
            const version = (booking.financialVersion ?? 0) + 1;
            const data = {
                status: role === 'VENDOR' ? 'CANCELLED_BY_VENDOR' : 'CANCELLED_BY_CLIENT',
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
                    vendorCompensationPercentage: allocation.tier.vendorCompensationPercentage,
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
                    where: { id: evidence.initialPayment.payment.id },
                });
                if (current.updatedAt.getTime() !==
                    evidence.initialPayment.payment.updatedAt?.getTime() ||
                    current.refundOperation) {
                    throw new common_1.ConflictException('Payment changed; retry cancellation');
                }
                const refund = {
                    id: (0, crypto_1.randomUUID)(),
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
                        providerTransactionId: String(evidence.initialPayment.payment.id),
                        verifiedChargedAmountKobo: BigInt(evidence.initialPayment.payment.amount),
                        paymentEvidenceState: 'VERIFIED',
                        paymentVerifiedAt: new Date(),
                    },
                });
                const plan = {
                    bookingId,
                    purpose: 'CANCELLATION_COMPENSATION',
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
                    reference: (0, crypto_1.randomUUID)(),
                    status: allocation.net ? 'PENDING' : 'NOT_REQUIRED',
                    operationState: allocation.net
                        ? 'PENDING'
                        : 'NOT_REQUIRED',
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
    async settleCompletion(bookingId, expected) {
        let booking = await this.prisma.booking.findUniqueOrThrow({
            where: { id: bookingId },
        });
        if (expected &&
            (booking.status !== expected.status ||
                booking.completionRequestedAt?.getTime() !==
                    expected.completionRequestedAt?.getTime())) {
            throw new common_1.ConflictException('Completion request changed; retry with the current booking');
        }
        if (!active.includes(booking.status) ||
            ['CANCELLATION', 'REVIEW'].includes(booking.financialMode ?? '')) {
            throw new common_1.ConflictException('Booking cannot authorize completion settlement');
        }
        if (booking.paymentMethod === 'PAID_BY_HAND') {
            await this.review(bookingId, 'Cash payment; no Jubly-held funds to settle');
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
            let verified;
            try {
                verified = await this.evidence(booking);
            }
            catch (error) {
                const reason = error instanceof Error
                    ? error.message
                    : 'Payment evidence could not be verified';
                await this.review(bookingId, reason);
                throw new common_1.ConflictException('Payment requires financial review');
            }
            const allocation = (0, financial_allocation_1.vendorAllocation)(verified.principal, verified.percentageFee);
            settlement = await this.atomic(async (tx) => {
                const current = await tx.booking.findUniqueOrThrow({
                    where: { id: bookingId },
                });
                if (current.status !== booking.status ||
                    current.completionRequestedAt?.getTime() !==
                        booking.completionRequestedAt?.getTime()) {
                    throw new common_1.ConflictException('Completion request changed while verifying payment');
                }
                if (!active.includes(current.status) ||
                    (current.financialMode && current.financialMode !== 'UNDECIDED')) {
                    throw new common_1.ConflictException('Booking already has a financial decision');
                }
                for (const item of verified.payments) {
                    const payment = await tx.transaction.findUniqueOrThrow({
                        where: { id: item.payment.id },
                    });
                    if (payment.updatedAt.getTime() !== item.payment.updatedAt.getTime() ||
                        payment.bookingId !== bookingId ||
                        payment.vendorId !== current.vendorId ||
                        payment.paymentType !== item.payment.paymentType) {
                        throw new common_1.ConflictException('Payment changed; retry completion');
                    }
                    await tx.transaction.update({
                        where: { id: payment.id },
                        data: {
                            paymentEvidenceState: 'VERIFIED',
                            paymentVerifiedAt: new Date(),
                            verifiedChargedAmountKobo: BigInt(item.charge.amount),
                            providerTransactionId: String(item.charge.id),
                        },
                    });
                }
                const version = (current.financialVersion ?? 0) + 1;
                await this.touch(tx, current, {
                    financialMode: 'COMPLETION',
                    financialVersion: version,
                    financialReviewReason: null,
                });
                const initialPayment = verified.initialPayment.payment;
                return tx.settlement.create({
                    data: {
                        bookingId,
                        transactionId: initialPayment.id,
                        paymentTransactionIds: verified.payments.map((item) => item.payment.id),
                        purpose: 'NORMAL_COMPLETION',
                        financialVersion: version,
                        amount: allocation.net / 100,
                        currency: initialPayment.currency,
                        reference: (0, crypto_1.randomUUID)(),
                        principalKobo: BigInt(verified.principal),
                        refundAllocationKobo: BigInt(0),
                        grossVendorAllocationKobo: BigInt(verified.principal),
                        commissionKobo: BigInt(allocation.commission),
                        netTransferKobo: BigInt(allocation.net),
                        commissionRate: verified.percentageFee,
                        operationState: allocation.net ? 'PENDING' : 'NOT_REQUIRED',
                        status: allocation.net ? 'PENDING' : 'NOT_REQUIRED',
                        attemptHistory: json([]),
                        reconcileAfter: new Date(),
                    },
                });
            });
        }
        if (settlement.purpose !== 'NORMAL_COMPLETION') {
            await this.review(bookingId, 'Historical or conflicting vendor settlement requires review');
            throw new common_1.ConflictException('Settlement requires financial review');
        }
        await this.processBooking(bookingId);
        settlement = await this.prisma.settlement.findUniqueOrThrow({
            where: { bookingId },
        });
        booking = await this.prisma.booking.findUniqueOrThrow({
            where: { id: bookingId },
        });
        this.logger.error(`Completion financial state changed: ${JSON.stringify({
            bookingId,
            bookingStatus: booking.status,
            financialMode: booking.financialMode,
            financialVersion: booking.financialVersion,
            financialReviewReason: booking.financialReviewReason,
            settlementId: settlement.id,
            settlementReference: settlement.reference,
            settlementState: settlement.operationState,
            settlementVersion: settlement.financialVersion,
            settlementTransferCode: settlement.transferCode,
        })}`);
        if (booking.financialMode !== 'COMPLETION') {
            throw new common_1.ConflictException('Financial decision changed');
        }
        return {
            transaction: settlement.transactionId
                ? await this.prisma.transaction.findUnique({
                    where: { id: settlement.transactionId },
                })
                : null,
            settlement,
        };
    }
    matchesPlan(booking, settlement) {
        return (settlement.financialVersion != null &&
            booking.financialVersion === settlement.financialVersion &&
            ((booking.financialMode === 'COMPLETION' &&
                settlement.purpose === 'NORMAL_COMPLETION' &&
                [...active, 'COMPLETED'].includes(booking.status)) ||
                (booking.financialMode === 'CANCELLATION' &&
                    settlement.purpose === 'CANCELLATION_COMPENSATION' &&
                    cancelled.includes(booking.status))));
    }
    budget(settlement) {
        const { principalKobo: principal, refundAllocationKobo: refund, netTransferKobo: net, commissionKobo: fee, grossVendorAllocationKobo: gross, } = settlement;
        if (principal == null ||
            refund == null ||
            net == null ||
            fee == null ||
            gross == null ||
            [principal, refund, net, fee, gross].some((v) => v < BigInt(0)) ||
            net + fee !== gross ||
            refund + gross > principal) {
            throw new Error('Financial plan budget is invalid');
        }
    }
    async processBooking(bookingId) {
        try {
            await this.processRefund(bookingId);
            await this.processTransfer(bookingId);
        }
        catch (error) {
            this.logger.warn(`Financial processing deferred for booking ${bookingId}: ${error.message}`);
        }
    }
    async processRefund(bookingId) {
        const plan = await this.prisma.settlement.findUnique({
            where: { bookingId },
        });
        if (!plan?.transactionId || plan.purpose !== 'CANCELLATION_COMPENSATION')
            return;
        let payment = await this.prisma.transaction.findUniqueOrThrow({
            where: { id: plan.transactionId },
        });
        const operation = payment.refundOperation;
        if (!operation ||
            [
                'NOT_REQUIRED',
                'SUCCESS',
                'FAILED',
                'REQUIRES_REVIEW',
                'REVERSED',
            ].includes(payment.refundState ?? ''))
            return;
        if (payment.refundState !== 'PENDING')
            return this.reconcileRefund(payment);
        if (!this.dispatchEnabled)
            return;
        if (!(await this.checkExternalConflicts(plan, payment)))
            return;
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
            const op = current.refundOperation;
            if (!this.matchesPlan(booking, settlement) ||
                current.refundState !== 'PENDING' ||
                op?.id !== operation.id ||
                op.version !== settlement.financialVersion ||
                op.dispatchedAt ||
                BigInt(op.amountKobo) !== settlement.refundAllocationKobo ||
                op.reference !== current.providerRef ||
                op.currency !== current.currency)
                return null;
            this.budget(settlement);
            await this.touch(tx, booking);
            const dispatchedAt = new Date().toISOString();
            const instruction = {
                ...op,
                state: 'PROCESSING',
                dispatchedAt,
                attempts: [
                    ...op.attempts,
                    { id: (0, crypto_1.randomUUID)(), dispatchedAt, state: 'PROCESSING' },
                ],
            };
            await tx.transaction.update({
                where: { id: current.id },
                data: { refundState: 'PROCESSING', refundOperation: json(instruction) },
            });
            return instruction;
        });
        if (!claimed)
            return;
        try {
            const response = await this.paystack.createRefund({
                transaction: claimed.reference,
                amount: (0, financial_allocation_1.exactKobo)(BigInt(claimed.amountKobo)) / 100,
                currency: claimed.currency,
                merchantNote: `Jubly cancellation ${claimed.id}`,
            });
            payment = await this.prisma.transaction.findUniqueOrThrow({
                where: { id: payment.id },
            });
            await this.applyRefundOutcome(payment, claimed.id, response);
        }
        catch (_error) {
            console.log(_error);
            await this.markRefundUnknown(payment.id, claimed.id);
        }
    }
    async checkExternalConflicts(plan, payment) {
        try {
            const charge = (await this.paystack.verifyTransaction(payment.providerRef)).data;
            try {
                this.validateCharge(payment, charge);
            }
            catch (_error) {
                console.log(_error);
                await this.review(plan.bookingId, 'Payment evidence changed after financial allocation');
                return false;
            }
            const [refunds, disputes] = await Promise.all([
                this.paystack.listRefunds(payment.providerTransactionId),
                this.paystack.listTransactionDisputes(payment.providerTransactionId),
            ]);
            const op = payment.refundOperation;
            if (disputes.length ||
                refunds.some((refund) => !op?.providerId ||
                    String(refund.id) !== op.providerId ||
                    !this.refundMatches(payment, op, refund) ||
                    (payment.refundState === 'SUCCESS' &&
                        refund.status !== 'processed'))) {
                await this.review(plan.bookingId, 'External refund/dispute conflicts with financial allocation');
                return false;
            }
            return true;
        }
        catch (_error) {
            console.log(_error);
            return false;
        }
    }
    async markRefundUnknown(paymentId, operationId) {
        await this.atomic(async (tx) => {
            const payment = await tx.transaction.findUniqueOrThrow({
                where: { id: paymentId },
            });
            const op = payment.refundOperation;
            if (op?.id !== operationId || payment.refundState !== 'PROCESSING')
                return;
            const booking = await tx.booking.findUniqueOrThrow({
                where: { id: payment.bookingId },
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
    refundMatches(payment, operation, refund) {
        const reference = refund?.transaction?.reference ?? refund?.transaction_reference;
        const transactionId = refund?.transaction?.id ??
            (typeof refund?.transaction !== 'object'
                ? refund?.transaction
                : undefined);
        return (refund?.id != null &&
            Number.isSafeInteger(Number(refund.amount)) &&
            Number(refund.amount) === (0, financial_allocation_1.exactKobo)(BigInt(operation.amountKobo)) &&
            refund.currency === operation.currency &&
            (reference === payment.providerRef ||
                (transactionId != null &&
                    String(transactionId) === payment.providerTransactionId)) &&
            (!operation.providerId || String(refund.id) === operation.providerId));
    }
    async applyRefundOutcome(payment, operationId, refund) {
        await this.atomic(async (tx) => {
            const current = await tx.transaction.findUniqueOrThrow({
                where: { id: payment.id },
            });
            const op = current.refundOperation;
            if (op?.id !== operationId || !op.dispatchedAt)
                return;
            const booking = await tx.booking.findUniqueOrThrow({
                where: { id: current.bookingId },
            });
            const settlement = await tx.settlement.findUniqueOrThrow({
                where: { bookingId: booking.id },
            });
            if (op.version !== settlement.financialVersion ||
                !this.refundMatches(current, op, refund)) {
                await this.touch(tx, booking, {
                    financialMode: 'REVIEW',
                    financialReviewReason: 'Refund result does not match its frozen instruction',
                });
                return;
            }
            const providerState = String(refund.status).toLowerCase();
            const state = providerState === 'processed'
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
            const recovered = state === 'SUCCESS' &&
                booking.financialMode === 'REVIEW' &&
                booking.financialVersion === op.version &&
                booking.financialReviewReason ===
                    'Refund submission outcome is unproven; do not submit another refund';
            await this.touch(tx, booking, ['FAILED', 'REQUIRES_REVIEW'].includes(state)
                ? {
                    financialMode: 'REVIEW',
                    financialReviewReason: 'Client refund requires provider/manual resolution',
                }
                : recovered
                    ? { financialMode: 'CANCELLATION', financialReviewReason: null }
                    : {});
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
    async reconcileRefund(payment) {
        const op = payment.refundOperation;
        if (!op?.dispatchedAt)
            return;
        try {
            if (op.providerId) {
                return this.applyRefundOutcome(payment, op.id, await this.paystack.fetchRefund(op.providerId));
            }
            const refunds = await this.paystack.listRefunds(payment.providerTransactionId);
            const matches = refunds.filter((refund) => this.refundMatches(payment, op, refund) &&
                String(refund.merchant_note ?? '').includes(op.id));
            if (matches.length === 1 && refunds.length === 1)
                return this.applyRefundOutcome(payment, op.id, matches[0]);
            await this.markRefundUnknown(payment.id, op.id);
            await this.review(payment.bookingId, 'Refund submission outcome is unproven; do not submit another refund');
        }
        catch (_error) {
            console.log(_error);
            await this.markRefundUnknown(payment.id, op.id);
        }
    }
    async processTransfer(bookingId) {
        const settlement = await this.prisma.settlement.findUnique({
            where: { bookingId },
        });
        if (!settlement?.purpose || !settlement.transactionId)
            return;
        if (['PROCESSING', 'REQUIRES_VERIFICATION', 'FAILED'].includes(settlement.operationState ?? '')) {
            return this.reconcileTransfer(settlement);
        }
        if (settlement.operationState !== 'PENDING' || !this.dispatchEnabled)
            return;
        const booking = await this.prisma.booking.findUniqueOrThrow({
            where: { id: bookingId },
            include: { vendor: true, services: true },
        });
        if (!this.matchesPlan(booking, settlement))
            return;
        const payment = await this.prisma.transaction.findUniqueOrThrow({
            where: { id: settlement.transactionId },
        });
        if (settlement.purpose === 'CANCELLATION_COMPENSATION' &&
            !['SUCCESS', 'NOT_REQUIRED'].includes(payment.refundState ?? ''))
            return;
        const paymentIds = settlement.paymentTransactionIds?.length
            ? settlement.paymentTransactionIds
            : settlement.transactionId
                ? [settlement.transactionId]
                : [];
        if (paymentIds.length === 0) {
            await this.review(bookingId, 'Settlement has no linked payment transactions');
            return;
        }
        const payments = await this.prisma.transaction.findMany({
            where: {
                id: { in: paymentIds },
                bookingId,
                vendorId: booking.vendorId,
            },
        });
        if (payments.length !== paymentIds.length) {
            await this.review(bookingId, 'Settlement payment records are missing or do not match the booking');
            return;
        }
        if (settlement.purpose === 'CANCELLATION_COMPENSATION' &&
            payments.length !== 1) {
            await this.review(bookingId, 'Multi-payment cancellation settlement requires reconciliation');
            return;
        }
        if (settlement.purpose === 'CANCELLATION_COMPENSATION' &&
            !['SUCCESS', 'NOT_REQUIRED'].includes(payments[0].refundState ?? '')) {
            return;
        }
        for (const payment of payments) {
            if (!(await this.checkExternalConflicts(settlement, payment))) {
                return;
            }
        }
        if (settlement.netTransferKobo == null ||
            settlement.netTransferKobo <= BigInt(0)) {
            await this.review(bookingId, 'Settlement has no valid vendor transfer amount');
            return;
        }
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
                where: { id: current.transactionId },
            });
            if (!this.matchesPlan(currentBooking, current) ||
                current.operationState !== 'PENDING' ||
                current.dispatchStartedAt ||
                (current.purpose === 'CANCELLATION_COMPENSATION' &&
                    !['SUCCESS', 'NOT_REQUIRED'].includes(currentPayment.refundState ?? '')))
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
                        ...(current.attemptHistory ?? []),
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
        if (!claimed)
            return;
        try {
            const transfer = await this.paystack.initiateTransfer({
                amount: (0, financial_allocation_1.exactKobo)(claimed?.netTransferKobo) / 100,
                recipientCode: claimed.recipientCode,
                reference: claimed.reference,
                reason: `Settlement for booking ${bookingId}`,
            });
            await this.applyTransferOutcome(claimed, transfer);
        }
        catch (_error) {
            console.log(_error);
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
    async applyTransferOutcome(expected, transfer) {
        await this.atomic(async (tx) => {
            const current = await tx.settlement.findUniqueOrThrow({
                where: { id: expected.id },
            });
            const booking = await tx.booking.findUniqueOrThrow({
                where: { id: current.bookingId },
            });
            const recipient = typeof transfer.recipient === 'object'
                ? transfer.recipient?.recipient_code
                : transfer.recipient;
            if (current.reference !== expected.reference) {
                if (['success', 'reversed'].includes(String(transfer.status).toLowerCase())) {
                    await this.touch(tx, booking, {
                        financialMode: 'REVIEW',
                        financialReviewReason: 'Late outcome from an older transfer attempt',
                    });
                }
                return;
            }
            if (transfer.reference !== expected.reference ||
                transfer.currency !== expected.currency ||
                !Number.isSafeInteger(transfer.amount) ||
                transfer.amount !== (0, financial_allocation_1.exactKobo)(expected.netTransferKobo) ||
                recipient !== expected.recipientCode ||
                !transfer.transfer_code ||
                (current.transferCode &&
                    transfer.transfer_code !== current.transferCode)) {
                this.logger.warn(`Transfer validation checks: ${JSON.stringify({
                    referenceMismatch: transfer.reference !== expected.reference,
                    currencyMismatch: transfer.currency !== expected.currency,
                    amountInvalid: !Number.isSafeInteger(transfer.amount),
                    amountMismatch: transfer.amount !== (0, financial_allocation_1.exactKobo)(expected.netTransferKobo),
                    recipientMismatch: recipient !== expected.recipientCode,
                    transferCodeMissing: !transfer.transfer_code,
                    transferCodeMismatch: current.transferCode != null &&
                        transfer.transfer_code !== current.transferCode,
                })}`);
                await this.touch(tx, booking, {
                    financialMode: 'REVIEW',
                    financialReviewReason: 'Transfer outcome conflicts with financial instruction',
                });
                return;
            }
            const providerState = String(transfer.status).toLowerCase();
            const state = providerState === 'success'
                ? 'SUCCESS'
                : providerState === 'failed'
                    ? 'FAILED'
                    : providerState === 'reversed'
                        ? 'REVERSED'
                        : ['pending', 'otp', 'received', 'queued'].includes(providerState)
                            ? 'PROCESSING'
                            : 'REQUIRES_VERIFICATION';
            if (current.operationState === 'REVERSED' ||
                (current.operationState === 'SUCCESS' && state !== 'REVERSED'))
                return;
            if (current.operationState === 'FAILED' &&
                !['FAILED', 'REVERSED'].includes(state)) {
                await this.touch(tx, booking, {
                    financialMode: 'REVIEW',
                    financialReviewReason: 'Conflicting terminal transfer results',
                });
                return;
            }
            await this.touch(tx, booking, state === 'REVERSED'
                ? {
                    financialMode: 'REVIEW',
                    financialReviewReason: 'Vendor transfer reversed',
                }
                : {});
            await tx.settlement.update({
                where: { id: current.id },
                data: {
                    operationState: state,
                    status: state,
                    providerState,
                    transferCode: transfer.transfer_code,
                    reconcileAfter: nextCheck(),
                    attemptHistory: json((current.attemptHistory ?? []).map((attempt) => attempt.reference === current.reference
                        ? {
                            ...attempt,
                            state,
                            transferCode: transfer.transfer_code,
                            checkedAt: new Date().toISOString(),
                        }
                        : attempt)),
                },
            });
            if (state === 'SUCCESS' && current.purpose === 'NORMAL_COMPLETION') {
                const paymentIds = current.paymentTransactionIds?.length
                    ? current.paymentTransactionIds
                    : current.transactionId
                        ? [current.transactionId]
                        : [];
                if (paymentIds.length === 0) {
                    await this.touch(tx, booking, {
                        financialMode: 'REVIEW',
                        financialReviewReason: 'Successful transfer has no linked payment transactions',
                    });
                    return;
                }
                await tx.transaction.updateMany({
                    where: {
                        id: { in: paymentIds },
                        bookingId: current.bookingId,
                        status: { in: ['PENDING', 'SUCCESS', 'success'] },
                    },
                    data: { status: 'COMPLETED' },
                });
            }
        });
    }
    async reconcileTransfer(settlement) {
        if (!settlement.reference)
            return this.review(settlement.bookingId, 'Missing historical transfer reference');
        try {
            const transfer = await this.paystack.verifyTransfer(settlement.reference);
            if (!transfer) {
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
            if (transfer.status?.toLowerCase() !== 'failed')
                return;
            await this.atomic(async (tx) => {
                const booking = await tx.booking.findUniqueOrThrow({
                    where: { id: settlement.bookingId },
                });
                const current = await tx.settlement.findUniqueOrThrow({
                    where: { id: settlement.id },
                });
                if (!this.matchesPlan(booking, current) ||
                    current.reference !== settlement.reference ||
                    current.operationState !== 'FAILED')
                    return;
                await this.touch(tx, booking);
                await tx.settlement.update({
                    where: { id: current.id },
                    data: {
                        reference: (0, crypto_1.randomUUID)(),
                        operationState: 'PENDING',
                        status: 'PENDING',
                        transferCode: null,
                        dispatchStartedAt: null,
                        providerState: null,
                        reconcileAfter: nextCheck(),
                    },
                });
            });
        }
        catch (_error) {
            console.log(_error);
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
    async handleWebhook(event, data) {
        if (event.startsWith('refund.')) {
            const reference = data?.transaction_reference ?? data?.transaction?.reference;
            if (!reference)
                return;
            const payment = await this.prisma.transaction.findUnique({
                where: { providerRef: reference },
            });
            if (!payment?.bookingId)
                return;
            if (!payment.refundOperation)
                return this.review(payment.bookingId, 'Unplanned Paystack refund event');
            if (payment.refundState === 'NOT_REQUIRED')
                return this.review(payment.bookingId, 'Unplanned refund against a zero-refund cancellation');
            const instruction = payment.refundOperation;
            if (instruction.providerId) {
                const refunds = await this.paystack.listRefunds(payment.providerTransactionId);
                if (refunds.some((refund) => String(refund.id) !== instruction.providerId)) {
                    return this.review(payment.bookingId, 'Additional provider refund conflicts with the frozen allocation');
                }
            }
            await this.reconcileRefund(payment);
            return this.processBooking(payment.bookingId);
        }
        if (event.startsWith('charge.dispute.')) {
            const reference = data?.transaction?.reference ?? data?.transaction_reference;
            if (!reference)
                return;
            const payment = await this.prisma.transaction.findUnique({
                where: { providerRef: reference },
            });
            if (payment?.bookingId)
                await this.review(payment.bookingId, 'Paystack payment dispute');
            return;
        }
        if (!event.startsWith('transfer.'))
            return;
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
        if (settlement?.purpose)
            return this.reconcileTransfer(settlement);
        if (settlement)
            return this.review(settlement.bookingId, 'Historical transfer event requires reconciliation');
        if (data?.reference &&
            ['transfer.success', 'transfer.reversed'].includes(event)) {
            const matches = (await this.prisma.settlement.aggregateRaw({
                pipeline: [
                    { $match: { 'attemptHistory.reference': String(data.reference) } },
                    { $project: { bookingId: 1 } },
                ],
            }));
            for (const match of matches) {
                const bookingId = typeof match.bookingId === 'string'
                    ? match.bookingId
                    : match.bookingId.$oid;
                await this.review(bookingId, 'Late outcome from an older transfer attempt');
            }
        }
    }
    async refundResponse(bookingId) {
        await this.processBooking(bookingId);
        const plan = await this.prisma.settlement.findUnique({
            where: { bookingId },
        });
        const payment = plan?.transactionId
            ? await this.prisma.transaction.findUnique({
                where: { id: plan.transactionId },
            })
            : null;
        const op = payment?.refundOperation;
        if (op?.response)
            return op.response;
        throw new common_1.ConflictException(op?.state === 'NOT_REQUIRED'
            ? 'Cancellation policy requires no client refund'
            : 'Cancellation refund is pending verification or financial review');
    }
};
exports.BookingFinanceService = BookingFinanceService;
exports.BookingFinanceService = BookingFinanceService = BookingFinanceService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        paystack_service_1.PaystackService,
        cancellation_policy_service_1.CancellationPolicyService])
], BookingFinanceService);
