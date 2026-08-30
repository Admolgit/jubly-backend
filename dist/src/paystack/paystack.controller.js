"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaystackController = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const prisma_service_1 = require("../../prisma/prisma.service");
const paystack_service_1 = require("./paystack.service");
const transaction_service_1 = require("../transaction/transaction.service");
const nodemailer_service_1 = require("../nodemailer/nodemailer.service");
const booking_service_1 = require("../booking/booking.service");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const public_decorator_1 = require("../auth/public.decorator");
const role_guard_1 = require("../auth/role.guard");
const response_1 = require("../utils/response");
const activityLog_service_1 = require("../activity/activityLog.service");
const platform_settings_service_1 = require("../platform-settings/platform-settings.service");
const subscription_service_1 = require("../subscription/subscription.service");
const dateAndTimeConverter_1 = require("../utils/dateAndTimeConverter");
let PaystackController = class PaystackController {
    constructor(paystackService, prisma, transactionsService, mailService, bookingService, activityService, platformSettingsService, subscriptionService) {
        this.paystackService = paystackService;
        this.prisma = prisma;
        this.transactionsService = transactionsService;
        this.mailService = mailService;
        this.bookingService = bookingService;
        this.activityService = activityService;
        this.platformSettingsService = platformSettingsService;
        this.subscriptionService = subscriptionService;
    }
    resolveBankAccount(dto) {
        return this.paystackService.resolveBankAccount(dto.accountNumber, dto.bankCode);
    }
    verifyPayment(reference) {
        return this.paystackService.verifyTransaction(reference);
    }
    handleCallback(req, res) {
        const reference = req.query.reference;
        return res.redirect(`${process.env.FRONTEND_BASE_URL}/verify-payment?reference=${reference}`);
    }
    async refundPayment(req, dto) {
        if (!dto.providerRef && !dto.bookingId) {
            throw new common_1.BadRequestException('providerRef or bookingId is required');
        }
        const transaction = await this.prisma.transaction.findFirst({
            where: {
                providerRef: dto.providerRef,
                bookingId: dto.bookingId,
            },
            include: {
                vendor: true,
            },
        });
        if (!transaction) {
            throw new common_1.BadRequestException('Transaction not found');
        }
        if (req.user.role === 'VENDOR' &&
            transaction.vendor.userId !== req.user.id) {
            throw new common_1.ForbiddenException('Not allowed to refund this transaction');
        }
        if (transaction.status === 'COMPLETED') {
            throw new common_1.BadRequestException('This payment has already been settled to the vendor');
        }
        if (transaction.status === 'REFUNDED') {
            throw new common_1.BadRequestException('This payment has already been refunded');
        }
        if (transaction.status === 'REFUND_PENDING') {
            throw new common_1.BadRequestException('A refund is already pending');
        }
        if (['failed', 'CANCELLED'].includes(transaction.status)) {
            throw new common_1.BadRequestException('Only successful payments can be refunded');
        }
        const activeSettlement = await this.prisma.settlement.findFirst({
            where: {
                bookingId: transaction.bookingId || '',
                status: {
                    in: ['PENDING', 'SUCCESS'],
                },
            },
        });
        if (activeSettlement) {
            throw new common_1.BadRequestException('This payment has already been sent to vendor settlement');
        }
        if (dto.amount !== undefined && dto.amount > transaction.amount) {
            throw new common_1.BadRequestException('Refund amount cannot be more than transaction amount');
        }
        if (dto.amount !== undefined && dto.amount <= 0) {
            throw new common_1.BadRequestException('Refund amount must be greater than zero');
        }
        const refund = await this.paystackService.createRefund({
            transaction: transaction.providerRef,
            amount: dto.amount,
            customerNote: dto.customerNote,
            merchantNote: dto.merchantNote,
        });
        await this.prisma.transaction.update({
            where: {
                id: transaction.id,
            },
            data: {
                status: refund.status?.toLowerCase?.() === 'processed'
                    ? 'REFUNDED'
                    : 'REFUND_PENDING',
            },
        });
        if (transaction.bookingId) {
            await this.prisma.booking.update({
                where: {
                    id: transaction.bookingId,
                },
                data: {
                    status: 'CANCELLED',
                },
            });
        }
        return (0, response_1.successResponse)(refund, 'Refund initiated successfully', 201);
    }
    async paystackWebhook(req, headers) {
        try {
            const secret = process.env.PAYSTACK_SECRET_KEY;
            const rawBody = req.rawBody;
            const paystackSignature = headers['x-paystack-signature'];
            if (!rawBody || !paystackSignature) {
                throw new common_1.HttpException('Missing Paystack webhook signature or raw body', common_1.HttpStatus.UNAUTHORIZED);
            }
            const computedSignature = crypto
                .createHmac('sha512', secret)
                .update(rawBody)
                .digest('hex');
            const signaturesMatch = paystackSignature.length === computedSignature.length &&
                crypto.timingSafeEqual(Buffer.from(computedSignature, 'utf8'), Buffer.from(paystackSignature, 'utf8'));
            if (!signaturesMatch) {
                throw new common_1.HttpException('Invalid signature', common_1.HttpStatus.UNAUTHORIZED);
            }
            const event = req.body;
            if (!event?.data?.reference) {
                throw new common_1.BadRequestException('Invalid Paystack webhook payload');
            }
            if (event.event !== 'charge.success') {
                return { status: true };
            }
            const paymentChannel = event.data.channel || event.data.authorization?.channel || 'unknown';
            const auth = event.data.authorization;
            const bank = auth?.bank || null;
            const accountName = auth?.account_name || null;
            const accountNumber = auth?.account_number || null;
            if (event.data.metadata?.type === 'SUBSCRIPTION_UPGRADE') {
                const { vendorId, plan, durationDays } = event.data.metadata;
                if (!vendorId) {
                    throw new common_1.BadRequestException('Incomplete subscription metadata');
                }
                await this.subscriptionService.activateSubscription({
                    vendorId,
                    plan: plan || 'PREMIUM',
                    durationDays: Number(durationDays) || 30,
                    reference: event.data.reference,
                    amount: event.data.amount / 100,
                });
                await this.activityService.createLog({
                    vendorId,
                    action: 'SUBSCRIPTION_ACTIVATED',
                    description: `Subscription payment of ₦${(event.data.amount / 100).toLocaleString()} confirmed.`,
                    actor: 'System',
                    actorType: 'SYSTEM',
                    color: 'green',
                });
                return { status: true };
            }
            const transactionExists = await this.prisma.transaction.findUnique({
                where: {
                    providerRef: event.data.reference,
                },
            });
            if (!transactionExists) {
                throw new common_1.BadRequestException('Transaction was not initialized');
            }
            if (transactionExists.bookingId) {
                return { status: true };
            }
            if (event.data.metadata?.type === 'VENDOR_CREATED_BOOKING_LINK') {
                const { bookingId, percentageFee, clientName, clientEmail, title } = event.data.metadata;
                if (!bookingId) {
                    throw new common_1.BadRequestException('Incomplete booking metadata for link');
                }
                const booking = await this.prisma.booking.findUnique({
                    where: { id: bookingId },
                    include: {
                        services: true,
                    },
                });
                if (!booking) {
                    throw new common_1.BadRequestException('Vendor-created booking was not found');
                }
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
                        senderDescription: 'Payment via Paystack (vendor-created link)',
                    },
                });
                await this.prisma.transaction.update({
                    where: { providerRef: event.data.reference },
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
                    description: `Payment of ₦${booking.amount?.toLocaleString() ?? ''} received for booking #${booking.id}.`,
                    actor: 'System',
                    actorType: 'SYSTEM',
                    color: 'yellow',
                });
                let bookingVendor = null;
                let vendorUser = null;
                try {
                    bookingVendor = await this.prisma.vendor.findUnique({
                        where: { id: booking.vendorId },
                    });
                    vendorUser = bookingVendor
                        ? await this.prisma.user.findUnique({
                            where: { id: bookingVendor.userId },
                        })
                        : null;
                }
                catch (err) {
                    console.error('Failed to load vendor for receipt emails:', err);
                }
                setImmediate(() => {
                    void (async () => {
                        try {
                            await this.mailService.sendClientBookingMail({
                                clientEmail: booking.clientEmail,
                                clientName: booking.clientName ?? clientName,
                                serviceName: title,
                                date: (0, dateAndTimeConverter_1.dateConverter)(updatedBooking.startTime),
                                time: (0, dateAndTimeConverter_1.timeConverter)(updatedBooking.startTime),
                                endTime: (0, dateAndTimeConverter_1.timeConverter)(updatedBooking.endTime),
                                durationMins: Number(booking.services.durationMins ?? 60),
                                businessName: bookingVendor?.businessName || '',
                                phone: vendorUser?.phone || '',
                                address: `${bookingVendor?.city} ${bookingVendor?.state} ${bookingVendor?.country}`,
                                transactionRef: event.data.reference,
                            });
                        }
                        catch (err) {
                            console.error('sendClientBookingMail failed:', err);
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
                                    durationMins: Number(booking.services.durationMins ?? 60),
                                    transactionRef: event.data.reference,
                                });
                            }
                            catch (err) {
                                console.error('sendVendorBookingMail failed:', err);
                            }
                        }
                    })();
                });
                return { status: true };
            }
            {
                const { slug, vendorId, clientId, serviceId, title, email, userId, dayOfWeek, startTime, endTime, clientName, clientAddress, durationMins, businessName, vendorEmail, city, state, country, vendorUserId, phone, } = event.data.metadata;
                if (!vendorId ||
                    !vendorUserId ||
                    !serviceId ||
                    !clientId ||
                    !email ||
                    dayOfWeek == null ||
                    !startTime ||
                    !endTime) {
                    throw new common_1.BadRequestException('Incomplete booking metadata in marketplace');
                }
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
                    phone: phone || '',
                });
                await this.prisma.transaction.update({
                    where: { providerRef: event.data.reference },
                    data: { bookingId: book.id },
                });
                const senderDetails = await this.prisma.senderDetails.create({
                    data: {
                        vendorId: vendorId,
                        email: email,
                        senderName: accountName ?? clientName,
                        senderAccountNumber: accountNumber,
                        senderBankName: bank,
                        senderDescription: 'Payment via Paystack',
                    },
                });
                const percentageFee = await this.platformSettingsService.resolvePlatformPercentage(vendorId);
                const dto = {
                    senderDetailsId: senderDetails.id,
                    status: 'PENDING',
                    providerRef: event.data.reference,
                    paidAt: event.data.paid_at,
                    percentageFee,
                    bookingId: book.id,
                    vendorId,
                    slug,
                    title,
                    paymentMethod: paymentChannel,
                    description: 'Payment via Paystack',
                };
                await this.transactionsService.updateTransaction(userId, dto);
                let vendorUserRecord = null;
                try {
                    vendorUserRecord = await this.prisma.user.findUnique({
                        where: { id: vendorUserId },
                    });
                }
                catch (err) {
                    console.error('Failed to load vendor for receipt emails:', err);
                }
                setImmediate(() => {
                    void (async () => {
                        try {
                            await this.mailService.sendClientBookingMail({
                                clientEmail: email,
                                serviceName: title,
                                vendorName: businessName,
                                date: (0, dateAndTimeConverter_1.dateConverter)(startTime),
                                time: (0, dateAndTimeConverter_1.timeConverter)(startTime),
                                endTime: (0, dateAndTimeConverter_1.timeConverter)(endTime),
                                clientName: clientName,
                                durationMins: durationMins,
                                phone: vendorUserRecord?.phone || '',
                                businessName: businessName,
                                address: `${city} ${state} ${country}`,
                                transactionRef: event.data.reference,
                            });
                        }
                        catch (err) {
                            console.error('sendClientBookingMail failed:', err);
                        }
                        try {
                            await this.mailService.sendVendorBookingMail({
                                vendorEmail: vendorEmail,
                                clientName: clientName,
                                clientEmail: email,
                                serviceName: title,
                                date: (0, dateAndTimeConverter_1.dateConverter)(startTime),
                                time: (0, dateAndTimeConverter_1.timeConverter)(startTime),
                                endTime: (0, dateAndTimeConverter_1.timeConverter)(endTime),
                                durationMins: durationMins,
                                phone,
                                transactionRef: event.data.reference,
                            });
                        }
                        catch (err) {
                            console.error('sendVendorBookingMail failed:', err);
                        }
                    })();
                });
            }
            return { status: true };
        }
        catch (error) {
            console.error('❌ ERROR in Webhook:', error);
            throw new common_1.HttpException('Webhook processing error', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    getBankList() {
        return this.paystackService.getBankList();
    }
};
exports.PaystackController = PaystackController;
__decorate([
    (0, common_1.Get)('/resolve-bank/:accountNumber/:bankCode'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PaystackController.prototype, "resolveBankAccount", null);
__decorate([
    (0, common_1.Get)('/verify-payment/:reference'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Param)('reference')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PaystackController.prototype, "verifyPayment", null);
__decorate([
    (0, common_1.Get)('/callback'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PaystackController.prototype, "handleCallback", null);
__decorate([
    (0, common_1.Post)('/refund'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN', 'VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PaystackController.prototype, "refundPayment", null);
__decorate([
    (0, common_1.Post)('webhook'),
    (0, public_decorator_1.Public)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PaystackController.prototype, "paystackWebhook", null);
__decorate([
    (0, common_1.Get)('list'),
    (0, public_decorator_1.Public)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PaystackController.prototype, "getBankList", null);
exports.PaystackController = PaystackController = __decorate([
    (0, common_1.Controller)('paystack'),
    __metadata("design:paramtypes", [paystack_service_1.PaystackService,
        prisma_service_1.PrismaService,
        transaction_service_1.TransactionService,
        nodemailer_service_1.NodemailerService,
        booking_service_1.BookingService,
        activityLog_service_1.ActivityService,
        platform_settings_service_1.PlatformSettingsService,
        subscription_service_1.SubscriptionService])
], PaystackController);
