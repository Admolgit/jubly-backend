"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RescheduleModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const activityLog_service_1 = require("../activity/activityLog.service");
const google_service_1 = require("../google/google.service");
const nodemailer_service_1 = require("../nodemailer/nodemailer.service");
const cancellation_policy_module_1 = require("../cancellation-policy/cancellation-policy.module");
const reschedule_controller_1 = require("./reschedule.controller");
const reschedule_service_1 = require("./reschedule.service");
const reschedule_repository_1 = require("./reschedule.repository");
const reschedule_notification_service_1 = require("./events/reschedule-notification.service");
let RescheduleModule = class RescheduleModule {
};
exports.RescheduleModule = RescheduleModule;
exports.RescheduleModule = RescheduleModule = __decorate([
    (0, common_1.Module)({
        imports: [cancellation_policy_module_1.CancellationPolicyModule],
        controllers: [reschedule_controller_1.RescheduleController],
        providers: [
            prisma_service_1.PrismaService,
            config_1.ConfigService,
            activityLog_service_1.ActivityService,
            google_service_1.GoogleCalendarService,
            nodemailer_service_1.NodemailerService,
            reschedule_repository_1.RescheduleRepository,
            reschedule_notification_service_1.RescheduleNotificationService,
            reschedule_service_1.RescheduleService,
        ],
        exports: [reschedule_service_1.RescheduleService],
    })
], RescheduleModule);
