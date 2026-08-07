"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const auth_module_1 = require("./auth/auth.module");
const jwt_1 = require("@nestjs/jwt");
const userAgent_middleware_1 = require("./middlewares/userAgent.middleware");
const prisma_module_1 = require("../prisma/prisma.module");
const vendor_module_1 = require("./vendor/vendor.module");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const jwt_authGuard_1 = require("./auth/jwt.authGuard");
const transaction_module_1 = require("./transaction/transaction.module");
const paystack_module_1 = require("./paystack/paystack.module");
const availability_module_1 = require("./availability/availability.module");
const nodemailer_module_1 = require("./nodemailer/nodemailer.module");
const google_module_1 = require("./google/google.module");
const booking_module_1 = require("./booking/booking.module");
const users_module_1 = require("./users/users.module");
const services_module_1 = require("./services/services.module");
const activityLog_module_1 = require("./activity/activityLog.module");
const reschedule_module_1 = require("./reschedule/reschedule.module");
let AppModule = class AppModule {
    configure(consumer) {
        consumer
            .apply(userAgent_middleware_1.UserAgentMiddleware)
            .forRoutes({ path: '*', method: common_1.RequestMethod.ALL });
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            jwt_1.JwtModule.register({
                global: true,
                secret: process.env.JWT_SECRET,
                signOptions: { expiresIn: '1h', algorithm: 'HS512' },
            }),
            auth_module_1.AuthModule,
            prisma_module_1.PrismaModule,
            vendor_module_1.VendorModule,
            transaction_module_1.TransactionModule,
            paystack_module_1.PaystackModule,
            availability_module_1.AvailabilityModule,
            nodemailer_module_1.NodemailerModule,
            google_module_1.GoogleCalenderModule,
            booking_module_1.BookingModule,
            users_module_1.UsersModule,
            services_module_1.ServicesModule,
            activityLog_module_1.ActivityLogModule,
            reschedule_module_1.RescheduleModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [
            app_service_1.AppService,
            {
                provide: core_1.APP_GUARD,
                useClass: jwt_authGuard_1.JwtAuthGuard,
            },
            config_1.ConfigService,
        ],
    })
], AppModule);
