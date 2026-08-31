"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RescheduleNotificationEvent = void 0;
var RescheduleNotificationEvent;
(function (RescheduleNotificationEvent) {
    RescheduleNotificationEvent["BOOKING_RESCHEDULE_REQUESTED"] = "BOOKING_RESCHEDULE_REQUESTED";
    RescheduleNotificationEvent["BOOKING_RESCHEDULE_ACCEPTED"] = "BOOKING_RESCHEDULE_ACCEPTED";
    RescheduleNotificationEvent["BOOKING_RESCHEDULE_REJECTED"] = "BOOKING_RESCHEDULE_REJECTED";
    RescheduleNotificationEvent["BOOKING_RESCHEDULE_COUNTER_PROPOSED"] = "BOOKING_RESCHEDULE_COUNTER_PROPOSED";
    RescheduleNotificationEvent["BOOKING_CANCELLED"] = "BOOKING_CANCELLED";
})(RescheduleNotificationEvent || (exports.RescheduleNotificationEvent = RescheduleNotificationEvent = {}));
