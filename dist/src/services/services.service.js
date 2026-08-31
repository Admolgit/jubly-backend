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
exports.ServicesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
let ServicesService = class ServicesService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getAllServices(userId, page, limit, search, isActive) {
        try {
            const currentPage = Math.max(1, Number(page));
            const pageSize = Math.max(1, Number(limit));
            const filters = {
                userId,
            };
            if (search?.trim()) {
                filters.name = {
                    contains: search.trim(),
                    mode: 'insensitive',
                };
            }
            if (isActive !== 'ALL') {
                filters.active = isActive === 'ACTIVE' ? true : false;
            }
            const [services, totalCount, all, active, inactive] = await Promise.all([
                this.prisma.service.findMany({
                    where: filters,
                    include: {
                        _count: {
                            select: {
                                booking: true,
                            },
                        },
                    },
                    skip: (currentPage - 1) * pageSize,
                    take: pageSize,
                }),
                this.prisma.service.count({
                    where: filters,
                }),
                this.prisma.service.count({
                    where: {
                        userId,
                    },
                }),
                this.prisma.service.count({
                    where: {
                        userId,
                        active: true,
                    },
                }),
                this.prisma.service.count({
                    where: {
                        userId,
                        active: false,
                    },
                }),
            ]);
            return (0, response_1.successResponse)(services, 'Services fetched successfully.', 200, {
                totalCount,
                page: currentPage,
                limit: pageSize,
                totalPages: Math.ceil(totalCount / pageSize),
                all,
                active,
                inactive,
            });
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch services', error instanceof Error ? error.message : 'Unknown error');
        }
    }
    async updateServiceActive(serviceId, userId, active) {
        try {
            const isActive = active === 'true';
            await this.prisma.service.update({
                where: {
                    id: serviceId,
                    userId,
                },
                data: {
                    active: isActive,
                },
            });
            return (0, response_1.successResponse)(null, 'Service status updated successfully.');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to update service status', error instanceof Error ? error.message : 'Unknown error');
        }
    }
    async getServiceById(userId, serviceId) {
        try {
            const service = await this.prisma.service.findFirst({
                where: {
                    id: serviceId,
                    userId,
                },
            });
            return (0, response_1.successResponse)(service, 'Service fetched successfully.');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch service', error instanceof Error ? error.message : 'Unknown error');
        }
    }
};
exports.ServicesService = ServicesService;
exports.ServicesService = ServicesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ServicesService);
