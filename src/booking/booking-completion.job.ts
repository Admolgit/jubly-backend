import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { CronJob } from 'cron';
import { PrismaService } from 'prisma/prisma.service';
import { BookingService } from './booking.service';

const COMPLETION_APPROVAL_WAIT_MS = 3 * 60 * 60 * 1000;

@Injectable()
export class BookingCompletionJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingCompletionJob.name);
  private job?: CronJob;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingService: BookingService,
  ) {}

  onModuleInit() {
    this.job = new CronJob(
      '* * * * *',
      () => void this.processUnansweredRequests(),
      null,
      true,
      'Africa/Lagos',
    );
  }

  onModuleDestroy() {
    void this.job?.stop();
  }

  private async processUnansweredRequests() {
    if (this.running) return;
    this.running = true;

    try {
      const cutoff = new Date(Date.now() - COMPLETION_APPROVAL_WAIT_MS);
      let cursor: string | undefined;

      while (true) {
        const bookings = await this.prisma.booking.findMany({
          where: {
            status: BookingStatus.COMPLETION_PENDING_APPROVAL,
            completionRequestedAt: { lte: cutoff },
          },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: 25,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        if (!bookings.length) break;

        for (const booking of bookings) {
          try {
            await this.bookingService.completeUnansweredRequest(
              booking.id,
              cutoff,
            );
          } catch (error) {
            this.logger.error(
              `Automatic completion failed for booking ${booking.id}`,
              error instanceof Error ? error.stack : String(error),
            );
          }
        }

        cursor = bookings[bookings.length - 1].id;
      }
    } catch (error) {
      this.logger.error(
        'Failed to check unanswered completion requests',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
