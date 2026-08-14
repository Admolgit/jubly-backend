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
exports.TransactionController = void 0;
const common_1 = require("@nestjs/common");
const transaction_service_1 = require("./transaction.service");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const role_guard_1 = require("../auth/role.guard");
const admin_transaction_query_dto_1 = require("./dto/admin-transaction-query.dto");
let TransactionController = class TransactionController {
    constructor(transactionService) {
        this.transactionService = transactionService;
    }
    async dashboardStats(req) {
        const userId = req.user.id;
        return this.transactionService.getDashboardStats(userId);
    }
    getAdminTransactionStats() {
        return this.transactionService.getAdminTransactionStats();
    }
    getPlatformRevenue() {
        return this.transactionService.getPlatformRevenue();
    }
    getAdminTransactionAnalytics(view) {
        return this.transactionService.getAdminTransactionAnalytics(view);
    }
    async exportAdminTransactionsCSV(query, res) {
        const csv = await this.transactionService.exportAdminTransactionsToCSV(query);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=admin-transactions-${Date.now()}.csv`);
        return res.status(200).send(csv);
    }
    getAdminTransactions(query) {
        return this.transactionService.getAdminTransactions(query);
    }
    findAllVendorTransactions(req, vendorId, page, limit, search, status, paymentMethod, startDate, endDate) {
        return this.transactionService.findAllVendorTransactions(req.user.id, vendorId, page, limit, search, status, paymentMethod, startDate, endDate);
    }
    getTotalTransactionsAmountByVendorId(req, vendorId, view) {
        return this.transactionService.getTotalTransactionsAmountByVendorId(req.user.id, vendorId, view);
    }
    getAnalytics(req, view) {
        return this.transactionService.getEarningsAnalytics(req.user.id, view);
    }
    async exportTransactionsCSV(req, res) {
        const csv = await this.transactionService.exportTransactionsToCSV(req.user.id);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=transactions-${Date.now()}.csv`);
        return res.status(200).send(csv);
    }
};
exports.TransactionController = TransactionController;
__decorate([
    (0, common_1.Get)('transactions-stats'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TransactionController.prototype, "dashboardStats", null);
__decorate([
    (0, common_1.Get)('admin/stats'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TransactionController.prototype, "getAdminTransactionStats", null);
__decorate([
    (0, common_1.Get)('admin/platform-revenue'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TransactionController.prototype, "getPlatformRevenue", null);
__decorate([
    (0, common_1.Get)('admin/analytics'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Query)('view')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TransactionController.prototype, "getAdminTransactionAnalytics", null);
__decorate([
    (0, common_1.Get)('admin/export/csv'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [admin_transaction_query_dto_1.AdminTransactionsQueryDto, Object]),
    __metadata("design:returntype", Promise)
], TransactionController.prototype, "exportAdminTransactionsCSV", null);
__decorate([
    (0, common_1.Get)('admin'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [admin_transaction_query_dto_1.AdminTransactionsQueryDto]),
    __metadata("design:returntype", void 0)
], TransactionController.prototype, "getAdminTransactions", null);
__decorate([
    (0, common_1.Get)(':vendorId'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('vendorId')),
    __param(2, (0, common_1.Query)('page')),
    __param(3, (0, common_1.Query)('limit')),
    __param(4, (0, common_1.Query)('search')),
    __param(5, (0, common_1.Query)('status')),
    __param(6, (0, common_1.Query)('paymentMethod')),
    __param(7, (0, common_1.Query)('startDate')),
    __param(8, (0, common_1.Query)('endDate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Number, Number, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], TransactionController.prototype, "findAllVendorTransactions", null);
__decorate([
    (0, common_1.Get)(':vendorId/amount'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('vendorId')),
    __param(2, (0, common_1.Query)('view')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], TransactionController.prototype, "getTotalTransactionsAmountByVendorId", null);
__decorate([
    (0, common_1.Get)('analytics/earnings'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('view')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], TransactionController.prototype, "getAnalytics", null);
__decorate([
    (0, common_1.Get)('export/csv'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], TransactionController.prototype, "exportTransactionsCSV", null);
exports.TransactionController = TransactionController = __decorate([
    (0, common_1.Controller)('transactions'),
    __metadata("design:paramtypes", [transaction_service_1.TransactionService])
], TransactionController);
