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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaystackReconciliationService = void 0;
const common_1 = require("@nestjs/common");
const cron_1 = require("cron");
const prisma_service_1 = require("../../prisma/prisma.service");
const paystack_service_1 = require("./paystack.service");
const booking_service_1 = require("../booking/booking.service");
const transaction_service_1 = require("../transaction/transaction.service");
const nodemailer_service_1 = require("../nodemailer/nodemailer.service");
const PENDING_TRANSACTION_STALE_AFTER_MS = 20 * 60 * 1000;
const PENDING_TRANSACTION_ABANDON_AFTER_MS = 48 * 60 * 60 * 1000;
const SETTLEMENT_RETRY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 25;
let PaystackReconciliationService = class PaystackReconciliationService {
    constructor(prisma, paystackService, bookingService, transactionsService, mailService) {
        this.prisma = prisma;
        this.paystackService = paystackService;
        this.bookingService = bookingService;
        this.transactionsService = transactionsService;
        this.mailService = mailService;
    }
    onModuleInit() {
        new cron_1.CronJob('*/10 * * * *', () => {
            void this.reconcilePendingTransactions();
        }, null, true, 'Africa/Lagos');
        new cron_1.CronJob('*/30 * * * *', () => {
            void this.retryFailedSettlements();
        }, null, true, 'Africa/Lagos');
        new cron_1.CronJob('*/15 * * * *', () => {
            void this.cleanupExpiredSlotLocks();
        }, null, true, 'Africa/Lagos');
    }
    async reconcilePendingTransactions() {
        const staleThreshold = new Date(Date.now() - PENDING_TRANSACTION_STALE_AFTER_MS);
        const staleTransactions = await this.prisma.transaction.findMany({
            where: {
                bookingId: null,
                createdAt: { lt: staleThreshold },
            },
            orderBy: { createdAt: 'asc' },
            take: BATCH_SIZE,
        });
        for (const transaction of staleTransactions) {
            try {
                const verification = await this.paystackService.verifyTransaction(transaction.providerRef);
                const chargeData = verification.data;
                const chargeStatus = String(chargeData?.status || '').toLowerCase();
                if (chargeStatus === 'success') {
                    await this.finalizeSuccessfulCharge(chargeData);
                    continue;
                }
                const isDefinitivelyDead = ['failed', 'abandoned', 'reversed'].includes(chargeStatus);
                const isTooOldToKeepWaiting = Date.now() - transaction.createdAt.getTime() >
                    PENDING_TRANSACTION_ABANDON_AFTER_MS;
                if (isDefinitivelyDead || isTooOldToKeepWaiting) {
                    await this.prisma.transaction.update({
                        where: { id: transaction.id },
                        data: { status: 'FAILED' },
                    });
                }
            }
            catch (error) {
                console.error(`[PaystackReconciliation] Failed to reconcile transaction ${transaction.providerRef}:`, error instanceof Error ? error.message : error);
            }
        }
    }
    async finalizeSuccessfulCharge(chargeData) {
        const existing = await this.prisma.transaction.findUnique({
            where: { providerRef: chargeData.reference },
        });
        if (!existing || existing.bookingId) {
            return;
        }
        const { slug, vendorId, clientId, serviceId, title, email, userId, dayOfWeek, startTime, endTime, clientName, clientAddress, durationMins, businessName, vendorEmail, city, state, country, vendorUserId, phone, } = chargeData.metadata ?? {};
        if (!vendorId ||
            !vendorUserId ||
            !serviceId ||
            !clientId ||
            !email ||
            !dayOfWeek ||
            !startTime ||
            !endTime) {
            console.error(`[PaystackReconciliation] Incomplete metadata for transaction ${chargeData.reference}, cannot recover booking automatically`);
            return;
        }
        const auth = chargeData.authorization;
        const bank = auth?.bank || null;
        const accountName = auth?.account_name || null;
        const accountNumber = auth?.account_number || null;
        const paymentChannel = chargeData.channel || auth?.channel || 'unknown';
        const book = await this.bookingService.createBooking(vendorUserId, {
            userId: vendorUserId,
            clientId,
            serviceId,
            date: dayOfWeek,
            clientName,
            clientAddress,
            clientEmail: email,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            status: 'CONFIRMED',
        });
        await this.prisma.transaction.update({
            where: { providerRef: chargeData.reference },
            data: { bookingId: book.id },
        });
        const senderDetails = await this.prisma.senderDetails.create({
            data: {
                vendorId,
                email,
                senderName: accountName ?? clientName,
                senderAccountNumber: accountNumber,
                senderBankName: bank,
                senderDescription: 'Payment via Paystack (reconciled)',
            },
        });
        await this.transactionsService.updateTransaction(userId, {
            amount: chargeData.amount,
            senderDetailsId: senderDetails.id,
            status: 'PENDING',
            providerRef: chargeData.reference,
            paidAt: chargeData.paid_at,
            percentageFee: 0.05,
            bookingId: book.id,
            vendorId,
            slug,
            title,
            paymentMethod: paymentChannel,
            description: 'Payment via Paystack (reconciled)',
        });
        try {
            await this.mailService.sendClientBookingMail({
                clientEmail: email,
                serviceName: title,
                date: dayOfWeek,
                time: startTime,
                endTime,
                clientName,
                durationMins,
                businessName,
                address: `${city} ${state} ${country}`,
            });
            await this.mailService.sendVendorBookingMail({
                vendorEmail,
                clientName,
                clientEmail: email,
                serviceName: title,
                date: dayOfWeek,
                time: startTime,
                endTime,
                durationMins,
                phone,
            });
        }
        catch (err) {
            console.error('[PaystackReconciliation] Booking confirmation email failed:', err);
        }
    }
    async retryFailedSettlements() {
        const retryThreshold = new Date(Date.now() - SETTLEMENT_RETRY_MAX_AGE_MS);
        const failedSettlements = await this.prisma.settlement.findMany({
            where: {
                status: 'FAILED',
                createdAt: { gte: retryThreshold },
            },
            orderBy: { createdAt: 'asc' },
            take: BATCH_SIZE,
        });
        for (const settlement of failedSettlements) {
            if (!settlement.recipientCode) {
                continue;
            }
            try {
                const transfer = await this.paystackService.initiateTransfer({
                    amount: settlement.amount,
                    recipientCode: settlement.recipientCode,
                    reason: `Settlement retry for booking ${settlement.bookingId}`,
                    reference: `booking-${settlement.bookingId}-retry-${Date.now()}`,
                });
                const transferStatus = transfer.status?.toUpperCase() || 'PENDING';
                await this.prisma.settlement.update({
                    where: { id: settlement.id },
                    data: {
                        transferCode: transfer.transfer_code,
                        status: transferStatus,
                    },
                });
                if (transferStatus === 'SUCCESS') {
                    await this.prisma.transaction.updateMany({
                        where: {
                            bookingId: settlement.bookingId,
                            status: { not: 'COMPLETED' },
                        },
                        data: { status: 'COMPLETED' },
                    });
                }
            }
            catch (error) {
                console.error(`[PaystackReconciliation] Settlement retry failed for settlement ${settlement.id}:`, error instanceof Error ? error.message : error);
            }
        }
    }
    async cleanupExpiredSlotLocks() {
        try {
            await this.prisma.slotLock.deleteMany({
                where: { expiresAt: { lt: new Date() } },
            });
        }
        catch (error) {
            console.error('[PaystackReconciliation] Failed to clean up expired slot locks:', error instanceof Error ? error.message : error);
        }
    }
};
exports.PaystackReconciliationService = PaystackReconciliationService;
exports.PaystackReconciliationService = PaystackReconciliationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        paystack_service_1.PaystackService,
        booking_service_1.BookingService,
        transaction_service_1.TransactionService,
        nodemailer_service_1.NodemailerService])
], PaystackReconciliationService);
