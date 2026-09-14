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
exports.ServicesController = void 0;
const common_1 = require("@nestjs/common");
const services_service_1 = require("./services.service");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const role_guard_1 = require("../auth/role.guard");
let ServicesController = class ServicesController {
    constructor(servicesService) {
        this.servicesService = servicesService;
    }
    getAllServices(req, query) {
        const { page = 1, limit = 10, search, isActive } = query;
        return this.servicesService.getAllServices(req.user.id, page, limit, search, isActive);
    }
    async getAllServicesAdmin(page = 1, limit = 10, search, isActive, date, month, year) {
        return this.servicesService.getAllServicesAdmin(Number(page), Number(limit), search, isActive, date, month ? Number(month) : undefined, year ? Number(year) : undefined);
    }
    updateServiceActive(req, serviceId, dto) {
        return this.servicesService.updateServiceActive(serviceId, req.user.id, dto.active);
    }
    getService(req, serviceId) {
        return this.servicesService.getServiceById(req.user.id, serviceId);
    }
};
exports.ServicesController = ServicesController;
__decorate([
    (0, common_1.Get)(''),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ServicesController.prototype, "getAllServices", null);
__decorate([
    (0, common_1.Get)('admin/all'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Query)('search')),
    __param(3, (0, common_1.Query)('isActive')),
    __param(4, (0, common_1.Query)('date')),
    __param(5, (0, common_1.Query)('month')),
    __param(6, (0, common_1.Query)('year')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String, String, Number, Number]),
    __metadata("design:returntype", Promise)
], ServicesController.prototype, "getAllServicesAdmin", null);
__decorate([
    (0, common_1.Patch)('update/:serviceId'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('serviceId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ServicesController.prototype, "updateServiceActive", null);
__decorate([
    (0, common_1.Get)(':serviceId'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('serviceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ServicesController.prototype, "getService", null);
exports.ServicesController = ServicesController = __decorate([
    (0, common_1.Controller)('services'),
    __metadata("design:paramtypes", [services_service_1.ServicesService])
], ServicesController);
