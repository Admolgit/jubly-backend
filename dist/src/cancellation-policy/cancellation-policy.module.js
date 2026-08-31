"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancellationPolicyModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const cancellation_policy_controller_1 = require("./cancellation-policy.controller");
const cancellation_policy_repository_1 = require("./cancellation-policy.repository");
const cancellation_policy_service_1 = require("./cancellation-policy.service");
let CancellationPolicyModule = class CancellationPolicyModule {
};
exports.CancellationPolicyModule = CancellationPolicyModule;
exports.CancellationPolicyModule = CancellationPolicyModule = __decorate([
    (0, common_1.Module)({
        controllers: [cancellation_policy_controller_1.CancellationPolicyController],
        providers: [
            prisma_service_1.PrismaService,
            cancellation_policy_repository_1.CancellationPolicyRepository,
            cancellation_policy_service_1.CancellationPolicyService,
        ],
        exports: [cancellation_policy_service_1.CancellationPolicyService],
    })
], CancellationPolicyModule);
