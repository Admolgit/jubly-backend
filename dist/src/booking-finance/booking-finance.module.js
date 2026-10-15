"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingFinanceModule = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const prisma_service_1 = require("../../prisma/prisma.service");
const cancellation_policy_module_1 = require("../cancellation-policy/cancellation-policy.module");
const paystack_service_1 = require("../paystack/paystack.service");
const booking_finance_service_1 = require("./booking-finance.service");
const financial_response_interceptor_1 = require("./financial-response.interceptor");
let BookingFinanceModule = class BookingFinanceModule {
};
exports.BookingFinanceModule = BookingFinanceModule;
exports.BookingFinanceModule = BookingFinanceModule = __decorate([
    (0, common_1.Module)({
        imports: [cancellation_policy_module_1.CancellationPolicyModule],
        providers: [
            prisma_service_1.PrismaService,
            paystack_service_1.PaystackService,
            booking_finance_service_1.BookingFinanceService,
            { provide: core_1.APP_INTERCEPTOR, useClass: financial_response_interceptor_1.FinancialResponseInterceptor },
        ],
        exports: [booking_finance_service_1.BookingFinanceService],
    })
], BookingFinanceModule);
