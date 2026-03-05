/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { PaystackService } from './paystack.service';
import { PaystackController } from './paystack.controller';

@Module({
  providers: [PrismaService, PaystackService],
  exports: [PaystackService],
  controllers: [PaystackController],
  imports: [
    // forwardRef(() => NotificationsModule)
  ],
})
export class PaystackModule {}
