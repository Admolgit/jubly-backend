/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

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
}
