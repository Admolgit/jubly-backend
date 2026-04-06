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
exports.TransactionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
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
            await this.prisma.transaction.update({
                where: {
                    providerRef: dto.providerRef,
                },
                data: {
                    vendorId: dto.vendorId,
                    title: dto.name,
                    bookingId: dto.bookingId,
                    amount: dto.amount,
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
            return (0, response_1.successResponse)({ total: total._sum.amount || 0 }, 'Successfully fetched transactions amount.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch this transactions', error.message);
        }
    }
};
exports.TransactionService = TransactionService;
exports.TransactionService = TransactionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TransactionService);
