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
const auth_service_1 = require("../auth/auth.service");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const role_guard_1 = require("../auth/role.guard");
const prisma_service_1 = require("../../prisma/prisma.service");
let GoogleController = class GoogleController {
    constructor(googleService, authService, prisma) {
        this.googleService = googleService;
        this.authService = authService;
        this.prisma = prisma;
    }
    connectGoogleCalendar(userId, direction) {
        if (!userId)
            throw new common_1.BadRequestException('UserId required');
        const stateObj = { userId, direction };
        const state = encodeURIComponent(Buffer.from(JSON.stringify(stateObj)).toString('base64'));
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${process.env.GOOGLE_CLIENT_ID}` +
            `&redirect_uri=${process.env.GOOGLE_CALLBACK_URL}` +
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
        let frontendRedirectUrl = `${process.env.FRONTEND_BASE_URL}/dashboard?calendarLinked=true&userId=${encodeURIComponent(result.userId)}&accessToken=${encodeURIComponent(result.accessToken)}&access_token=${encodeURIComponent(appJwt)}`;
        if (parsedState.direction === 'onboarding') {
            frontendRedirectUrl = `${process.env.FRONTEND_BASE_URL}/vendor-availability?calendarLinked=true&userId=${encodeURIComponent(result.userId)}&accessToken=${encodeURIComponent(result.accessToken)}&access_token=${encodeURIComponent(appJwt)}`;
        }
        await this.prisma.vendor.update({
            where: {
                userId: parsedState.userId,
            },
            data: {
                onboardingCompleted: true,
            },
        });
        return res.redirect(frontendRedirectUrl);
    }
    getCalenderLinkedStatus(userId) {
        if (!userId)
            throw new common_1.BadRequestException('UserId required');
        return this.googleService.getUserCalendarLinked(userId);
    }
    getCalendar(view, year, month, date, vendorId) {
        return this.googleService.getCalendar({
            view,
            year: Number(year),
            month: Number(month),
            date,
            vendorId,
        });
    }
    getClientCalendar(req, view, year, month, date) {
        return this.googleService.getClientCalendar({
            userId: req.user.id,
            view,
            year: Number(year),
            month: Number(month),
            date,
        });
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
    (0, common_1.Get)('linked'),
    __param(0, (0, common_1.Query)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], GoogleController.prototype, "getCalenderLinkedStatus", null);
__decorate([
    (0, common_1.Get)('/calendar-list/:vendorId'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Query)('view')),
    __param(1, (0, common_1.Query)('year')),
    __param(2, (0, common_1.Query)('month')),
    __param(3, (0, common_1.Query)('date')),
    __param(4, (0, common_1.Query)('vendorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], GoogleController.prototype, "getCalendar", null);
__decorate([
    (0, common_1.Get)('/client/calendar-list'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('CLIENT'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('view')),
    __param(2, (0, common_1.Query)('year')),
    __param(3, (0, common_1.Query)('month')),
    __param(4, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], GoogleController.prototype, "getClientCalendar", null);
exports.GoogleController = GoogleController = __decorate([
    (0, common_1.Controller)('google'),
    __metadata("design:paramtypes", [google_service_1.GoogleCalendarService,
        auth_service_1.AuthService,
        prisma_service_1.PrismaService])
], GoogleController);
