import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { SubscriptionService } from './subscription.service';

@Module({
  providers: [PrismaService, SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
