"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleController = void 0;
const common_1 = require("@nestjs/common");
const google_service_1 = require("./google.service");
const prisma_service_1 = require("../../prisma/prisma.service");
const auth_service_1 = require("../auth/auth.service");
let GoogleController = class GoogleController {
    constructor(googleService, prisma, authService) {
        this.googleService = googleService;
        this.prisma = prisma;
        this.authService = authService;
    }
    connectGoogleCalendar(userId, direction) {
        if (!userId)
            throw new common_1.BadRequestException('UserId required');
        const stateObj = { userId, direction };
        const state = encodeURIComponent(Buffer.from(JSON.stringify(stateObj)).toString('base64'));
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${process.env.GOOGLE_CLIENT_ID}` +
            `&redirect_uri=${process.env.GOOGLE_REDIRECT_URI}` +
            `&response_type=code` +
            `&scope=https://www.googleapis.com/auth/calendar` +
            `&access_type=offline` +
            `&prompt=consent` +
            `&state=${state}`;
        return { url: authUrl };
    }
    async googleRedirect(code, state, res) {
        if (!code)
            throw new common_1.BadRequestException('Code not provided');
        if (!state)
            throw new common_1.BadRequestException('State not provided');
        let parsedState;
        try {
            parsedState = JSON.parse(Buffer.from(decodeURIComponent(state), 'base64').toString());
        }
        catch {
            throw new common_1.BadRequestException('Invalid state');
        }
        const result = await this.googleService.saveTokens(parsedState.userId, code);
        const appJwt = this.authService.generateJwt(parsedState.userId);
        let frontendRedirectUrl = `${process.env.WEBSITE_URL}/app/home?calendarLinked=true&userId=${encodeURIComponent(result.userId)}&accessToken=${encodeURIComponent(result.accessToken)}&access_token=${encodeURIComponent(appJwt)}`;
        if (parsedState.direction === 'onboarding') {
            frontendRedirectUrl = `${process.env.WEBSITE_URL}/onboard/availability?calendarLinked=true&userId=${encodeURIComponent(result.userId)}&accessToken=${encodeURIComponent(result.accessToken)}&access_token=${encodeURIComponent(appJwt)}`;
        }
        return res.redirect(frontendRedirectUrl);
    }
    async googleCallback(req, code, res) {
        const tokens = await this.googleService.getTokens(code);
        console.log({ tokens });
        const userId = req.body.id;
        const vendor = await this.prisma.vendor.findUnique({
            where: {
                userId,
            },
        });
        if (!vendor) {
            throw new common_1.NotFoundException('Vendr not found');
        }
        return res.redirect('http://localhost:5173/dashboard');
    }
};
exports.GoogleController = GoogleController;
__decorate([
    (0, common_1.Get)('calendar'),
    __param(0, (0, common_1.Query)('userId')),
    __param(1, (0, common_1.Query)('direction')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], GoogleController.prototype, "connectGoogleCalendar", null);
__decorate([
    (0, common_1.Get)('callback'),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('state')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], GoogleController.prototype, "googleRedirect", null);
__decorate([
    (0, common_1.Get)('callback/no'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('code')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], GoogleController.prototype, "googleCallback", null);
exports.GoogleController = GoogleController = __decorate([
    (0, common_1.Controller)('google'),
    __metadata("design:paramtypes", [google_service_1.GoogleCalendarService,
        prisma_service_1.PrismaService,
        auth_service_1.AuthService])
], GoogleController);
