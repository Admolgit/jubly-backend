"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var RescheduleNotificationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RescheduleNotificationService = void 0;
const common_1 = require("@nestjs/common");
let RescheduleNotificationService = RescheduleNotificationService_1 = class RescheduleNotificationService {
    constructor() {
        this.logger = new common_1.Logger(RescheduleNotificationService_1.name);
    }
    emit(event, payload) {
        this.logger.log(`[notification-placeholder] ${event} -> user:${payload.recipientUserId} booking:${payload.bookingId}`);
    }
};
exports.RescheduleNotificationService = RescheduleNotificationService;
exports.RescheduleNotificationService = RescheduleNotificationService = RescheduleNotificationService_1 = __decorate([
    (0, common_1.Injectable)()
], RescheduleNotificationService);
