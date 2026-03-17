/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Req,
  Res,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from 'prisma/prisma.service';
import { PaystackService } from './paystack.service';
import { TransactionService } from 'src/transaction/transaction.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { BookingService } from 'src/booking/booking.service';

@Controller('paystack')
export class PaystackController {
  constructor(
    private paystackService: PaystackService,
    private prisma: PrismaService,
    private transactionsService: TransactionService,
    private mailService: NodemailerService,
    private bookingService: BookingService,
  ) {}

  @Get('/resolve-bank/:accountNumber/:bankCode')
  resolveBankAccount(@Param() dto) {
    return this.paystackService.resolveBankAccount(
      dto.accountNumber,
      dto.bankCode,
    );
  }

  @Get('/verify-payment/:reference')
  verifyPayment(@Param('reference') reference: string) {
    return this.paystackService.verifyTransaction(reference);
  }

  @Get('/callback')
  @HttpCode(200)
  handleCallback(@Req() req: any, @Res() res: any) {
    const reference = req.query.reference;

    return res.redirect(
      `${process.env.FRONTEND_BASE_URL}/verify-payment?reference=${reference}`,
    );
  }

  @Post('webhook')
  async paystackWebhook(@Req() req: any, @Headers() headers) {
    try {
      const secret = process.env.PAYSTACK_SECRET_KEY as string;

      const computedSignature = crypto
        .createHmac('sha512', secret)
        .update(req.rawBody)
        .digest('hex');

      const paystackSignature = headers['x-paystack-signature'];

      if (computedSignature !== paystackSignature) {
        throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
      }

      const event = req.body;
      console.log({ event });
      const paymentChannel =
        event.data.channel || event.data.authorization.channel || 'unknown';

      const auth = event.data.authorization;

      const bank = auth?.bank || null;
      const accountName = auth?.account_name || null;
      const accountNumber = auth?.account_number || null;

      const transactionExists = await this.prisma.transaction.findUnique({
        where: {
          providerRef: event.data.reference,
          status: 'COMPLETED',
        },
      });

      console.log({ transactionExists });

      if (transactionExists) {
        console.log(
          `Transaction with reference ${event.data.reference} already exists. Skipping processing.`,
        );
        return { status: true };
      }

      if (event.event === 'charge.success') {
        const {
          slug,
          vendorId,
          clientId,
          serviceId,
          title,
          email,
          userId,
          dayOfWeek,
          durationMins,
          startTime,
          endTime,
          clientName,
          businessName,
          vendorEmail,
          city,
          state,
          country,
          vendorUserId,
          phone,
        } = event.data.metadata;

        console.log('event.data.metadata', event.data.metadata);

        const book = await this.bookingService.createBooking(vendorUserId, {
          userId: vendorUserId,
          clientId,
          serviceId,
          date: dayOfWeek,
          clientName,
          clientEmail: email,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          status: 'CONFIRMED',
        });

        console.log({ book });

        const senderDetails = await this.prisma.senderDetails.create({
          data: {
            vendorId: vendorId,
            email: email,
            senderName: accountName ?? name,
            senderAccountNumber: accountNumber,
            senderBankName: bank,
            senderDescription: 'Payment via Paystack',
          },
        });

        console.log({ senderDetails });

        const dto = {
          amount: event.data.amount,
          senderDetailsId: senderDetails.id,
          status: 'success',
          providerRef: event.data.reference,
          paidAt: event.data.paid_at,
          percentageFee: 0.05,
          vendorId,
          slug,
          title,
          paymentMethod: paymentChannel,
          description: 'Payment via Paystack',
        };

        console.log({ dto });

        await this.mailService.sendClientBookingMail({
          clientEmail: email,
          serviceName: title,
          date: dayOfWeek,
          time: startTime,
          endTime: endTime,
          clientName: clientName,
          durationMins: durationMins,
          businessName: businessName,
          address: `${city} ${state} ${country}`,
        });

        await this.mailService.sendVendorBookingMail({
          vendorEmail: vendorEmail,
          clientName: clientName,
          clientEmail: vendorEmail,
          serviceName: title,
          date: dayOfWeek,
          time: startTime,
          endTime: endTime,
          durationMins: durationMins,
          phone,
        });

        await this.transactionsService.create(userId, dto);
      }

      if (event.event === 'charge.failed') {
        const { slug, vendorId, bookingId, title, name, userId } =
          event.data.metadata;

        const senderDetails = await this.prisma.senderDetails.create({
          data: {
            vendorId: vendorId,
            senderName: accountName,
            senderAccountNumber: accountNumber,
            senderBankName: bank,
            senderDescription: 'Payment via Paystack',
          },
        });

        const dto = {
          amount: event.data.amount,
          senderDetailsId: senderDetails.id,
          status: 'failed',
          name,
          providerRef: event.data.reference,
          paidAt: event.data.paid_at,
          percentageFee: 0.05,
          title,
          slug,
          bookingId,
          vendorId,
          paymentMethod: paymentChannel,
        };

        await this.transactionsService.create(userId, dto);
      }

      return { status: true };
    } catch (error) {
      console.error('❌ ERROR in Webhook:', error);
      throw new HttpException(
        'Webhook processing error',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('list')
  getBankList() {
    return this.paystackService.getBankList();
  }
}
