"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timeConverter = exports.dateConverter = void 0;
const dateConverter = (date) => {
    return new Date(date).toLocaleDateString('en-NG', {
        timeZone: 'Africa/Lagos',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
};
exports.dateConverter = dateConverter;
const timeConverter = (time) => {
    return new Date(time).toLocaleTimeString('en-NG', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
    });
};
exports.timeConverter = timeConverter;
