"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VENDOR_CANCELLATION_TIER = exports.NO_SHOW_TIER = exports.STANDARD_CANCELLATION_TIERS = void 0;
exports.getClientCancellationTier = getClientCancellationTier;
exports.computeCancellationOutcome = computeCancellationOutcome;
exports.STANDARD_CANCELLATION_TIERS = [
    {
        label: '24+ hours before',
        minHoursBeforeStart: 24,
        clientRefundPercentage: 1,
        vendorCompensationPercentage: 0,
    },
    {
        label: '12-24 hours before',
        minHoursBeforeStart: 12,
        clientRefundPercentage: 0.9,
        vendorCompensationPercentage: 0.1,
    },
    {
        label: '2-12 hours before',
        minHoursBeforeStart: 2,
        clientRefundPercentage: 0.75,
        vendorCompensationPercentage: 0.25,
    },
    {
        label: '1-2 hours before',
        minHoursBeforeStart: 1,
        clientRefundPercentage: 0.5,
        vendorCompensationPercentage: 0.5,
    },
    {
        label: 'Less than 1 hour before',
        minHoursBeforeStart: 0,
        clientRefundPercentage: 0.25,
        vendorCompensationPercentage: 0.75,
    },
];
exports.NO_SHOW_TIER = {
    label: 'After appointment time / no-show',
    minHoursBeforeStart: -Infinity,
    clientRefundPercentage: 0,
    vendorCompensationPercentage: 1,
};
exports.VENDOR_CANCELLATION_TIER = {
    label: 'Vendor cancellation',
    minHoursBeforeStart: -Infinity,
    clientRefundPercentage: 1,
    vendorCompensationPercentage: 0,
};
function getClientCancellationTier(hoursUntilStart) {
    if (hoursUntilStart <= 0) {
        return exports.NO_SHOW_TIER;
    }
    return (exports.STANDARD_CANCELLATION_TIERS.find((tier) => hoursUntilStart >= tier.minHoursBeforeStart) ?? exports.NO_SHOW_TIER);
}
function computeCancellationOutcome(params) {
    const { amount, appointmentStart, cancelledAt, cancelledByRole } = params;
    if (cancelledByRole === 'VENDOR') {
        return {
            tier: exports.VENDOR_CANCELLATION_TIER,
            refundAmount: Math.round(amount * exports.VENDOR_CANCELLATION_TIER.clientRefundPercentage),
            vendorCompensationAmount: 0,
        };
    }
    const hoursUntilStart = (appointmentStart.getTime() - cancelledAt.getTime()) / (60 * 60 * 1000);
    const tier = getClientCancellationTier(hoursUntilStart);
    return {
        tier,
        refundAmount: Math.round(amount * tier.clientRefundPercentage),
        vendorCompensationAmount: Math.round(amount * tier.vendorCompensationPercentage),
    };
}
