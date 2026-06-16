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
exports.ActivityLogController = void 0;
const common_1 = require("@nestjs/common");
const activityLog_service_1 = require("./activityLog.service");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const role_guard_1 = require("../auth/role.guard");
let ActivityLogController = class ActivityLogController {
    constructor(activityService) {
        this.activityService = activityService;
    }
    getLogsByUserId(req) {
        const userId = req.user.id;
        return this.activityService.getLogsByUserId(userId);
    }
};
exports.ActivityLogController = ActivityLogController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR', 'CLIENT'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ActivityLogController.prototype, "getLogsByUserId", null);
exports.ActivityLogController = ActivityLogController = __decorate([
    (0, common_1.Controller)('activity-logs'),
    __metadata("design:paramtypes", [activityLog_service_1.ActivityService])
], ActivityLogController);
