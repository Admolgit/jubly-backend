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
exports.AvailabilityController = void 0;
const common_1 = require("@nestjs/common");
const availability_service_1 = require("./availability.service");
const role_guard_1 = require("../auth/role.guard");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const client_1 = require("@prisma/client");
const availability_dto_1 = require("./dto/availability.dto");
let AvailabilityController = class AvailabilityController {
    constructor(availabilityService) {
        this.availabilityService = availabilityService;
    }
    getVendorAvailableSlots(vendorId, serviceId, date) {
        return this.availabilityService.getAvailableSlots(vendorId, serviceId, date);
    }
    getAvailability(req) {
        return this.availabilityService.getAvailability(req.user.id);
    }
    getAvailabilityGrouped(req) {
        return this.availabilityService.getAvailabilityGrouped(req.user.id);
    }
    setAvailability(req, body) {
        return this.availabilityService.setAvailability(req.user.id, body);
    }
    deleteAvailability(req, dayOfWeek) {
        return this.availabilityService.deleteAvailability(req.user.id, dayOfWeek);
    }
    updateBufferTime(dto, req) {
        return this.availabilityService.updateBufferTime(req.user.id, dto);
    }
    getBufferTime(req) {
        const userId = req.user.id;
        return this.availabilityService.getExistingBufferTime(userId);
    }
};
exports.AvailabilityController = AvailabilityController;
__decorate([
    (0, common_1.Get)('slots/:vendorId/:date/:serviceId'),
    __param(0, (0, common_1.Param)('vendorId')),
    __param(1, (0, common_1.Param)('serviceId')),
    __param(2, (0, common_1.Param)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], AvailabilityController.prototype, "getVendorAvailableSlots", null);
__decorate([
    (0, common_1.Get)(''),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)(client_1.UserRole.VENDOR),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AvailabilityController.prototype, "getAvailability", null);
__decorate([
    (0, common_1.Get)('grouped-availability'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)(client_1.UserRole.VENDOR),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AvailabilityController.prototype, "getAvailabilityGrouped", null);
__decorate([
    (0, common_1.Post)(''),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)(client_1.UserRole.VENDOR),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, availability_dto_1.CreateVendorAvailabilityDto]),
    __metadata("design:returntype", void 0)
], AvailabilityController.prototype, "setAvailability", null);
__decorate([
    (0, common_1.Delete)(':dayOfWeek'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)(client_1.UserRole.VENDOR),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('dayOfWeek', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", void 0)
], AvailabilityController.prototype, "deleteAvailability", null);
__decorate([
    (0, common_1.Patch)('buffer-time'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)(client_1.UserRole.VENDOR),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AvailabilityController.prototype, "updateBufferTime", null);
__decorate([
    (0, common_1.Get)('buffer-time'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)(client_1.UserRole.VENDOR),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AvailabilityController.prototype, "getBufferTime", null);
exports.AvailabilityController = AvailabilityController = __decorate([
    (0, common_1.Controller)('availability'),
    __metadata("design:paramtypes", [availability_service_1.AvailabilityService])
], AvailabilityController);
