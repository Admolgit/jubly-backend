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
exports.SubscriptionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
let SubscriptionService = class SubscriptionService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async isVendorSubscribed(vendorId) {
        const subscription = await this.prisma.subscription.findUnique({
            where: { vendorId },
        });
        if (!subscription || subscription.status !== 'ACTIVE') {
            return false;
        }
        if (subscription.expiresAt && subscription.expiresAt < new Date()) {
            return false;
        }
        return true;
    }
    async getStatus(vendorId) {
        const subscription = await this.prisma.subscription.findUnique({
            where: { vendorId },
        });
        const isActive = await this.isVendorSubscribed(vendorId);
        return (0, response_1.successResponse)({
            isActive,
            plan: subscription?.plan ?? null,
            status: subscription?.status ?? null,
            expiresAt: subscription?.expiresAt ?? null,
        }, 'Subscription status fetched successfully');
    }
    async activateSubscription(params) {
        const { vendorId, plan, durationDays, reference, amount } = params;
        const existing = await this.prisma.subscription.findUnique({
            where: { vendorId },
        });
        if (existing?.lastPaymentReference === reference) {
            return existing;
        }
        const now = new Date();
        const stillActive = existing?.status === 'ACTIVE' &&
            existing.expiresAt &&
            existing.expiresAt > now;
        const startPoint = stillActive ? existing.expiresAt : now;
        const expiresAt = new Date(startPoint.getTime() + durationDays * 24 * 60 * 60 * 1000);
        return this.prisma.subscription.upsert({
            where: { vendorId },
            update: {
                plan,
                status: 'ACTIVE',
                expiresAt,
                cancelledAt: null,
                lastPaymentReference: reference,
                lastPaymentAmount: amount,
                lastPaidAt: now,
            },
            create: {
                vendorId,
                plan,
                status: 'ACTIVE',
                startedAt: now,
                expiresAt,
                lastPaymentReference: reference,
                lastPaymentAmount: amount,
                lastPaidAt: now,
            },
        });
    }
};
exports.SubscriptionService = SubscriptionService;
exports.SubscriptionService = SubscriptionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SubscriptionService);
