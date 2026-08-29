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
const platform_settings_service_1 = require("../platform-settings/platform-settings.service");
const activityLog_service_1 = require("../activity/activityLog.service");
const dateAndTimeConverter_1 = require("../utils/dateAndTimeConverter");
const PENDING_TRANSACTION_STALE_AFTER_MS = 20 * 60 * 1000;
const PENDING_TRANSACTION_ABANDON_AFTER_MS = 48 * 60 * 60 * 1000;
const SETTLEMENT_RETRY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 25;
let PaystackReconciliationService = class PaystackReconciliationService {
    constructor(prisma, paystackService, bookingService, transactionsService, mailService, platformSettingsService, activityService) {
        this.prisma = prisma;
        this.paystackService = paystackService;
        this.bookingService = bookingService;
        this.transactionsService = transactionsService;
        this.mailService = mailService;
        this.platformSettingsService = platformSettingsService;
        this.activityService = activityService;
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
        new cron_1.CronJob('*/15 * * * *', () => {
            void this.expireAbandonedVendorBookingLinks();
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
        if (chargeData.metadata?.type === 'VENDOR_CREATED_BOOKING_LINK') {
            return this.finalizeVendorCreatedBookingLinkCharge(chargeData);
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
        const percentageFee = await this.platformSettingsService.resolvePlatformPercentage(vendorId);
        await this.transactionsService.updateTransaction(userId, {
            amount: chargeData.amount,
            senderDetailsId: senderDetails.id,
            status: 'PENDING',
            providerRef: chargeData.reference,
            paidAt: chargeData.paid_at,
            percentageFee,
            bookingId: book.id,
            vendorId,
            slug,
            title,
            paymentMethod: paymentChannel,
            description: 'Payment via Paystack (reconciled)',
        });
        let vendorUserRecord = null;
        try {
            vendorUserRecord = await this.prisma.user.findUnique({
                where: { id: vendorUserId },
            });
        }
        catch (err) {
            console.error('[PaystackReconciliation] Failed to load vendor for receipt emails:', err);
        }
        try {
            await this.mailService.sendClientBookingMail({
                clientEmail: email,
                serviceName: title,
                vendorName: businessName,
                date: new Date(startTime).toDateString(),
                time: startTime,
                endTime,
                clientName,
                durationMins,
                businessName,
                phone: vendorUserRecord?.phone || '',
                address: `${city} ${state} ${country}`,
                transactionRef: chargeData.reference || '',
            });
        }
        catch (err) {
            console.error('[PaystackReconciliation] sendClientBookingMail failed:', err);
        }
        try {
            await this.mailService.sendVendorBookingMail({
                vendorEmail,
                clientName,
                clientEmail: email,
                serviceName: title,
                date: new Date(startTime).toDateString(),
                time: startTime,
                endTime,
                durationMins,
                phone,
                transactionRef: chargeData.reference,
            });
        }
        catch (err) {
            console.error('[PaystackReconciliation] sendVendorBookingMail failed:', err);
        }
    }
    async finalizeVendorCreatedBookingLinkCharge(chargeData) {
        const { bookingId, percentageFee, clientName, clientEmail, title } = chargeData.metadata ?? {};
        if (!bookingId) {
            console.error(`[PaystackReconciliation] Incomplete vendor-created-link metadata for transaction ${chargeData.reference}`);
            return;
        }
        const booking = await this.prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                services: true,
            },
        });
        if (!booking) {
            console.error(`[PaystackReconciliation] Vendor-created booking ${bookingId} not found for transaction ${chargeData.reference}`);
            return;
        }
        if (booking.paymentVerification === 'PAYSTACK_VERIFIED') {
            return;
        }
        const auth = chargeData.authorization;
        const bank = auth?.bank || null;
        const accountName = auth?.account_name || null;
        const accountNumber = auth?.account_number || null;
        const paymentChannel = chargeData.channel || auth?.channel || 'unknown';
        const updatedBooking = await this.prisma.booking.update({
            where: { id: bookingId },
            data: {
                status: 'CONFIRMED',
                paymentVerification: 'PAYSTACK_VERIFIED',
                paymentExpiresAt: null,
            },
        });
        const senderDetails = await this.prisma.senderDetails.create({
            data: {
                vendorId: booking.vendorId,
                email: clientEmail,
                senderName: accountName ?? clientName,
                senderAccountNumber: accountNumber,
                senderBankName: bank,
                senderDescription: 'Payment via Paystack (vendor-created link, reconciled)',
            },
        });
        await this.prisma.transaction.update({
            where: { providerRef: chargeData.reference },
            data: {
                bookingId: updatedBooking.id,
                status: 'PENDING',
                paidAt: new Date(),
                percentageFee: percentageFee ?? 0.05,
                paymentMethod: paymentChannel,
                senderDetailsId: senderDetails.id,
            },
        });
        await this.activityService.createLog({
            vendorId: booking.vendorId,
            action: 'PAYMENT_RECEIVED',
            description: `Payment of ₦${booking.amount?.toLocaleString() ?? ''} received for booking #${booking.id} (reconciled).`,
            actor: 'System',
            actorType: 'SYSTEM',
            color: 'yellow',
        });
        let bookingVendor = null;
        let vendorUser = null;
        try {
            bookingVendor = await this.prisma.vendor.findUnique({
                where: { id: booking.vendorId },
                include: {
                    services: true,
                },
            });
            vendorUser = bookingVendor
                ? await this.prisma.user.findUnique({
                    where: { id: bookingVendor.userId },
                })
                : null;
        }
        catch (err) {
            console.error('[PaystackReconciliation] Failed to load vendor for receipt emails:', err);
        }
        try {
            await this.mailService.sendClientBookingMail({
                clientEmail: booking.clientEmail,
                clientName: booking.clientName ?? clientName,
                serviceName: title,
                date: (0, dateAndTimeConverter_1.dateConverter)(updatedBooking.startTime),
                time: (0, dateAndTimeConverter_1.timeConverter)(updatedBooking.startTime),
                endTime: (0, dateAndTimeConverter_1.timeConverter)(updatedBooking.endTime),
                durationMins: Number(booking.services.durationMins),
                businessName: bookingVendor?.businessName || '',
                address: `${bookingVendor?.city} ${bookingVendor?.state} ${bookingVendor?.country}`,
                transactionRef: chargeData.reference,
            });
        }
        catch (err) {
            console.error('[PaystackReconciliation] sendClientBookingMail failed:', err);
        }
        if (vendorUser?.email) {
            try {
                await this.mailService.sendVendorBookingMail({
                    vendorEmail: vendorUser.email,
                    clientName: booking.clientName ?? clientName,
                    clientEmail: booking.clientEmail,
                    serviceName: title,
                    date: (0, dateAndTimeConverter_1.dateConverter)(updatedBooking.startTime),
                    time: (0, dateAndTimeConverter_1.timeConverter)(updatedBooking.startTime),
                    endTime: (0, dateAndTimeConverter_1.timeConverter)(updatedBooking.endTime),
                    phone: booking.clientPhone ?? '',
                    durationMins: Number(booking.services.durationMins),
                    transactionRef: chargeData.reference,
                });
            }
            catch (err) {
                console.error('[PaystackReconciliation] sendVendorBookingMail failed:', err);
            }
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
    async expireAbandonedVendorBookingLinks() {
        try {
            await this.prisma.booking.updateMany({
                where: {
                    status: 'PENDING',
                    source: 'VENDOR_CREATED',
                    paymentMethod: 'PAY_BY_LINK',
                    paymentExpiresAt: { lt: new Date() },
                },
                data: {
                    status: 'CANCELLED',
                    paymentVerification: 'UNVERIFIED',
                },
            });
        }
        catch (error) {
            console.error('[PaystackReconciliation] Failed to expire abandoned vendor booking links:', error instanceof Error ? error.message : error);
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
        nodemailer_service_1.NodemailerService,
        platform_settings_service_1.PlatformSettingsService,
        activityLog_service_1.ActivityService])
], PaystackReconciliationService);
