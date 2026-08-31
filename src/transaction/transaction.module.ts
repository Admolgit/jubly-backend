import { Module } from '@nestjs/common';
import { TransactionController } from './transaction.controller';
import { TransactionService } from './transaction.service';
import { PrismaService } from 'prisma/prisma.service';
import { ActivityService } from 'src/activity/activityLog.service';

@Module({
  controllers: [TransactionController],
  providers: [TransactionService, PrismaService, ActivityService],
  exports: [TransactionService],
  imports: [],
})
export class TransactionModule {}
