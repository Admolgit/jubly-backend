/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { PaystackService } from './paystack.service';
import { PaystackController } from './paystack.controller';
import { TransactionService } from 'src/transaction/transaction.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { BookingService } from 'src/booking/booking.service';
import { GoogleCalendarService } from 'src/google/google.service';
import { AuthService } from 'src/auth/auth.service';
import { ConfigService } from '@nestjs/config';

@Module({
  providers: [
    PrismaService,
    PaystackService,
    TransactionService,
    NodemailerService,
    BookingService,
    GoogleCalendarService,
    AuthService,
    ConfigService,
  ],
  exports: [PaystackService],
  controllers: [PaystackController],
  imports: [],
})
export class PaystackModule {}
