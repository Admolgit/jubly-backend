"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const auth_controller_1 = require("./auth.controller");
const auth_service_1 = require("./auth.service");
const passport_1 = require("@nestjs/passport");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("../../prisma/prisma.service");
const vendor_service_1 = require("../vendor/vendor.service");
const cloudinary_service_1 = require("../infrastructure/cloudinary.service");
const paystack_service_1 = require("../paystack/paystack.service");
const nodemailer_module_1 = require("../nodemailer/nodemailer.module");
const google_login_strategy_middleware_1 = require("../middlewares/google-login-strategy.middleware");
const activityLog_service_1 = require("../activity/activityLog.service");
const jwt_strategy_1 = require("./jwt.strategy");
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        controllers: [auth_controller_1.AuthController],
        imports: [
            passport_1.PassportModule.register({ defaultStrategy: 'jwt', session: true }),
            jwt_1.JwtModule.register({
                secret: process.env.JWT_SECRET,
                signOptions: { expiresIn: '14d' },
            }),
            passport_1.PassportModule,
            nodemailer_module_1.NodemailerModule,
        ],
        providers: [
            auth_service_1.AuthService,
            prisma_service_1.PrismaService,
            vendor_service_1.VendorService,
            cloudinary_service_1.CloudinaryService,
            paystack_service_1.PaystackService,
            google_login_strategy_middleware_1.GoogleLoginStrategy,
            activityLog_service_1.ActivityService,
            jwt_strategy_1.JwtStrategy,
        ],
        exports: [jwt_1.JwtModule, passport_1.PassportModule, nodemailer_module_1.NodemailerModule],
    })
], AuthModule);
