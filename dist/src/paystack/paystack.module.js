"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaystackModule = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const paystack_service_1 = require("./paystack.service");
const paystack_controller_1 = require("./paystack.controller");
const transaction_service_1 = require("../transaction/transaction.service");
const nodemailer_service_1 = require("../nodemailer/nodemailer.service");
const booking_service_1 = require("../booking/booking.service");
const google_service_1 = require("../google/google.service");
const auth_service_1 = require("../auth/auth.service");
const config_1 = require("@nestjs/config");
const activityLog_service_1 = require("../activity/activityLog.service");
let PaystackModule = class PaystackModule {
};
exports.PaystackModule = PaystackModule;
exports.PaystackModule = PaystackModule = __decorate([
    (0, common_1.Module)({
        providers: [
            prisma_service_1.PrismaService,
            paystack_service_1.PaystackService,
            transaction_service_1.TransactionService,
            nodemailer_service_1.NodemailerService,
            booking_service_1.BookingService,
            google_service_1.GoogleCalendarService,
            auth_service_1.AuthService,
            config_1.ConfigService,
            activityLog_service_1.ActivityService,
        ],
        exports: [paystack_service_1.PaystackService],
        controllers: [paystack_controller_1.PaystackController],
        imports: [],
    })
], PaystackModule);
