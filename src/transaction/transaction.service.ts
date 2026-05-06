/* eslint-disable no-case-declarations */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';
// import {
//   startOfWeek,
//   endOfWeek,
//   startOfMonth,
//   endOfMonth,
//   startOfYear,
//   endOfYear,
// } from 'date-fns';

export enum DateFilter {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

@Injectable()
export class TransactionService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: any) {
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
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to record this transactions',
        error.message as string,
      );
    }
  }

  async updateTransaction(userId: string, dto: any) {
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
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to record this transactions',
        error.message as string,
      );
    }
  }

  async findAllVendorTransactions(
    vendorId: string,
    page?: number,
    limit?: number,
    search?: string,
  ) {
    try {
      let where: any = {};
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

      return successResponse(
        { transactions },
        'Successfully fetched transactions.',
        200,
        {
          total,
          page,
          limit,
        },
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch this transactions',
        error.message as string,
      );
    }
  }

  async getTotalTransactionsAmountByVendorId(
    vendorId: string,
    view: 'day' | 'week' | 'month' | 'year',
  ) {
    try {
      let where: any = {};

      if (view === 'day') {
        const today = new Date();
        const startOfDay = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
        );
        const endOfDay = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate() + 1,
        );
        where.vendorId = vendorId;
        where.paidAt = {
          gte: startOfDay,
          lt: endOfDay,
        };
      } else if (view === 'week') {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const startOfWeek = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate() - dayOfWeek,
        );
        const endOfWeek = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate() + (7 - dayOfWeek),
        );
        where.vendorId = vendorId;
        where.paidAt = {
          gte: startOfWeek,
          lt: endOfWeek,
        };
      } else if (view === 'month') {
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(
          today.getFullYear(),
          today.getMonth() + 1,
          1,
        );
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

      return successResponse(
        { total: totalSum },
        'Successfully fetched transactions amount.',
      );
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to fetch this transactions',
        error.message as string,
      );
    }
  }

  async getEarningsAnalytics(
    userId: string,
    view: 'day' | 'week' | 'month' | 'year',
  ) {
    try {
      const vendor = await this.prisma.vendor.findFirst({
        where: { userId },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }

      const now = new Date();
      let startDate: Date;
      let endDate: Date;

      // =========================
      // 📅 DATE RANGE
      // =========================
      switch (view) {
        case 'day':
          startDate = new Date(now);
          startDate.setHours(0, 0, 0, 0);

          endDate = new Date(now);
          endDate.setHours(23, 59, 59, 999);
          break;

        case 'week':
          const day = now.getDay(); // 0 (Sun) - 6 (Sat)
          const diff = now.getDate() - day + (day === 0 ? -6 : 1); // start Monday
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

      // =========================
      // 📦 FETCH DATA
      // =========================
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

      let data: { label: string; amount: number }[] = [];

      switch (view) {
        case 'day':
          // Just total for the day
          const totalAmount = transactions.reduce(
            (sum, t) => sum + (t.amount / 100 || 0),
            0,
          );
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
            const jsDay = new Date(t.createdAt).getDay(); // 0–6
            const index = jsDay === 0 ? 6 : jsDay - 1; // Mon–Sun
            weekData[index].amount += t.amount / 100 || 0;
          });

          data = weekData;
          break;

        case 'month':
          const daysInMonth = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0,
          ).getDate();
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
            const m = new Date(t.createdAt).getMonth(); // 0–11
            yearData[m].amount += t.amount / 100 || 0;
          });

          data = yearData;
          break;
      }

      const total = transactions.reduce(
        (sum, t) => sum + (t.amount / 100 || 0),
        0,
      );

      return successResponse({ total, data }, 'Analytics fetched successfully');
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to fetch analytics',
        error.message,
      );
    }
  }
}
