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
    async getAllServices(userId, page, limit, search) {
        try {
            const isActive = search === 'true' ? true : search === 'false' ? false : undefined;
            const services = await this.prisma.service.findMany({
                where: {
                    userId,
                    ...(isActive !== undefined && {
                        active: isActive,
                    }),
                },
                include: {
                    _count: {
                        select: {
                            booking: true,
                        },
                    },
                },
                skip: (page - 1) * limit,
                take: Number(limit),
            });
            const totalCount = await this.prisma.service.count({
                where: {
                    userId,
                    ...(isActive !== undefined && {
                        active: isActive,
                    }),
                },
            });
            return (0, response_1.successResponse)(services, 'Services fetched successfully.', 200, {
                totalCount,
                page,
                limit,
            });
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch services', error instanceof Error ? error.message : 'Unknown error');
        }
    }
    async updateServiceStatus(serviceId, userId, active) {
        try {
            const isActive = active === 'true';
            const service = await this.prisma.service.update({
                where: {
                    id: serviceId,
                    userId,
                },
                data: {
                    active: isActive,
                },
            });
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch services', error instanceof Error ? error.message : 'Unknown error');
        }
    }
};
exports.ServicesService = ServicesService;
exports.ServicesService = ServicesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ServicesService);
