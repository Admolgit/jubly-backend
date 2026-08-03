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
exports.BookingController = void 0;
const common_1 = require("@nestjs/common");
const booking_service_1 = require("./booking.service");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const role_guard_1 = require("../auth/role.guard");
const public_decorator_1 = require("../auth/public.decorator");
let BookingController = class BookingController {
    constructor(bookingService) {
        this.bookingService = bookingService;
    }
    createBooking(req, dto) {
        const userId = req.user.id;
        return this.bookingService.createBooking(userId, dto);
    }
    paymentInitialize(dto) {
        return this.bookingService.initializeBookingPayment(dto.bookingId, dto);
    }
    getDashboardStats(req, vendorId) {
        const userId = req.user.id;
        return this.bookingService.dashboardStats(userId, vendorId);
    }
    async getTopUpcoming(req) {
        return this.bookingService.getNext24HoursBookings(req.user.id);
    }
    getUpcomingBookings(req) {
        return this.bookingService.getUpcomingBookings(req.user.id);
    }
    getClientUpcomingBookings(req) {
        return this.bookingService.getClientUpcomingBookings(req.user.id);
    }
    async getServicesByCount(req) {
        return this.bookingService.countBookingsByService(req.user.id);
    }
    getAdminBookingStats() {
        return this.bookingService.getAdminBookingStats();
    }
    getAdminBookings(page = '1', limit = '10', search, dateFilter, date, status, startDate, endDate) {
        return this.bookingService.getAdminBookings(page, limit, search, dateFilter, date, status, startDate, endDate);
    }
    async getBookings(req, page = '1', limit = '10', search, dateFilter, date, status) {
        return this.bookingService.getBookings(req.user.id, page, limit, search, dateFilter, date, status);
    }
    getClientsBookings(req, page = '1', limit = '10', search, dateFilter, date, status, email) {
        return this.bookingService.getClientsBookings(req.user.id, page, limit, search, dateFilter, date, status, email);
    }
    getStats(req) {
        const userId = req.user.id;
        return this.bookingService.getClientsStats(userId);
    }
    getBookingStats(req) {
        const userId = req.user.id;
        return this.bookingService.getClientBookingsStats(userId);
    }
    rescheduleBooking(req, dto, bookingId) {
        return this.bookingService.rescheduleBooking(bookingId, dto, req.user.id);
    }
    cancleBooking(bookingId, req) {
        return this.bookingService.cancelBooking(bookingId, req.user.id);
    }
    markAsComplete(bookingId, req) {
        return this.bookingService.markAsCmpleted(bookingId, req.user.id);
    }
    async getBookingsStatusFilter(req) {
        return this.bookingService.getBookingsStatusFilter(req.user.id);
    }
    getInsights(req) {
        return this.bookingService.getBusinessInsights(req.user.id);
    }
    getClientBookingStats(clientEmail, vendorId) {
        return this.bookingService.getClientBookingStats(clientEmail, vendorId);
    }
};
exports.BookingController = BookingController;
__decorate([
    (0, common_1.Post)(''),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "createBooking", null);
__decorate([
    (0, common_1.Post)('initialize-payment'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "paymentInitialize", null);
__decorate([
    (0, common_1.Get)('dashboard-stats/:vendorId'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('vendorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "getDashboardStats", null);
__decorate([
    (0, common_1.Get)('upcoming'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookingController.prototype, "getTopUpcoming", null);
__decorate([
    (0, common_1.Get)('upcoming-bookings'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "getUpcomingBookings", null);
__decorate([
    (0, common_1.Get)('client/upcoming-bookings'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('CLIENT'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "getClientUpcomingBookings", null);
__decorate([
    (0, common_1.Get)('services-count'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookingController.prototype, "getServicesByCount", null);
__decorate([
    (0, common_1.Get)('admin/stats'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "getAdminBookingStats", null);
__decorate([
    (0, common_1.Get)('admin'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Query)('search')),
    __param(3, (0, common_1.Query)('dateFilter')),
    __param(4, (0, common_1.Query)('date')),
    __param(5, (0, common_1.Query)('status')),
    __param(6, (0, common_1.Query)('startDate')),
    __param(7, (0, common_1.Query)('endDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "getAdminBookings", null);
__decorate([
    (0, common_1.Get)(''),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __param(3, (0, common_1.Query)('search')),
    __param(4, (0, common_1.Query)('dateFilter')),
    __param(5, (0, common_1.Query)('date')),
    __param(6, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, String, String, String, String]),
    __metadata("design:returntype", Promise)
], BookingController.prototype, "getBookings", null);
__decorate([
    (0, common_1.Get)('clients'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('CLIENT'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('page')),
    __param(2, (0, common_1.Query)('limit')),
    __param(3, (0, common_1.Query)('search')),
    __param(4, (0, common_1.Query)('dateFilter')),
    __param(5, (0, common_1.Query)('date')),
    __param(6, (0, common_1.Query)('status')),
    __param(7, (0, common_1.Query)('email')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "getClientsBookings", null);
__decorate([
    (0, common_1.Get)('clients/stats'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)('clients/booking-stats'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('CLIENT', 'VENDOR'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "getBookingStats", null);
__decorate([
    (0, common_1.Patch)('reschedule/:bookingId'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR', 'CLIENT'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Param)('bookingId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "rescheduleBooking", null);
__decorate([
    (0, common_1.Patch)(':bookingId/cancel'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR', 'CLIENT'),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "cancleBooking", null);
__decorate([
    (0, common_1.Patch)(':bookingId/mark-as-completed'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR', 'CLIENT'),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "markAsComplete", null);
__decorate([
    (0, common_1.Get)('status/filter'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR', 'CLIENT'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BookingController.prototype, "getBookingsStatusFilter", null);
__decorate([
    (0, common_1.Get)('insights'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR', 'CLIENT'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "getInsights", null);
__decorate([
    (0, common_1.Get)('client/:vendorId/:clientEmail/booking-stats'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR', 'CLIENT'),
    __param(0, (0, common_1.Param)('clientEmail')),
    __param(1, (0, common_1.Param)('vendorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], BookingController.prototype, "getClientBookingStats", null);
exports.BookingController = BookingController = __decorate([
    (0, common_1.Controller)('booking'),
    __metadata("design:paramtypes", [booking_service_1.BookingService])
], BookingController);
