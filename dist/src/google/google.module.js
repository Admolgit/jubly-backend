"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleCalenderModule = void 0;
const common_1 = require("@nestjs/common");
const google_controller_1 = require("./google.controller");
const prisma_service_1 = require("../../prisma/prisma.service");
const google_service_1 = require("./google.service");
const config_1 = require("@nestjs/config");
const auth_service_1 = require("../auth/auth.service");
const nodemailer_service_1 = require("../nodemailer/nodemailer.service");
let GoogleCalenderModule = class GoogleCalenderModule {
};
exports.GoogleCalenderModule = GoogleCalenderModule;
exports.GoogleCalenderModule = GoogleCalenderModule = __decorate([
    (0, common_1.Module)({
        controllers: [google_controller_1.GoogleController],
        providers: [
            prisma_service_1.PrismaService,
            google_service_1.GoogleCalendarService,
            auth_service_1.AuthService,
            nodemailer_service_1.NodemailerService,
        ],
        exports: [],
        imports: [config_1.ConfigModule],
    })
], GoogleCalenderModule);
