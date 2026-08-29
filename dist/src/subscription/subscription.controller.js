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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionController = void 0;
const common_1 = require("@nestjs/common");
const common_2 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const role_guard_1 = require("../auth/role.guard");
const paystack_service_1 = require("../paystack/paystack.service");
const platform_settings_service_1 = require("../platform-settings/platform-settings.service");
const subscription_service_1 = require("./subscription.service");
let SubscriptionController = class SubscriptionController {
    constructor(prisma, paystackService, platformSettingsService, subscriptionService) {
        this.prisma = prisma;
        this.paystackService = paystackService;
        this.platformSettingsService = platformSettingsService;
        this.subscriptionService = subscriptionService;
    }
    async getStatus(req) {
        const vendor = await this.prisma.vendor.findFirst({
            where: { userId: req.user.id },
        });
        if (!vendor) {
            throw new common_2.NotFoundException('Vendor not found');
        }
        return this.subscriptionService.getStatus(vendor.id);
    }
    async upgrade(req) {
        const vendor = await this.prisma.vendor.findFirst({
            where: { userId: req.user.id },
        });
        if (!vendor) {
            throw new common_2.NotFoundException('Vendor not found');
        }
        const subscriptionsEnabled = await this.platformSettingsService.isSubscriptionsEnabled(vendor.id);
        if (!subscriptionsEnabled) {
            throw new common_2.BadRequestException('Subscriptions are not required while Jubly is free — there is nothing to upgrade to right now.');
        }
        const user = await this.prisma.user.findUnique({
            where: { id: req.user.id },
        });
        const { priceNaira, durationDays } = await this.platformSettingsService.getSubscriptionPricing(vendor.id);
        const { authorizationUrl, reference } = await this.paystackService.initializeTransaction(user?.email ?? '', priceNaira, {
            type: 'SUBSCRIPTION_UPGRADE',
            vendorId: vendor.id,
            plan: 'PREMIUM',
            durationDays,
        });
        return { paymentUrl: authorizationUrl, reference };
    }
};
exports.SubscriptionController = SubscriptionController;
__decorate([
    (0, common_1.Get)('status'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SubscriptionController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Post)('upgrade'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SubscriptionController.prototype, "upgrade", null);
exports.SubscriptionController = SubscriptionController = __decorate([
    (0, common_1.Controller)('subscription'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        paystack_service_1.PaystackService,
        platform_settings_service_1.PlatformSettingsService,
        subscription_service_1.SubscriptionService])
], SubscriptionController);
