/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable no-case-declarations */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Parser } from 'json2csv';
import dayjs from 'dayjs';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';
import { ActivityService } from 'src/activity/activityLog.service';
import { AdminTransactionsQueryDto } from './dto/admin-transaction-query.dto';

export enum DateFilter {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

@Injectable()
export class TransactionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityService: ActivityService,
  ) {}

  private async assertVendorOwnership(userId: string, vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { userId },
    });

    if (!vendor || vendor.id !== vendorId) {
      throw new ForbiddenException('Not allowed to view these transactions');
    }
  }

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
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to record this transactions',
        error.message as string,
      );
    }
  }

  async updateTransaction(userId: string, dto: any) {
    try {
      if (!dto.vendorId) {
        throw new BadRequestException('Vendor ID is required');
      }
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

      await this.activityService.createLog({
        vendorId: dto.vendorId,
        userId: userId ?? dto.userId,
        action: 'PAYMENT_RECEIVED',
        description: `Payment of ₦${convertedAmount.toLocaleString()} received.`,
        actor: 'System',
        actorType: 'SYSTEM',
        color: 'yellow',
      });
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to record this transactions',
        error.message as string,
      );
    }
  }

  async findAllVendorTransactions(
    userId: string,
    vendorId: string,
    page?: number,
    limit?: number,
    search?: string,
    status?: string,
    paymentMethod?: string,
    startDate?: string,
    endDate?: string,
  ) {
    try {
      await this.assertVendorOwnership(userId, vendorId);

      let where: any = {};
      if (vendorId) {
        where.vendorId = vendorId;
      }

      if (status) {
        where.status = status;
      }

      if (paymentMethod) {
        where.paymentMethod = paymentMethod;
      }

      if (startDate || endDate) {
        where.paidAt = {
          ...(startDate ? { gte: new Date(startDate) } : {}),
          ...(endDate ? { lte: new Date(endDate) } : {}),
        };
      }

      if (search) {
        where.OR = [
          {
            senderDetails: {
              senderName: { contains: search, mode: 'insensitive' },
            },
          },
          { providerRef: { contains: search, mode: 'insensitive' } },
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
              clientName: true,
              status: true,
              startTime: true,
              services: {
                select: {
                  name: true,
                  active: true,
                  createdAt: true,
                  description: true,
                  durationMins: true,
                },
              },
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
    } catch (error: any) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch this transactions',
        error.message as string,
      );
    }
  }

  async getTotalTransactionsAmountByVendorId(
    userId: string,
    vendorId: string,
    view: 'day' | 'week' | 'month' | 'year',
  ) {
    try {
      await this.assertVendorOwnership(userId, vendorId);

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
      } else if (view === 'year') {
        const today = new Date();
        const startOfYear = new Date(today.getFullYear(), 0, 1);
        const endOfYear = new Date(today.getFullYear() + 1, 0, 1);
        where.vendorId = vendorId;
        where.paidAt = {
          gte: startOfYear,
          lt: endOfYear,
        };
      }

      const total = await this.prisma.transaction.aggregate({
        where: {
          ...where,
          status: { in: ['COMPLETED', 'PENDING'] },
          vendorId,
        },
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
      if (error instanceof ForbiddenException) {
        throw error;
      }

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
          status: { in: ['COMPLETED', 'PENDING'] },
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
          const totalAmount = transactions.reduce(
            (sum, t) => sum + (t.amount || 0),
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
            const jsDay = new Date(t.createdAt).getDay();
            const index = jsDay === 0 ? 6 : jsDay - 1;
            weekData[index].amount += t.amount || 0;
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
            monthData[d - 1].amount += t.amount || 0;
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
            yearData[m].amount += t.amount || 0;
          });

          data = yearData;
          break;
      }

      const total = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);

      return successResponse({ total, data }, 'Analytics fetched successfully');
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch analytics',
        error.message,
      );
    }
  }

  async getDashboardStats(userId: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
    );

    const previousMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth(),
      0,
      23,
      59,
      59,
    );

    const currentTransactions = await this.prisma.transaction.findMany({
      where: {
        vendorId: vendor.id,
        status: {
          in: ['COMPLETED', 'PENDING'],
        },
        createdAt: {
          gte: currentMonthStart,
        },
      },
    });

    const previousTransactions = await this.prisma.transaction.findMany({
      where: {
        vendorId: vendor.id,
        status: {
          in: ['COMPLETED', 'PENDING'],
        },
        createdAt: {
          gte: previousMonthStart,
          lte: previousMonthEnd,
        },
      },
    });

    const calculateAmount = (transactions: any[]) => {
      return transactions.reduce(
        (acc: number, item: { amount: number }) => acc + item.amount,
        0,
      ) as number;
    };

    const calculateGrowth = (current: number, previous: number) => {
      if (previous === 0 && current > 0) return 100;
      if (previous === 0) return 0;

      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    const totalPayouts = calculateAmount(currentTransactions);

    const previousTotalPayouts = calculateAmount(previousTransactions);

    const completedTransactions = currentTransactions.filter(
      (item) => item.status === 'COMPLETED',
    );

    const previousCompletedTransactions = previousTransactions.filter(
      (item) => item.status === 'COMPLETED',
    );

    const completed = calculateAmount(completedTransactions);

    const previousCompleted = calculateAmount(previousCompletedTransactions);

    const processingTransactions = currentTransactions.filter(
      (item) => item.status === 'PENDING',
    );

    const previousProcessingTransactions = previousTransactions.filter(
      (item) => item.status === 'PENDING',
    );

    const processing = calculateAmount(processingTransactions);

    const previousProcessing = calculateAmount(previousProcessingTransactions);

    const failedTransactions = currentTransactions.filter(
      (item) => item.status === 'failed',
    );

    const previousFailedTransactions = previousTransactions.filter(
      (item) => item.status === 'failed',
    );

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

  async exportTransactionsToCSV(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({
        where: {
          userId,
        },
      });

      if (!vendor) {
        throw new BadRequestException('Vendor profile not found.');
      }

      const subAccount = await this.prisma.subAccount.findFirst({
        where: {
          userId,
        },
        select: {
          percentageFee: true,
        },
      });

      if (!subAccount) {
        throw new BadRequestException('Subaccount not found.');
      }

      const transactions = await this.prisma.transaction.findMany({
        where: {
          vendorId: vendor.id,
        },
        include: {
          senderDetails: true,
          booking: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      const fields = [
        {
          label: 'Transaction ID',
          value: 'transactionId',
        },
        {
          label: 'Sender Name',
          value: 'senderName',
        },
        {
          label: 'Description',
          value: 'description',
        },
        {
          label: 'Amount',
          value: 'amount',
        },
        {
          label: 'Currency',
          value: 'currency',
        },
        {
          label: 'Fee (%)',
          value: 'fee',
        },
        {
          label: 'Net Amount',
          value: 'netAmount',
        },
        {
          label: 'Status',
          value: 'status',
        },
        {
          label: 'Provider Ref',
          value: 'providerRef',
        },
        {
          label: 'Paid At',
          value: 'paidAt',
        },
        {
          label: 'Created At',
          value: 'createdAt',
        },
      ];

      const formattedTransactions = transactions.map((transaction) => {
        const feeAmount = transaction.amount * subAccount?.percentageFee;

        const netAmount = transaction.amount - feeAmount;

        return {
          transactionId: transaction.id,

          senderName: transaction.senderDetails?.senderName || 'N/A',

          description: transaction.senderDetails?.senderDescription || 'N/A',

          amount: `₦${transaction.amount.toLocaleString()}`,

          currency: transaction.currency,

          netAmount: `₦${netAmount.toLocaleString()}`,

          status: transaction.status,

          providerRef: transaction.providerRef,

          paidAt: dayjs(transaction.paidAt).format('DD/MM/YYYY hh:mm A'),

          createdAt: dayjs(transaction.createdAt).format('DD/MM/YYYY hh:mm A'),
        };
      });

      const parser = new Parser({
        fields,
      });

      return parser.parse(formattedTransactions);
    } catch (error: any) {
      console.log(error);
      throw new InternalServerErrorException(
        'Failed to export transactions to csv',
      );
    }
  }

  private buildAdminTransactionsWhere(query: AdminTransactionsQueryDto) {
    const { search, status, vendorId, startDate, endDate } = query;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (vendorId) {
      where.vendorId = vendorId;
    }

    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      };
    }

    if (search) {
      where.OR = [
        { providerRef: { contains: search, mode: 'insensitive' } },
        {
          senderDetails: {
            is: { senderName: { contains: search, mode: 'insensitive' } },
          },
        },
        {
          vendor: {
            is: { businessName: { contains: search, mode: 'insensitive' } },
          },
        },
        {
          booking: {
            is: { clientName: { contains: search, mode: 'insensitive' } },
          },
        },
        {
          booking: {
            is: { clientEmail: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    return where;
  }

  async getAdminTransactions(query: AdminTransactionsQueryDto) {
    try {
      const page = query.page ?? 1;
      const limit = query.limit ?? 10;
      const where = this.buildAdminTransactionsWhere(query);

      const transactions = await this.prisma.transaction.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          vendor: { select: { businessName: true, category: true } },
          senderDetails: true,
          booking: {
            select: { clientName: true, clientEmail: true, status: true },
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
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch admin transactions',
        error.message as string,
      );
    }
  }

  async getAdminTransactionStats() {
    try {
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const previousMonthStart = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        1,
      );
      const previousMonthEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        0,
        23,
        59,
        59,
      );

      const currentTransactions = await this.prisma.transaction.findMany({
        where: { createdAt: { gte: currentMonthStart } },
      });

      const previousTransactions = await this.prisma.transaction.findMany({
        where: {
          createdAt: { gte: previousMonthStart, lte: previousMonthEnd },
        },
      });

      const calculateAmount = (transactions: any[]) =>
        transactions.reduce(
          (acc: number, item: { amount: number }) => acc + item.amount,
          0,
        ) as number;

      const calculateGrowth = (current: number, previous: number) => {
        if (previous === 0 && current > 0) return 100;
        if (previous === 0) return 0;
        return Number((((current - previous) / previous) * 100).toFixed(1));
      };

      const isSuccessfulOrPending = (item: { status: string }) =>
        ['COMPLETED', 'PENDING'].includes(item.status);
      const isCompleted = (item: { status: string }) =>
        item.status === 'COMPLETED';
      const isPending = (item: { status: string }) => item.status === 'PENDING';
      const isFailed = (item: { status: string }) =>
        item.status?.toUpperCase() === 'FAILED';

      const buildBucket = (
        predicate: (item: { status: string }) => boolean,
      ) => {
        const current = currentTransactions.filter(predicate);
        const previous = previousTransactions.filter(predicate);
        const amount = calculateAmount(current);
        const previousAmount = calculateAmount(previous);

        return {
          amount,
          count: current.length,
          growth: calculateGrowth(amount, previousAmount),
        };
      };

      return successResponse(
        {
          total: buildBucket(isSuccessfulOrPending),
          completed: buildBucket(isCompleted),
          pending: buildBucket(isPending),
          failed: buildBucket(isFailed),
        },
        'Successfully fetched transaction stats',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch transaction stats',
        error.message as string,
      );
    }
  }

  async getAdminTransactionAnalytics(view: 'day' | 'week' | 'month' | 'year') {
    try {
      const now = new Date();
      let startDate: Date;
      let endDate: Date;

      switch (view) {
        case 'day':
          startDate = new Date(now);
          startDate.setHours(0, 0, 0, 0);

          endDate = new Date(now);
          endDate.setHours(23, 59, 59, 999);
          break;

        case 'week': {
          const day = now.getDay();
          const diff = now.getDate() - day + (day === 0 ? -6 : 1);
          startDate = new Date(now);
          startDate.setDate(diff);
          startDate.setHours(0, 0, 0, 0);

          endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 6);
          endDate.setHours(23, 59, 59, 999);
          break;
        }

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
          status: { in: ['COMPLETED', 'PENDING'] },
          createdAt: { gte: startDate, lte: endDate },
        },
        select: { amount: true, createdAt: true },
      });

      let data: { label: string; amount: number }[] = [];

      switch (view) {
        case 'day': {
          const totalAmount = transactions.reduce(
            (sum, t) => sum + (t.amount || 0),
            0,
          );
          data = [{ label: startDate.toDateString(), amount: totalAmount }];
          break;
        }

        case 'week': {
          const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
          const weekData = days.map((d) => ({ label: d, amount: 0 }));

          transactions.forEach((t) => {
            const jsDay = new Date(t.createdAt).getDay();
            const index = jsDay === 0 ? 6 : jsDay - 1;
            weekData[index].amount += t.amount || 0;
          });

          data = weekData;
          break;
        }

        case 'month': {
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
            monthData[d - 1].amount += t.amount || 0;
          });

          data = monthData;
          break;
        }

        case 'year': {
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
            yearData[m].amount += t.amount || 0;
          });

          data = yearData;
          break;
        }
      }

      const total = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);

      return successResponse({ total, data }, 'Analytics fetched successfully');
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch analytics',
        error.message as string,
      );
    }
  }

  async exportAdminTransactionsToCSV(query: AdminTransactionsQueryDto) {
    try {
      const where = this.buildAdminTransactionsWhere(query);

      const transactions = await this.prisma.transaction.findMany({
        where,
        include: {
          senderDetails: true,
          vendor: { select: { businessName: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const fields = [
        { label: 'Transaction ID', value: 'transactionId' },
        { label: 'Vendor', value: 'vendorName' },
        { label: 'Sender Name', value: 'senderName' },
        { label: 'Description', value: 'description' },
        { label: 'Amount', value: 'amount' },
        { label: 'Currency', value: 'currency' },
        { label: 'Fee (%)', value: 'fee' },
        { label: 'Net Amount', value: 'netAmount' },
        { label: 'Status', value: 'status' },
        { label: 'Provider Ref', value: 'providerRef' },
        { label: 'Paid At', value: 'paidAt' },
        { label: 'Created At', value: 'createdAt' },
      ];

      const formattedTransactions = transactions.map((transaction) => {
        const percentageFee = transaction.percentageFee ?? 0;
        const feeAmount = transaction.amount * percentageFee;
        const netAmount = transaction.amount - feeAmount;

        return {
          transactionId: transaction.id,
          vendorName: transaction.vendor?.businessName || 'N/A',
          senderName: transaction.senderDetails?.senderName || 'N/A',
          description: transaction.senderDetails?.senderDescription || 'N/A',
          amount: `₦${transaction.amount.toLocaleString()}`,
          currency: transaction.currency,
          fee: `${(percentageFee * 100).toFixed(2)}%`,
          netAmount: `₦${netAmount.toLocaleString()}`,
          status: transaction.status,
          providerRef: transaction.providerRef,
          paidAt: dayjs(transaction.paidAt).format('DD/MM/YYYY hh:mm A'),
          createdAt: dayjs(transaction.createdAt).format('DD/MM/YYYY hh:mm A'),
        };
      });

      const parser = new Parser({ fields });

      return parser.parse(formattedTransactions);
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to export admin transactions to csv',
        error.message as string,
      );
    }
  }

  async getPlatformRevenue() {
    try {
      const transactions = await this.prisma.transaction.findMany({
        where: { status: 'COMPLETED' },
        select: { amount: true, percentageFee: true },
      });

      const platformRevenue = transactions.reduce(
        (acc, transaction) =>
          acc + transaction.amount * (transaction.percentageFee ?? 0),
        0,
      );

      return successResponse(
        { platformRevenue },
        'Successfully fetched platform revenue',
      );
    } catch (error: any) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch platform revenue',
        error.message as string,
      );
    }
  }
}
