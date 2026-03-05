/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Get,
  HttpCode,
  // HttpException,
  // HttpStatus,
  // Post,
  Req,
  Res,
  // Headers,
  Param,
} from '@nestjs/common';
// import * as crypto from 'crypto';
// import { PrismaService } from 'prisma/prisma.service';
import { PaystackService } from './paystack.service';

@Controller('paystack')
export class PaystackController {
  constructor(
    private paystackService: PaystackService,
    // private prisma: PrismaService,
    // private transactionsService: TransactionsService,
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

  // @Post('webhook')
  // async paystackWebhook(@Req() req: any, @Headers() headers) {
  //   try {
  //     const secret = process.env.PAYSTACK_SECRET_KEY as string;

  //     const computedSignature = crypto
  //       .createHmac('sha512', secret)
  //       .update(req.rawBody)
  //       .digest('hex');

  //     const paystackSignature = headers['x-paystack-signature'];

  //     if (computedSignature !== paystackSignature) {
  //       throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
  //     }

  //     const event = req.body;
  //     const paymentChannel =
  //       event.data.channel || event.data.authorization.channel || 'unknown';

  //     const auth = event.data.authorization;

  //     const bank = auth?.bank || null;
  //     const accountName = auth?.account_name || null;
  //     const accountNumber = auth?.account_number || null;

  //     const transactionExists = await this.prisma.transaction.findUnique({
  //       where: {
  //         providerRef: event.data.reference,
  //       },
  //     });

  //     if (transactionExists) {
  //       console.log(
  //         `Transaction with reference ${event.data.reference} already exists. Skipping processing.`,
  //       );
  //       return { status: true };
  //     }

  //     if (event.event === 'charge.success') {
  //       const {
  //         slug,
  //         vendorId,
  //         linkId,
  //         title,
  //         name,
  //         description,
  //         email,
  //         userAccountNumber,
  //       } = event.data.metadata;

  //       const senderDetails = await this.prisma.senderDetails.create({
  //         data: {
  //           vendorId: vendorId,
  //           email: email,
  //           senderName: accountName ?? name,
  //           senderAccountNumber: accountNumber,
  //           senderBankName: bank,
  //           senderDescription: description ?? 'Payment via Paystack',
  //         },
  //       });

  //       const dto = {
  //         amount: event.data.amount,
  //         senderDetailsId: senderDetails.id,
  //         status: 'success',
  //         providerRef: event.data.reference,
  //         paidAt: event.data.paid_at,
  //         percentageFee: 0.05,
  //         paymentLinkId: linkId,
  //         vendorId,
  //         slug,
  //         title,
  //         paymentMethod: paymentChannel,
  //         description: description,
  //       };

  //       await this.transactionsService.create(dto);

  //       const payload = {
  //         title: 'Payment Received',
  //         message: `${name} paid ₦${event.data.amount / 100} into your ${userAccountNumber} for ${title}. Money received`,
  //       };

  //       await this.notificationsService.createAndSend(vendorId, payload);

  //       // console.log({ testing });
  //       // console.log({ payload });

  //       // const paymentLinkStatusUpdate =
  //       await this.paymentLinkService.incrementUsedCount(slug);

  //       // if (
  //       //   paymentLinkStatusUpdate.maxUses !== null &&
  //       //   paymentLinkStatusUpdate.maxUses >= 1 &&
  //       //   paymentLinkStatusUpdate.usedCount >= paymentLinkStatusUpdate.maxUses
  //       // ) {
  //       //   await this.paymentLinkService.updatePaymentLinkStatus(
  //       //     'COMPLETED',
  //       //     paymentLinkStatusUpdate.id
  //       //   );
  //       // }
  //     }

  //     if (event.event === 'charge.failed') {
  //       const {
  //         slug,
  //         vendorId,
  //         linkId,
  //         title,
  //         name,
  //         // description,
  //         userAccountNumber,
  //       } = event.data.metadata;

  //       const senderDetails = await this.prisma.senderDetails.create({
  //         data: {
  //           vendorId: vendorId,
  //           senderName: accountName,
  //           senderAccountNumber: accountNumber,
  //           senderBankName: bank,
  //           senderDescription: 'Payment via Paystack',
  //         },
  //       });

  //       const dto = {
  //         amount: event.data.amount,
  //         senderDetailsId: senderDetails.id,
  //         status: 'failed',
  //         providerRef: event.data.reference,
  //         paidAt: event.data.paid_at,
  //         percentageFee: 0.05,
  //         title,
  //         slug,
  //         paymentLinkId: linkId,
  //         vendorId,
  //         paymentMethod: paymentChannel,
  //       };

  //       await this.transactionsService.create(dto);

  //       const payload = {
  //         title: 'Payment Failed',
  //         message: `${name} failed paid ₦${dto.amount} into your ${userAccountNumber} for ${dto.title}. Money not recived`,
  //       };

  //       await this.notificationsService.createAndSend(vendorId, payload);
  //     }

  //     return { status: true };
  //   } catch (error) {
  //     console.error('❌ ERROR in Webhook:', error);
  //     throw new HttpException(
  //       'Webhook processing error',
  //       HttpStatus.INTERNAL_SERVER_ERROR,
  //     );
  //   }
  // }

  @Get('list')
  getBankList() {
    return this.paystackService.getBankList();
  }
}
