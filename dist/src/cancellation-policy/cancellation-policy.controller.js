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
exports.CancellationPolicyController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const role_guard_1 = require("../auth/role.guard");
const cancellation_policy_service_1 = require("./cancellation-policy.service");
const cancellation_policy_dto_1 = require("./dto/cancellation-policy.dto");
let CancellationPolicyController = class CancellationPolicyController {
    constructor(cancellationPolicyService) {
        this.cancellationPolicyService = cancellationPolicyService;
    }
    getPolicy() {
        return this.cancellationPolicyService.getPolicy();
    }
    updatePolicy(dto, req) {
        return this.cancellationPolicyService.updatePolicy(dto, req.user.id);
    }
};
exports.CancellationPolicyController = CancellationPolicyController;
__decorate([
    (0, common_1.Get)(''),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)(client_1.UserRole.ADMIN),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CancellationPolicyController.prototype, "getPolicy", null);
__decorate([
    (0, common_1.Put)(''),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)(client_1.UserRole.ADMIN),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [cancellation_policy_dto_1.UpdateCancellationPolicyDto, Object]),
    __metadata("design:returntype", void 0)
], CancellationPolicyController.prototype, "updatePolicy", null);
exports.CancellationPolicyController = CancellationPolicyController = __decorate([
    (0, common_1.Controller)('admin/cancellation-policy'),
    __metadata("design:paramtypes", [cancellation_policy_service_1.CancellationPolicyService])
], CancellationPolicyController);
