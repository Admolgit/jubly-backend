"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinancialResponseInterceptor = void 0;
exports.publicFinancialResponse = publicFinancialResponse;
const common_1 = require("@nestjs/common");
const operators_1 = require("rxjs/operators");
const bookingFields = [
    'financialMode',
    'financialVersion',
    'financialReviewReason',
];
const transactionFields = [
    'servicePrincipalKobo',
    'expectedGrossChargeKobo',
    'verifiedChargedAmountKobo',
    'processingMarkupKobo',
    'providerTransactionId',
    'paymentEvidenceState',
    'paymentVerifiedAt',
    'checkoutSnapshot',
    'refundState',
    'refundOperation',
];
const settlementFields = [
    'purpose',
    'transactionId',
    'currency',
    'financialVersion',
    'principalKobo',
    'refundAllocationKobo',
    'grossVendorAllocationKobo',
    'commissionKobo',
    'netTransferKobo',
    'commissionRate',
    'policySnapshot',
    'operationState',
    'providerState',
    'dispatchStartedAt',
    'reconcileAfter',
    'attemptHistory',
];
function publicFinancialResponse(value) {
    if (Array.isArray(value))
        return value.map(publicFinancialResponse);
    if (!value ||
        typeof value !== 'object' ||
        value instanceof Date ||
        Buffer.isBuffer(value))
        return value;
    const hidden = new Set();
    if ('financialMode' in value || 'financialReviewReason' in value)
        bookingFields.forEach((key) => hidden.add(key));
    if ('servicePrincipalKobo' in value || 'refundOperation' in value)
        transactionFields.forEach((key) => hidden.add(key));
    if ('netTransferKobo' in value || 'operationState' in value)
        settlementFields.forEach((key) => hidden.add(key));
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !hidden.has(key))
        .map(([key, item]) => [key, publicFinancialResponse(item)]));
}
let FinancialResponseInterceptor = class FinancialResponseInterceptor {
    intercept(_context, next) {
        return next.handle().pipe((0, operators_1.map)(publicFinancialResponse));
    }
};
exports.FinancialResponseInterceptor = FinancialResponseInterceptor;
exports.FinancialResponseInterceptor = FinancialResponseInterceptor = __decorate([
    (0, common_1.Injectable)()
], FinancialResponseInterceptor);
