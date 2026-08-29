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
exports.PlatformSettingsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
const subscription_service_1 = require("../subscription/subscription.service");
const OVERRIDABLE_FIELDS = [
    'subscriptionsEnabled',
    'defaultPlatformPercentage',
    'subscriberPlatformPercentage',
    'manualBookingEnabled',
    'paidByHandEnabled',
    'subscriptionPriceNaira',
    'subscriptionDurationDays',
];
let PlatformSettingsService = class PlatformSettingsService {
    constructor(prisma, subscriptionService) {
        this.prisma = prisma;
        this.subscriptionService = subscriptionService;
    }
    async getOrCreateSettings() {
        const existing = await this.prisma.platformSettings.findFirst();
        if (existing) {
            return existing;
        }
        return this.prisma.platformSettings.create({ data: {} });
    }
    async getSettings() {
        try {
            const settings = await this.getOrCreateSettings();
            return (0, response_1.successResponse)(settings, 'Platform settings fetched successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to fetch platform settings.', error.message);
        }
    }
    async updateSettings(dto, adminUserId) {
        try {
            const current = await this.getOrCreateSettings();
            const updated = await this.prisma.platformSettings.update({
                where: { id: current.id },
                data: {
                    ...dto,
                    updatedBy: adminUserId,
                },
            });
            return (0, response_1.successResponse)(updated, 'Platform settings updated successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to update platform settings.', error.message);
        }
    }
    async getEffectiveSettings(vendorId) {
        const global = await this.getOrCreateSettings();
        if (!vendorId) {
            return global;
        }
        const override = await this.prisma.vendorPlatformSettings.findUnique({
            where: { vendorId },
        });
        if (!override) {
            return global;
        }
        const effective = { ...global };
        for (const field of OVERRIDABLE_FIELDS) {
            const overrideValue = override[field];
            if (overrideValue !== null && overrideValue !== undefined) {
                effective[field] = overrideValue;
            }
        }
        return effective;
    }
    async resolvePlatformPercentage(vendorId) {
        const settings = await this.getEffectiveSettings(vendorId);
        if (!settings.subscriptionsEnabled) {
            return settings.defaultPlatformPercentage;
        }
        const isSubscribed = await this.subscriptionService.isVendorSubscribed(vendorId);
        return isSubscribed
            ? settings.subscriberPlatformPercentage
            : settings.defaultPlatformPercentage;
    }
    async canUsePaidByHand(vendorId) {
        const settings = await this.getEffectiveSettings(vendorId);
        if (!settings.paidByHandEnabled) {
            return false;
        }
        if (!settings.subscriptionsEnabled) {
            return true;
        }
        return this.subscriptionService.isVendorSubscribed(vendorId);
    }
    async isManualBookingEnabled(vendorId) {
        const settings = await this.getEffectiveSettings(vendorId);
        return settings.manualBookingEnabled;
    }
    async isSubscriptionsEnabled(vendorId) {
        const settings = await this.getEffectiveSettings(vendorId);
        return settings.subscriptionsEnabled;
    }
    async getSubscriptionPricing(vendorId) {
        const settings = await this.getEffectiveSettings(vendorId);
        return {
            priceNaira: settings.subscriptionPriceNaira,
            durationDays: settings.subscriptionDurationDays,
        };
    }
    async getVendorOverride(vendorId) {
        try {
            const override = await this.prisma.vendorPlatformSettings.findUnique({
                where: { vendorId },
            });
            const effective = await this.getEffectiveSettings(vendorId);
            return (0, response_1.successResponse)({ override, effective }, 'Vendor platform settings fetched successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to fetch vendor platform settings.', error.message);
        }
    }
    async updateVendorOverride(vendorId, dto, adminUserId) {
        try {
            const updated = await this.prisma.vendorPlatformSettings.upsert({
                where: { vendorId },
                update: { ...dto, updatedBy: adminUserId },
                create: { vendorId, ...dto, updatedBy: adminUserId },
            });
            return (0, response_1.successResponse)(updated, 'Vendor platform settings updated successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to update vendor platform settings.', error.message);
        }
    }
    async clearVendorOverride(vendorId) {
        try {
            await this.prisma.vendorPlatformSettings.deleteMany({
                where: { vendorId },
            });
            return (0, response_1.successResponse)(null, 'Vendor platform settings override removed — global settings now apply.');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to clear vendor platform settings.', error.message);
        }
    }
};
exports.PlatformSettingsService = PlatformSettingsService;
exports.PlatformSettingsService = PlatformSettingsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        subscription_service_1.SubscriptionService])
], PlatformSettingsService);
