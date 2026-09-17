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
var BookingCompletionJob_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookingCompletionJob = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const cron_1 = require("cron");
const prisma_service_1 = require("../../prisma/prisma.service");
const booking_service_1 = require("./booking.service");
const COMPLETION_APPROVAL_WAIT_MS = 3 * 60 * 60 * 1000;
let BookingCompletionJob = BookingCompletionJob_1 = class BookingCompletionJob {
    constructor(prisma, bookingService) {
        this.prisma = prisma;
        this.bookingService = bookingService;
        this.logger = new common_1.Logger(BookingCompletionJob_1.name);
        this.running = false;
    }
    onModuleInit() {
        this.job = new cron_1.CronJob('* * * * *', () => void this.processUnansweredRequests(), null, true, 'Africa/Lagos');
    }
    onModuleDestroy() {
        void this.job?.stop();
    }
    async processUnansweredRequests() {
        if (this.running)
            return;
        this.running = true;
        try {
            const cutoff = new Date(Date.now() - COMPLETION_APPROVAL_WAIT_MS);
            let cursor;
            while (true) {
                const bookings = await this.prisma.booking.findMany({
                    where: {
                        status: client_1.BookingStatus.COMPLETION_PENDING_APPROVAL,
                        completionRequestedAt: { lte: cutoff },
                    },
                    select: { id: true },
                    orderBy: { id: 'asc' },
                    take: 25,
                    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                });
                if (!bookings.length)
                    break;
                for (const booking of bookings) {
                    try {
                        await this.bookingService.completeUnansweredRequest(booking.id, cutoff);
                    }
                    catch (error) {
                        this.logger.error(`Automatic completion failed for booking ${booking.id}`, error instanceof Error ? error.stack : String(error));
                    }
                }
                cursor = bookings[bookings.length - 1].id;
            }
        }
        catch (error) {
            this.logger.error('Failed to check unanswered completion requests', error instanceof Error ? error.stack : String(error));
        }
        finally {
            this.running = false;
        }
    }
};
exports.BookingCompletionJob = BookingCompletionJob;
exports.BookingCompletionJob = BookingCompletionJob = BookingCompletionJob_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        booking_service_1.BookingService])
], BookingCompletionJob);
