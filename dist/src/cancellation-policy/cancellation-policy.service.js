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
exports.CancellationPolicyService = void 0;
const common_1 = require("@nestjs/common");
const cancellation_policy_util_1 = require("../reschedule/cancellation-policy.util");
const response_1 = require("../utils/response");
const cancellation_policy_repository_1 = require("./cancellation-policy.repository");
let CancellationPolicyService = class CancellationPolicyService {
    constructor(repository) {
        this.repository = repository;
    }
    toEffectiveTiers(setting) {
        if (!setting || setting.tiers.length === 0) {
            return {
                tiers: cancellation_policy_util_1.STANDARD_CANCELLATION_TIERS,
                noShowPolicy: cancellation_policy_util_1.DEFAULT_NO_SHOW_POLICY,
            };
        }
        return {
            tiers: setting.tiers,
            noShowPolicy: setting.noShowTier ?? cancellation_policy_util_1.DEFAULT_NO_SHOW_POLICY,
        };
    }
    async getActiveTiers() {
        const setting = await this.repository.getSetting();
        return this.toEffectiveTiers(setting);
    }
    async getPolicy() {
        try {
            const setting = await this.repository.getSetting();
            const { tiers, noShowPolicy } = this.toEffectiveTiers(setting);
            return (0, response_1.successResponse)({
                tiers,
                noShowTier: noShowPolicy,
                isCustomized: Boolean(setting),
            }, 'Cancellation policy fetched successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to fetch cancellation policy.', error.message);
        }
    }
    async updatePolicy(dto, adminUserId) {
        try {
            this.assertValidTiers(dto.tiers);
            const updated = await this.repository.upsertSetting({
                tiers: dto.tiers,
                noShowTier: dto.noShowTier,
                updatedBy: adminUserId,
            });
            return (0, response_1.successResponse)(updated, 'Cancellation policy updated successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException)
                throw error;
            throw new common_1.InternalServerErrorException('Failed to update cancellation policy.', error.message);
        }
    }
    assertValidTiers(tiers) {
        if (!tiers || tiers.length === 0) {
            throw new common_1.BadRequestException('At least one tier is required');
        }
        const thresholds = tiers.map((tier) => tier.minHoursBeforeStart);
        const uniqueThresholds = new Set(thresholds);
        if (uniqueThresholds.size !== thresholds.length) {
            throw new common_1.BadRequestException('Tiers cannot share the same minHoursBeforeStart threshold');
        }
        if (!thresholds.includes(0)) {
            throw new common_1.BadRequestException('At least one tier must have minHoursBeforeStart set to 0, to cover the window up to the appointment time');
        }
    }
};
exports.CancellationPolicyService = CancellationPolicyService;
exports.CancellationPolicyService = CancellationPolicyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [cancellation_policy_repository_1.CancellationPolicyRepository])
], CancellationPolicyService);
