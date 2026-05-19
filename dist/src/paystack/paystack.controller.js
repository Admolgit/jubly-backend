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
let PaystackController = class PaystackController {
    constructor(paystackService, prisma, transactionsService, mailService, bookingService) {
        this.paystackService = paystackService;
        this.prisma = prisma;
        this.transactionsService = transactionsService;
        this.mailService = mailService;
        this.bookingService = bookingService;
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
    async paystackWebhook(req, headers) {
        try {
            const secret = process.env.PAYSTACK_SECRET_KEY;
            const computedSignature = crypto
                .createHmac('sha512', secret)
                .update(req.rawBody)
                .digest('hex');
            const paystackSignature = headers['x-paystack-signature'];
            if (computedSignature !== paystackSignature) {
                throw new common_1.HttpException('Invalid signature', common_1.HttpStatus.UNAUTHORIZED);
            }
            const event = req.body;
            const paymentChannel = event.data.channel || event.data.authorization.channel || 'unknown';
            const auth = event.data.authorization;
            const bank = auth?.bank || null;
            const accountName = auth?.account_name || null;
            const accountNumber = auth?.account_number || null;
            const transactionExists = await this.prisma.transaction.findUnique({
                where: {
                    providerRef: event.data.reference,
                    status: 'CONFIRMED',
                },
            });
            if (transactionExists) {
                console.log(`Transaction with reference ${event.data.reference} already exists. Skipping processing.`);
                return { status: true };
            }
            if (event.event === 'charge.success') {
                const { slug, vendorId, clientId, serviceId, title, email, userId, dayOfWeek, durationMins, startTime, endTime, clientName, businessName, vendorEmail, city, state, country, vendorUserId, phone, } = event.data.metadata;
                console.log('event.data.metadata', event.data.metadata);
                const book = await this.bookingService.createBooking(vendorUserId, {
                    userId: vendorUserId,
                    clientId,
                    serviceId,
                    date: dayOfWeek,
                    clientName,
                    clientEmail: email,
                    startTime: new Date(startTime),
                    endTime: new Date(endTime),
                    status: 'CONFIRMED',
                });
                console.log({ book });
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
                console.log({ senderDetails });
                const dto = {
                    amount: event.data.amount,
                    senderDetailsId: senderDetails.id,
                    status: 'CONFIRMED',
                    providerRef: event.data.reference,
                    paidAt: event.data.paid_at,
                    percentageFee: 0.05,
                    vendorId: vendorId,
                    slug,
                    title,
                    paymentMethod: paymentChannel,
                    description: 'Payment via Paystack',
                };
                await this.transactionsService.updateTransaction(userId, dto);
                await this.mailService.sendClientBookingMail({
                    clientEmail: email,
                    serviceName: title,
                    date: dayOfWeek,
                    time: startTime,
                    endTime: endTime,
                    clientName: clientName,
                    durationMins: durationMins,
                    businessName: businessName,
                    address: `${city} ${state} ${country}`,
                });
                await this.mailService.sendVendorBookingMail({
                    vendorEmail: vendorEmail,
                    clientName: clientName,
                    clientEmail: vendorEmail,
                    serviceName: title,
                    date: dayOfWeek,
                    time: startTime,
                    endTime: endTime,
                    durationMins: durationMins,
                    phone,
                });
            }
            if (event.event === 'charge.failed') {
                const { slug, vendorId, bookingId, title, name, userId } = event.data.metadata;
                const senderDetails = await this.prisma.senderDetails.create({
                    data: {
                        vendorId: vendorId,
                        senderName: accountName,
                        senderAccountNumber: accountNumber,
                        senderBankName: bank,
                        senderDescription: 'Payment via Paystack',
                    },
                });
                const dto = {
                    amount: event.data.amount,
                    senderDetailsId: senderDetails.id,
                    status: 'failed',
                    name,
                    providerRef: event.data.reference,
                    paidAt: event.data.paid_at,
                    percentageFee: 0.05,
                    title,
                    slug,
                    bookingId,
                    vendorId,
                    paymentMethod: paymentChannel,
                };
                await this.transactionsService.create(userId, dto);
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
    __param(0, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PaystackController.prototype, "resolveBankAccount", null);
__decorate([
    (0, common_1.Get)('/verify-payment/:reference'),
    __param(0, (0, common_1.Param)('reference')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PaystackController.prototype, "verifyPayment", null);
__decorate([
    (0, common_1.Get)('/callback'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PaystackController.prototype, "handleCallback", null);
__decorate([
    (0, common_1.Post)('webhook'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Headers)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], PaystackController.prototype, "paystackWebhook", null);
__decorate([
    (0, common_1.Get)('list'),
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
        booking_service_1.BookingService])
], PaystackController);
