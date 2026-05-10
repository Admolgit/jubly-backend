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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionService = exports.DateFilter = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
var DateFilter;
(function (DateFilter) {
    DateFilter["DAY"] = "day";
    DateFilter["WEEK"] = "week";
    DateFilter["MONTH"] = "month";
    DateFilter["YEAR"] = "year";
})(DateFilter || (exports.DateFilter = DateFilter = {}));
let TransactionService = class TransactionService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(userId, dto) {
        try {
            await this.prisma.transaction.create({
                data: {
                    vendorId: dto.vendorId,
                    title: dto.name,
                    bookingId: dto.bookingId,
                    amount: dto.amount,
                    senderDetailsId: dto.senderDetailsId,
                    currency: 'NGN',
                    paidAt: new Date(),
                    providerRef: dto.providerRef,
                },
            });
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to record this transactions', error.message);
        }
    }
    async updateTransaction(userId, dto) {
        try {
            const convertedAmount = dto.amount / 100;
            await this.prisma.transaction.update({
                where: {
                    providerRef: dto.providerRef,
                },
                data: {
                    vendorId: dto.vendorId,
                    title: dto.name,
                    bookingId: dto.bookingId,
                    amount: convertedAmount,
                    senderDetailsId: dto.senderDetailsId,
                    currency: 'NGN',
                    paidAt: new Date(),
                    status: dto.status,
                    percentageFee: dto.percentageFee,
                    providerRef: dto.providerRef,
                },
            });
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to record this transactions', error.message);
        }
    }
    async findAllVendorTransactions(vendorId, page, limit, search) {
        try {
            let where = {};
            if (vendorId) {
                where.vendorId = vendorId;
                where.status = {
                    in: ['CONFIRMED', 'COMPLETED'],
                };
            }
            if (search) {
                where.OR = [
                    { title: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ];
            }
            const transactions = await this.prisma.transaction.findMany({
                where,
                skip: page && limit ? (Number(page) - 1) * Number(limit) : undefined,
                take: limit ? Number(limit) : undefined,
                orderBy: { createdAt: 'desc' },
                include: {
                    senderDetails: {
                        select: {
                            id: true,
                            senderName: true,
                            senderDescription: true,
                        },
                    },
                    booking: {
                        select: {
                            id: true,
                            createdAt: true,
                            updatedAt: true,
                            clientEmail: true,
                            status: true,
                            startTime: true,
                        },
                    },
                },
            });
            const total = await this.prisma.transaction.count({ where });
            return (0, response_1.successResponse)({ transactions }, 'Successfully fetched transactions.', 200, {
                total,
                page,
                limit,
            });
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch this transactions', error.message);
        }
    }
    async getTotalTransactionsAmountByVendorId(vendorId, view) {
        try {
            let where = {};
            if (view === 'day') {
                const today = new Date();
                const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
                where.vendorId = vendorId;
                where.paidAt = {
                    gte: startOfDay,
                    lt: endOfDay,
                };
            }
            else if (view === 'week') {
                const today = new Date();
                const dayOfWeek = today.getDay();
                const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dayOfWeek);
                const endOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (7 - dayOfWeek));
                where.vendorId = vendorId;
                where.paidAt = {
                    gte: startOfWeek,
                    lt: endOfWeek,
                };
            }
            else if (view === 'month') {
                const today = new Date();
                const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
                const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
                where.vendorId = vendorId;
                where.paidAt = {
                    gte: startOfMonth,
                    lt: endOfMonth,
                };
            }
            const total = await this.prisma.transaction.aggregate({
                where,
                _sum: {
                    amount: true,
                },
            });
            const totalSum = total._sum.amount ?? 0 / 100;
            return (0, response_1.successResponse)({ total: totalSum }, 'Successfully fetched transactions amount.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch this transactions', error.message);
        }
    }
    async getEarningsAnalytics(userId, view) {
        try {
            const vendor = await this.prisma.vendor.findFirst({
                where: { userId },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('Vendor not found');
            }
            const now = new Date();
            let startDate;
            let endDate;
            switch (view) {
                case 'day':
                    startDate = new Date(now);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(now);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                case 'week':
                    const day = now.getDay();
                    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
                    startDate = new Date(now);
                    startDate.setDate(diff);
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + 6);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                    endDate.setHours(23, 59, 59, 999);
                    break;
                case 'year':
                    startDate = new Date(now.getFullYear(), 0, 1);
                    endDate = new Date(now.getFullYear(), 11, 31);
                    endDate.setHours(23, 59, 59, 999);
                    break;
            }
            const transactions = await this.prisma.transaction.findMany({
                where: {
                    vendorId: vendor.id,
                    status: { in: ['CONFIRMED', 'COMPLETED'] },
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
                select: {
                    amount: true,
                    createdAt: true,
                },
            });
            let data = [];
            switch (view) {
                case 'day':
                    const totalAmount = transactions.reduce((sum, t) => sum + (t.amount / 100 || 0), 0);
                    data = [
                        {
                            label: startDate.toDateString(),
                            amount: totalAmount,
                        },
                    ];
                    break;
                case 'week':
                    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                    const weekData = days.map((d) => ({ label: d, amount: 0 }));
                    transactions.forEach((t) => {
                        const jsDay = new Date(t.createdAt).getDay();
                        const index = jsDay === 0 ? 6 : jsDay - 1;
                        weekData[index].amount += t.amount / 100 || 0;
                    });
                    data = weekData;
                    break;
                case 'month':
                    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
                    const monthData = Array.from({ length: daysInMonth }, (_, i) => ({
                        label: (i + 1).toString(),
                        amount: 0,
                    }));
                    transactions.forEach((t) => {
                        const d = new Date(t.createdAt).getDate();
                        monthData[d - 1].amount += t.amount / 100 || 0;
                    });
                    data = monthData;
                    break;
                case 'year':
                    const months = [
                        'Jan',
                        'Feb',
                        'Mar',
                        'Apr',
                        'May',
                        'Jun',
                        'Jul',
                        'Aug',
                        'Sep',
                        'Oct',
                        'Nov',
                        'Dec',
                    ];
                    const yearData = months.map((m) => ({ label: m, amount: 0 }));
                    transactions.forEach((t) => {
                        const m = new Date(t.createdAt).getMonth();
                        yearData[m].amount += t.amount / 100 || 0;
                    });
                    data = yearData;
                    break;
            }
            const total = transactions.reduce((sum, t) => sum + (t.amount / 100 || 0), 0);
            return (0, response_1.successResponse)({ total, data }, 'Analytics fetched successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch analytics', error.message);
        }
    }
    async getDashboardStats(userId) {
        const vendor = await this.prisma.vendor.findFirst({
            where: { userId },
        });
        if (!vendor) {
            throw new common_1.NotFoundException('Vendor not found');
        }
        const now = new Date();
        const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        const currentTransactions = await this.prisma.transaction.findMany({
            where: {
                vendorId: vendor.id,
                status: 'CONFIRMED',
                createdAt: {
                    gte: currentMonthStart,
                },
            },
        });
        const previousTransactions = await this.prisma.transaction.findMany({
            where: {
                vendorId: vendor.id,
                status: 'CONFIRMED',
                createdAt: {
                    gte: previousMonthStart,
                    lte: previousMonthEnd,
                },
            },
        });
        const calculateAmount = (transactions) => {
            return transactions.reduce((acc, item) => acc + item.amount, 0);
        };
        const calculateGrowth = (current, previous) => {
            if (previous === 0 && current > 0)
                return 100;
            if (previous === 0)
                return 0;
            return Number((((current - previous) / previous) * 100).toFixed(1));
        };
        const totalPayouts = calculateAmount(currentTransactions);
        const previousTotalPayouts = calculateAmount(previousTransactions);
        const completedTransactions = currentTransactions.filter((item) => item.status === 'CONFIRMED');
        const previousCompletedTransactions = previousTransactions.filter((item) => item.status === 'CONFIRMED');
        const completed = calculateAmount(completedTransactions);
        const previousCompleted = calculateAmount(previousCompletedTransactions);
        const processingTransactions = currentTransactions.filter((item) => item.status === 'pending');
        const previousProcessingTransactions = previousTransactions.filter((item) => item.status === 'pending');
        const processing = calculateAmount(processingTransactions);
        const previousProcessing = calculateAmount(previousProcessingTransactions);
        const failedTransactions = currentTransactions.filter((item) => item.status === 'FAILED');
        const previousFailedTransactions = previousTransactions.filter((item) => item.status === 'FAILED');
        const failed = calculateAmount(failedTransactions);
        const previousFailed = calculateAmount(previousFailedTransactions);
        return {
            totalPayouts,
            completed,
            processing,
            failed,
            totalGrowth: calculateGrowth(totalPayouts, previousTotalPayouts),
            completedGrowth: calculateGrowth(completed, previousCompleted),
            processingGrowth: calculateGrowth(processing, previousProcessing),
            failedGrowth: calculateGrowth(failed, previousFailed),
        };
    }
};
exports.TransactionService = TransactionService;
exports.TransactionService = TransactionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TransactionService);
