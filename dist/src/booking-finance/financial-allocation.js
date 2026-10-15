"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kobo = kobo;
exports.exactKobo = exactKobo;
exports.vendorAllocation = vendorAllocation;
exports.cancellationAllocation = cancellationAllocation;
const paystackCalculation_1 = require("../utils/paystackCalculation");
const cancellation_policy_util_1 = require("../reschedule/cancellation-policy.util");
function kobo(naira) {
    const value = Math.round(naira * 100);
    if (!Number.isFinite(naira) || !Number.isSafeInteger(value) || value < 0) {
        throw new Error('Invalid monetary amount');
    }
    return value;
}
function exactKobo(value) {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error('Unrepresentable monetary amount');
    }
    return amount;
}
function vendorAllocation(gross, rate) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        throw new Error('Invalid captured commission rate');
    }
    const net = kobo(gross / 100 - (0, paystackCalculation_1.calculateJublyCommission)(gross / 100, rate));
    return { net, commission: gross - net };
}
function cancellationAllocation(params, rate) {
    const outcome = (0, cancellation_policy_util_1.computeCancellationOutcome)(params);
    const { clientRefundPercentage: refundRate, vendorCompensationPercentage: vendorRate, } = outcome.tier;
    if (![refundRate, vendorRate].every((r) => Number.isFinite(r) && r >= 0 && r <= 1) ||
        refundRate + vendorRate > 1) {
        throw new Error('Configured cancellation allocations exceed the principal');
    }
    const refund = exactKobo(outcome.refundAmount);
    const gross = exactKobo(outcome.vendorCompensationAmount);
    if (refund + gross > params.amount)
        throw new Error('Cancellation rounding exceeds the principal');
    return { ...outcome, refund, gross, ...vendorAllocation(gross, rate) };
}
