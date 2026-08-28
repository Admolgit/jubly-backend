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
exports.PlatformSettingsController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const role_guard_1 = require("../auth/role.guard");
const platform_settings_service_1 = require("./platform-settings.service");
const platform_settings_dto_1 = require("./dto/platform-settings.dto");
let PlatformSettingsController = class PlatformSettingsController {
    constructor(platformSettingsService) {
        this.platformSettingsService = platformSettingsService;
    }
    getSettings() {
        return this.platformSettingsService.getSettings();
    }
    updateSettings(dto, req) {
        return this.platformSettingsService.updateSettings(dto, req.user.id);
    }
};
exports.PlatformSettingsController = PlatformSettingsController;
__decorate([
    (0, common_1.Get)(''),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)(client_1.UserRole.ADMIN),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PlatformSettingsController.prototype, "getSettings", null);
__decorate([
    (0, common_1.Patch)(''),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)(client_1.UserRole.ADMIN),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [platform_settings_dto_1.UpdatePlatformSettingsDto, Object]),
    __metadata("design:returntype", void 0)
], PlatformSettingsController.prototype, "updateSettings", null);
exports.PlatformSettingsController = PlatformSettingsController = __decorate([
    (0, common_1.Controller)('admin/platform-settings'),
    __metadata("design:paramtypes", [platform_settings_service_1.PlatformSettingsService])
], PlatformSettingsController);
