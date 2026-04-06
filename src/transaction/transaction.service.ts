/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';

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

  async findAllVendorTransactions(
    vendorId: string,
    page: number,
    limit: number,
    search: string,
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
        skip: (page - 1) * limit,
        take: Number(limit),
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

      return successResponse(
        { total: total._sum.amount || 0 },
        'Successfully fetched transactions amount.',
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch this transactions',
        error.message as string,
      );
    }
  }
}
