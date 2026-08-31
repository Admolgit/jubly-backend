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
exports.RescheduleController = void 0;
const common_1 = require("@nestjs/common");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const role_guard_1 = require("../auth/role.guard");
const reschedule_service_1 = require("./reschedule.service");
const reschedule_dto_1 = require("./dto/reschedule.dto");
let RescheduleController = class RescheduleController {
    constructor(rescheduleService) {
        this.rescheduleService = rescheduleService;
    }
    requestReschedule(bookingId, dto, req) {
        return this.rescheduleService.requestReschedule(bookingId, req.user.id, dto);
    }
    acceptReschedule(bookingId, dto, req) {
        return this.rescheduleService.acceptReschedule(bookingId, req.user.id, dto);
    }
    rejectReschedule(bookingId, dto, req) {
        return this.rescheduleService.rejectReschedule(bookingId, req.user.id, dto);
    }
    counterPropose(bookingId, dto, req) {
        return this.rescheduleService.counterPropose(bookingId, req.user.id, dto);
    }
    overrideRescheduleLimit(bookingId, req) {
        return this.rescheduleService.overrideRescheduleLimit(bookingId, req.user.id);
    }
    cancelBooking(bookingId, dto, req) {
        return this.rescheduleService.cancelBooking(bookingId, req.user.id, dto);
    }
    getRescheduleHistory(bookingId, req) {
        return this.rescheduleService.getRescheduleHistory(bookingId, req.user.id);
    }
};
exports.RescheduleController = RescheduleController;
__decorate([
    (0, common_1.Post)('reschedule'),
    (0, role_guard_1.Roles)('CLIENT', 'VENDOR'),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, reschedule_dto_1.RequestRescheduleDto, Object]),
    __metadata("design:returntype", void 0)
], RescheduleController.prototype, "requestReschedule", null);
__decorate([
    (0, common_1.Post)('reschedule/accept'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, role_guard_1.Roles)('CLIENT', 'VENDOR'),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, reschedule_dto_1.RespondRescheduleDto, Object]),
    __metadata("design:returntype", void 0)
], RescheduleController.prototype, "acceptReschedule", null);
__decorate([
    (0, common_1.Post)('reschedule/reject'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, role_guard_1.Roles)('CLIENT', 'VENDOR'),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, reschedule_dto_1.RespondRescheduleDto, Object]),
    __metadata("design:returntype", void 0)
], RescheduleController.prototype, "rejectReschedule", null);
__decorate([
    (0, common_1.Post)('reschedule/counter'),
    (0, role_guard_1.Roles)('CLIENT', 'VENDOR'),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, reschedule_dto_1.CounterProposeRescheduleDto, Object]),
    __metadata("design:returntype", void 0)
], RescheduleController.prototype, "counterPropose", null);
__decorate([
    (0, common_1.Post)('reschedule/override'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, role_guard_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], RescheduleController.prototype, "overrideRescheduleLimit", null);
__decorate([
    (0, common_1.Post)('cancel'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, role_guard_1.Roles)('CLIENT', 'VENDOR'),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, reschedule_dto_1.CancelBookingDto, Object]),
    __metadata("design:returntype", void 0)
], RescheduleController.prototype, "cancelBooking", null);
__decorate([
    (0, common_1.Get)('reschedule-history'),
    (0, role_guard_1.Roles)('CLIENT', 'VENDOR', 'ADMIN'),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], RescheduleController.prototype, "getRescheduleHistory", null);
exports.RescheduleController = RescheduleController = __decorate([
    (0, common_1.Controller)('booking/:bookingId'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    __metadata("design:paramtypes", [reschedule_service_1.RescheduleService])
], RescheduleController);
