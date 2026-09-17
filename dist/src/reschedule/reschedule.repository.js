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
exports.RescheduleRepository = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const booking_slot_util_1 = require("../booking/booking-slot.util");
const bookingWithRelations = client_1.Prisma.validator()({
    include: {
        services: true,
        vendor: { include: { user: true } },
    },
});
let RescheduleRepository = class RescheduleRepository {
    constructor(prisma) {
        this.prisma = prisma;
    }
    findBookingById(bookingId) {
        return this.prisma.booking.findUnique({
            where: { id: bookingId },
            ...bookingWithRelations,
        });
    }
    findActiveRescheduleRequest(bookingId) {
        return this.prisma.rescheduleRequest.findFirst({
            where: {
                bookingId,
                status: client_1.RescheduleStatus.PENDING,
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    createRescheduleRequest(data) {
        return this.prisma.rescheduleRequest.create({ data });
    }
    updateRescheduleRequest(id, data) {
        return this.prisma.rescheduleRequest.update({ where: { id }, data });
    }
    listRescheduleHistory(bookingId) {
        return this.prisma.rescheduleRequest.findMany({
            where: { bookingId },
            orderBy: { createdAt: 'desc' },
        });
    }
    updateBooking(bookingId, data) {
        return this.prisma.booking.update({ where: { id: bookingId }, data });
    }
    incrementVendorCancellationStrikes(vendorId) {
        return this.prisma.vendor.update({
            where: { id: vendorId },
            data: { cancellationStrikes: { increment: 1 } },
        });
    }
    acceptReschedule(booking, requestId, schedule, userId, reason) {
        return (0, booking_slot_util_1.withVendorScheduleLock)(this.prisma, booking.vendorId, async (tx) => {
            await (0, booking_slot_util_1.assertBookingSlotAvailable)(tx, {
                vendorId: booking.vendorId,
                start: schedule.start,
                end: schedule.end,
                excludeBookingId: booking.id,
            });
            const updated = await tx.booking.updateMany({
                where: {
                    id: booking.id,
                    updatedAt: booking.updatedAt,
                    status: client_1.BookingStatus.RESCHEDULE_REQUESTED,
                },
                data: {
                    startTime: schedule.start,
                    endTime: schedule.end,
                    date: schedule.date,
                    status: client_1.BookingStatus.CONFIRMED,
                    rescheduleCount: { increment: 1 },
                },
            });
            const accepted = await tx.rescheduleRequest.updateMany({
                where: {
                    id: requestId,
                    bookingId: booking.id,
                    status: client_1.RescheduleStatus.PENDING,
                },
                data: {
                    status: client_1.RescheduleStatus.ACCEPTED,
                    respondedBy: userId,
                    respondedAt: new Date(),
                    responseReason: reason,
                },
            });
            if (!updated.count || !accepted.count) {
                throw new common_1.ConflictException('Reschedule request changed; please try again');
            }
            return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
        });
    }
    findConflictingBooking(vendorId, excludeBookingId, start, end) {
        return this.prisma.booking.findFirst({
            where: {
                vendorId,
                id: { not: excludeBookingId },
                AND: [{ startTime: { lt: end } }, { endTime: { gt: start } }],
            },
        });
    }
};
exports.RescheduleRepository = RescheduleRepository;
exports.RescheduleRepository = RescheduleRepository = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], RescheduleRepository);
