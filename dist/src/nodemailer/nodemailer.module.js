"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodemailerModule = void 0;
const common_1 = require("@nestjs/common");
const nodemailer_service_1 = require("./nodemailer.service");
const mailer_1 = require("@nestjs-modules/mailer");
let NodemailerModule = class NodemailerModule {
};
exports.NodemailerModule = NodemailerModule;
exports.NodemailerModule = NodemailerModule = __decorate([
    (0, common_1.Module)({
        controllers: [],
        exports: [nodemailer_service_1.NodemailerService],
        imports: [
            mailer_1.MailerModule.forRoot({
                transport: {
                    host: 'smtp.gmail.com',
                    port: 465,
                    secure: true,
                    auth: {
                        user: process.env.GMAIL_USER,
                        pass: process.env.GMAIL_APP_PASSWORD,
                    },
                    connectionTimeout: 10000,
                    greetingTimeout: 10000,
                    socketTimeout: 10000,
                },
            }),
        ],
        providers: [nodemailer_service_1.NodemailerService],
    })
], NodemailerModule);
