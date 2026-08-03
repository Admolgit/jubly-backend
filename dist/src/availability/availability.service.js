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
exports.AvailabilityService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
let AvailabilityService = class AvailabilityService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    generateSlots(start, end, duration) {
        const slots = [];
        let current = new Date(start);
        while (current.getTime() + duration * 60000 <= end.getTime()) {
            const slotEnd = new Date(current.getTime() + duration * 60000);
            slots.push({
                startTime: new Date(current),
                endTime: slotEnd,
            });
            current = slotEnd;
        }
        return slots;
    }
    async getAvailability(userId) {
        try {
            const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
            if (!vendor)
                throw new common_1.NotFoundException('Vendor not found');
            return this.prisma.vendorAvailability.findMany({
                where: { vendorId: vendor.id },
                orderBy: { dayOfWeek: 'asc' },
            });
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch vendor availability', error?.message);
        }
    }
    isSameDay(a, b) {
        return (a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate());
    }
    isPastDay(date) {
        const today = new Date();
        const d1 = new Date(date);
        d1.setHours(0, 0, 0, 0);
        const d2 = new Date(today);
        d2.setHours(0, 0, 0, 0);
        return d1 < d2;
    }
    async getAvailableSlots(vendorId, serviceId, date) {
        try {
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId: vendorId },
                include: {
                    vendorAvailability: true,
                    bookings: true,
                },
            });
            const services = await this.prisma.service.findMany({
                where: {
                    id: serviceId,
                },
            });
            const dateObj = new Date(date);
            const dayOfWeek = dateObj.getDay();
            if (!vendor)
                throw new common_1.NotFoundException('Vendor not found');
            const availability = vendor.vendorAvailability.find((a) => a.dayOfWeek === dayOfWeek);
            if (!availability)
                return [];
            const start = new Date(`${dateObj.toDateString()} ${availability.startTime}`);
            const end = new Date(`${dateObj.toDateString()} ${availability.endTime}`);
            let duration = services[0].durationMins || 60;
            const bufferTime = await this.prisma.vendorBookingSettings.findFirst({
                where: { vendorId: vendor.id },
            });
            const bufferMins = bufferTime?.bufferTime || 0;
            duration += bufferMins;
            const slots = this.generateSlots(start, end, duration);
            const bookings = vendor.bookings;
            const now = new Date();
            const isToday = this.isSameDay(dateObj, now);
            if (this.isPastDay(dateObj)) {
                throw new common_1.BadRequestException('No slots for past dates');
            }
            const availableSlots = slots.filter((slot) => {
                if (isToday && slot.startTime <= now) {
                    return false;
                }
                return !bookings.some((b) => slot.startTime < new Date(b.endTime) &&
                    slot.endTime > new Date(b.startTime));
            });
            if (availableSlots.length === 0) {
                throw new common_1.NotFoundException('No available slots for this date');
            }
            return (0, response_1.successResponse)({ availableSlots }, 'Available slot fetched successfully.');
        }
        catch (error) {
            console.error({ error });
            throw new common_1.InternalServerErrorException('Failed to fetch vendor availabile slot', error?.message);
        }
    }
    async getAvailabilityGrouped(userId) {
        try {
            const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
            if (!vendor)
                throw new common_1.NotFoundException('Vendor not found');
            const availabilities = await this.prisma.vendorAvailability.findMany({
                where: { vendorId: vendor.id },
                orderBy: { dayOfWeek: 'asc' },
            });
            const grouped = {};
            availabilities.forEach((a) => {
                if (!grouped[a.dayOfWeek])
                    grouped[a.dayOfWeek] = [];
                grouped[a.dayOfWeek].push({
                    startTime: a.startTime,
                    endTime: a.endTime,
                });
            });
            return (0, response_1.successResponse)({ grouped }, 'Availability fetched successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch vendor availability', error?.message);
        }
    }
    async setAvailability(userId, dto) {
        try {
            const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
            if (!vendor)
                throw new common_1.NotFoundException('Vendor not found');
            for (const item of dto.availabilities) {
                const [startH, startM] = item.startTime.split(':').map(Number);
                const [endH, endM] = item.endTime.split(':').map(Number);
                if (startH > endH || (startH === endH && startM >= endM)) {
                    throw new common_1.BadRequestException(`startTime (${item.startTime}) must be before endTime (${item.endTime}) for day ${item.dayOfWeek}`);
                }
            }
            const updatedAvailabilities = await this.prisma.$transaction(async (tx) => {
                const selectedDays = dto.availabilities.map((item) => item.dayOfWeek);
                await tx.vendorAvailability.deleteMany({
                    where: {
                        vendorId: vendor.id,
                        dayOfWeek: {
                            notIn: selectedDays,
                        },
                    },
                });
                await Promise.all(dto.availabilities.map((item) => tx.vendorAvailability.upsert({
                    where: {
                        vendorId_dayOfWeek: {
                            vendorId: vendor.id,
                            dayOfWeek: item.dayOfWeek,
                        },
                    },
                    update: {
                        startTime: item.startTime,
                        endTime: item.endTime,
                    },
                    create: {
                        vendorId: vendor.id,
                        dayOfWeek: item.dayOfWeek,
                        startTime: item.startTime,
                        endTime: item.endTime,
                    },
                })));
            });
            return (0, response_1.successResponse)({ updatedAvailabilities }, 'Availability updated successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to set vendor availability', error?.message);
        }
    }
    async deleteAvailability(userId, dayOfWeek) {
        try {
            const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
            if (!vendor)
                throw new common_1.NotFoundException('Vendor not found');
            const deleted = await this.prisma.vendorAvailability.deleteMany({
                where: { vendorId: vendor.id, dayOfWeek },
            });
            if (deleted.count === 0) {
                throw new common_1.NotFoundException('Availability for this day not found');
            }
            return (0, response_1.successResponse)({ deleted }, 'Availability deleted successfully');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to set vendor availability', error?.message);
        }
    }
    async updateBufferTime(userId, dto) {
        const vendor = await this.prisma.vendor.findUnique({
            where: { userId },
        });
        if (!vendor) {
            throw new common_1.NotFoundException('Vendor not found');
        }
        const updatedBuffer = await this.prisma.vendorBookingSettings.upsert({
            where: {
                vendorId: vendor.id,
            },
            update: {
                bufferTime: dto.bufferTime,
            },
            create: {
                vendorId: vendor.id,
                bufferTime: dto.bufferTime,
            },
        });
        return (0, response_1.successResponse)(updatedBuffer, 'Buffer time updated successfully.');
    }
    async getExistingBufferTime(userId) {
        try {
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('Vendor not found');
            }
            const existingBuffer = await this.prisma.vendorBookingSettings.findUnique({
                where: {
                    vendorId: vendor.id,
                },
                select: {
                    bufferTime: true,
                },
            });
            return (0, response_1.successResponse)(existingBuffer, 'Existing buffer time fetched successfully.');
        }
        catch (error) {
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch existing buffer time.', error.message);
        }
    }
};
exports.AvailabilityService = AvailabilityService;
exports.AvailabilityService = AvailabilityService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AvailabilityService);
