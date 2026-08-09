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
exports.ActivityService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
let ActivityService = class ActivityService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createLog(data) {
        const activity = await this.prisma.activityLog.create({
            data: {
                userId: data.userId || undefined,
                vendorId: data.vendorId || undefined,
                action: data.action,
                description: data.description,
                actor: data.actor,
                actorType: data.actorType,
                metadata: data.metadata,
                color: data.color,
            },
        });
        return (0, response_1.successResponse)(activity, 'Activity log created successfully', 201);
    }
    async getLogsByUserId(userId, page, limit) {
        try {
            const where = { userId };
            const logs = await this.prisma.activityLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: page && limit ? (Number(page) - 1) * Number(limit) : undefined,
                take: limit ? Number(limit) : undefined,
            });
            const total = await this.prisma.activityLog.count({ where });
            return (0, response_1.successResponse)(logs, 'Activity logs retrieved successfully', 200, {
                total,
                page,
                limit,
            });
        }
        catch (err) {
            console.error('Error retrieving activity logs:', err);
            throw new common_1.InternalServerErrorException('Failed to retrieve activity logs', err);
        }
    }
};
exports.ActivityService = ActivityService;
exports.ActivityService = ActivityService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ActivityService);
