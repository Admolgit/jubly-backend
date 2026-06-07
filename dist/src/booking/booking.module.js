"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingModule = void 0;
const common_1 = require("@nestjs/common");
const booking_controller_1 = require("./booking.controller");
const prisma_service_1 = require("../../prisma/prisma.service");
const config_1 = require("@nestjs/config");
const booking_service_1 = require("./booking.service");
const google_service_1 = require("../google/google.service");
const auth_service_1 = require("../auth/auth.service");
const nodemailer_service_1 = require("../nodemailer/nodemailer.service");
const paystack_service_1 = require("../paystack/paystack.service");
const activityLog_service_1 = require("../activity/activityLog.service");
let BookingModule = class BookingModule {
};
exports.BookingModule = BookingModule;
exports.BookingModule = BookingModule = __decorate([
    (0, common_1.Module)({
        controllers: [booking_controller_1.BookingController],
        imports: [],
        exports: [booking_service_1.BookingService],
        providers: [
            prisma_service_1.PrismaService,
            booking_service_1.BookingService,
            google_service_1.GoogleCalendarService,
            config_1.ConfigService,
            auth_service_1.AuthService,
            nodemailer_service_1.NodemailerService,
            paystack_service_1.PaystackService,
            activityLog_service_1.ActivityService,
        ],
    })
], BookingModule);
