/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Req,
  Res,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from 'prisma/prisma.service';
import { PaystackService } from './paystack.service';
import { TransactionService } from 'src/transaction/transaction.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { BookingService } from 'src/booking/booking.service';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Public } from 'src/auth/public.decorator';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { successResponse } from 'src/utils/response';
import { ActivityService } from 'src/activity/activityLog.service';
import { PlatformSettingsService } from 'src/platform-settings/platform-settings.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import type { User, Vendor } from '@prisma/client';
import { dateConverter, timeConverter } from 'src/utils/dateAndTimeConverter';

@Controller('paystack')
export class PaystackController {
  constructor(
    private readonly paystackService: PaystackService,
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionService,
    private readonly mailService: NodemailerService,
    private readonly bookingService: BookingService,
    private readonly activityService: ActivityService,
    private readonly platformSettingsService: PlatformSettingsService,
    private readonly subscriptionService: SubscriptionService,
  ) {}

  @Get('/resolve-bank/:accountNumber/:bankCode')
  @Public()
  resolveBankAccount(@Param() dto) {
    return this.paystackService.resolveBankAccount(
      dto.accountNumber,
      dto.bankCode,
    );
  }

  @Get('/verify-payment/:reference')
  @Public()
  verifyPayment(@Param('reference') reference: string) {
    return this.paystackService.verifyTransaction(reference);
  }

  @Get('/callback')
  @Public()
  @HttpCode(200)
  handleCallback(@Req() req: any, @Res() res: any) {
    const reference = req.query.reference;

    return res.redirect(
      `${process.env.FRONTEND_BASE_URL}/verify-payment?reference=${reference}`,
    );
  }

  @Post('/refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'VENDOR')
  async refundPayment(
    @Req() req: { user: { id: string; role: string } },
    @Body()
    dto: {
      providerRef?: string;
      bookingId?: string;
      amount?: number;
      customerNote?: string;
      merchantNote?: string;
    },
  ) {
    if (!dto.providerRef && !dto.bookingId) {
      throw new BadRequestException('providerRef or bookingId is required');
    }

    const transaction = await this.prisma.transaction.findFirst({
      where: {
        providerRef: dto.providerRef,
        bookingId: dto.bookingId,
      },
      include: {
        vendor: true,
      },
    });

    if (!transaction) {
      throw new BadRequestException('Transaction not found');
    }

    if (
      req.user.role === 'VENDOR' &&
      transaction.vendor.userId !== req.user.id
    ) {
      throw new ForbiddenException('Not allowed to refund this transaction');
    }

    if (transaction.status === 'COMPLETED') {
      throw new BadRequestException(
        'This payment has already been settled to the vendor',
      );
    }

    if (transaction.status === 'REFUNDED') {
      throw new BadRequestException('This payment has already been refunded');
    }

    if (transaction.status === 'REFUND_PENDING') {
      throw new BadRequestException('A refund is already pending');
    }

    if (['failed', 'CANCELLED'].includes(transaction.status)) {
      throw new BadRequestException('Only successful payments can be refunded');
    }

    const activeSettlement = await this.prisma.settlement.findFirst({
      where: {
        bookingId: transaction.bookingId || '',
        status: {
          in: ['PENDING', 'SUCCESS'],
        },
      },
    });

    if (activeSettlement) {
      throw new BadRequestException(
        'This payment has already been sent to vendor settlement',
      );
    }

    if (dto.amount !== undefined && dto.amount > transaction.amount) {
      throw new BadRequestException(
        'Refund amount cannot be more than transaction amount',
      );
    }

    if (dto.amount !== undefined && dto.amount <= 0) {
      throw new BadRequestException('Refund amount must be greater than zero');
    }

    const refund = await this.paystackService.createRefund({
      transaction: transaction.providerRef,
      amount: dto.amount,
      customerNote: dto.customerNote,
      merchantNote: dto.merchantNote,
    });

    await this.prisma.transaction.update({
      where: {
        id: transaction.id,
      },
      data: {
        status:
          refund.status?.toLowerCase?.() === 'processed'
            ? 'REFUNDED'
            : 'REFUND_PENDING',
      },
    });

    if (transaction.bookingId) {
      await this.prisma.booking.update({
        where: {
          id: transaction.bookingId,
        },
        data: {
          status: 'CANCELLED',
        },
      });
    }

    return successResponse(refund, 'Refund initiated successfully', 201);
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  async paystackWebhook(@Req() req: any, @Headers() headers) {
    try {
      const secret = process.env.PAYSTACK_SECRET_KEY as string;

      const rawBody = req.rawBody as Buffer | undefined;
      const paystackSignature = headers['x-paystack-signature'] as
        | string
        | undefined;

      if (!rawBody || !paystackSignature) {
        throw new HttpException(
          'Missing Paystack webhook signature or raw body',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const computedSignature = crypto
        .createHmac('sha512', secret)
        .update(rawBody)
        .digest('hex');

      const signaturesMatch =
        paystackSignature.length === computedSignature.length &&
        crypto.timingSafeEqual(
          Buffer.from(computedSignature, 'utf8'),
          Buffer.from(paystackSignature, 'utf8'),
        );

      if (!signaturesMatch) {
        throw new HttpException('Invalid signature', HttpStatus.UNAUTHORIZED);
      }

      const event = req.body;
      if (!event?.data?.reference) {
        throw new BadRequestException('Invalid Paystack webhook payload');
      }

      if (event.event !== 'charge.success') {
        return { status: true };
      }

      JSON.stringify(event.data.metadata);

      const paymentChannel =
        event.data.channel || event.data.authorization?.channel || 'unknown';

      const auth = event.data.authorization;

      const bank = auth?.bank || null;
      const accountName = auth?.account_name || null;
      const accountNumber = auth?.account_number || null;

      if (event.data.metadata?.type === 'SUBSCRIPTION_UPGRADE') {
        const { vendorId, plan, durationDays } = event.data.metadata;

        if (!vendorId) {
          throw new BadRequestException('Incomplete subscription metadata');
        }

        await this.subscriptionService.activateSubscription({
          vendorId,
          plan: plan || 'PREMIUM',
          durationDays: Number(durationDays) || 30,
          reference: event.data.reference,
          amount: event.data.amount / 100,
        });

        await this.activityService.createLog({
          vendorId,
          action: 'SUBSCRIPTION_ACTIVATED',
          description: `Subscription payment of ₦${(event.data.amount / 100).toLocaleString()} confirmed.`,
          actor: 'System',
          actorType: 'SYSTEM',
          color: 'green',
        });

        return { status: true };
      }

      const transactionExists = await this.prisma.transaction.findUnique({
        where: {
          providerRef: event.data.reference,
        },
      });

      if (!transactionExists) {
        throw new BadRequestException('Transaction was not initialized');
      }

      // Shared idempotency guard for both flows below: bookingId is only
      // ever set once a charge has actually been confirmed (by this webhook
      // or by the reconciliation cron), so a redelivered webhook is a no-op.
      if (transactionExists.bookingId) {
        return { status: true };
      }

      if (event.data.metadata?.type === 'VENDOR_CREATED_BOOKING_LINK') {
        const { bookingId, percentageFee, clientName, clientEmail, title } =
          event.data.metadata;

        if (!bookingId) {
          throw new BadRequestException('Incomplete booking metadata for link');
        }

        const booking = await this.prisma.booking.findUnique({
          where: { id: bookingId },
          include: {
            services: true,
          },
        });

        if (!booking) {
          throw new BadRequestException('Vendor-created booking was not found');
        }

        const updatedBooking = await this.prisma.booking.update({
          where: { id: bookingId },
          data: {
            status: 'CONFIRMED',
            paymentVerification: 'PAYSTACK_VERIFIED',
            paymentExpiresAt: null,
          },
        });

        const senderDetails = await this.prisma.senderDetails.create({
          data: {
            vendorId: booking.vendorId,
            email: clientEmail,
            senderName: accountName ?? clientName,
            senderAccountNumber: accountNumber,
            senderBankName: bank,
            senderDescription: 'Payment via Paystack (vendor-created link)',
          },
        });

        await this.prisma.transaction.update({
          where: { providerRef: event.data.reference },
          data: {
            bookingId: updatedBooking.id,
            status: 'PENDING',
            paidAt: new Date(),
            percentageFee: percentageFee ?? 0.05,
            paymentMethod: paymentChannel,
            senderDetailsId: senderDetails.id,
          },
        });

        await this.activityService.createLog({
          vendorId: booking.vendorId,
          action: 'PAYMENT_RECEIVED',
          description: `Payment of ₦${booking.amount?.toLocaleString() ?? ''} received for booking #${booking.id}.`,
          actor: 'System',
          actorType: 'SYSTEM',
          color: 'yellow',
        });

        let bookingVendor: Vendor | null = null;
        let vendorUser: User | null = null;
        try {
          bookingVendor = await this.prisma.vendor.findUnique({
            where: { id: booking.vendorId },
          });
          vendorUser = bookingVendor
            ? await this.prisma.user.findUnique({
                where: { id: bookingVendor.userId },
              })
            : null;
        } catch (err) {
          console.error('Failed to load vendor for receipt emails:', err);
        }

        setImmediate(() => {
          void (async () => {
            try {
              await this.mailService.sendClientBookingMail({
                clientEmail: booking.clientEmail,
                clientName: booking.clientName ?? clientName,
                serviceName: title,
                date: dateConverter(updatedBooking.startTime),
                time: timeConverter(updatedBooking.startTime),
                endTime: timeConverter(updatedBooking.endTime),
                durationMins: Number(booking.services.durationMins ?? 60),
                businessName: bookingVendor?.businessName || '',
                phone: vendorUser?.phone || '',
                address: `${bookingVendor?.city} ${bookingVendor?.state} ${bookingVendor?.country}`,
                transactionRef: event.data.reference,
              });
            } catch (err) {
              console.error('sendClientBookingMail failed:', err);
            }

            if (vendorUser?.email) {
              try {
                await this.mailService.sendVendorBookingMail({
                  vendorEmail: vendorUser.email,
                  clientName: booking.clientName ?? clientName,
                  clientEmail: booking.clientEmail,
                  serviceName: title,
                  date: dateConverter(updatedBooking.startTime),
                  time: timeConverter(updatedBooking.startTime),
                  endTime: timeConverter(updatedBooking.endTime),
                  phone: booking.clientPhone ?? '',
                  durationMins: Number(booking.services.durationMins ?? 60),
                  transactionRef: event.data.reference,
                });
              } catch (err) {
                console.error('sendVendorBookingMail failed:', err);
              }

              // try {
              //   await this.mailService.sendVendorReceiptMail({
              //     vendorEmail: vendorUser.email,
              //     bookingName: booking.name,
              //     clientName: booking.clientName ?? clientName,
              //     clientAddress: booking.clientAddress ?? undefined,
              //     clientPhone: booking.clientPhone ?? undefined,
              //     serviceName: title,
              //     date: updatedBooking.startTime.toDateString(),
              //     startTime: updatedBooking.startTime.toLocaleTimeString(),
              //     endTime: updatedBooking.endTime.toLocaleTimeString(),
              //     transactionRef: event.data.reference,
              //   });
              // } catch (err) {
              //   console.error('sendVendorReceiptMail failed:', err);
              // }
            }

            // try {
            //   await this.mailService.sendClientReceiptMail({
            //     clientEmail: booking.clientEmail,
            //     bookingName: booking.name,
            //     vendorName: bookingVendor?.businessName ?? '',
            //     vendorAddress: bookingVendor
            //       ? `${bookingVendor.city} ${bookingVendor.state} ${bookingVendor.country ?? ''}`.trim()
            //       : undefined,
            //     vendorPhone: vendorUser?.phone ?? undefined,
            //     serviceName: title,
            //     date: updatedBooking.startTime.toDateString(),
            //     startTime: updatedBooking.startTime.toLocaleTimeString(),
            //     endTime: updatedBooking.endTime.toLocaleTimeString(),
            //     transactionRef: event.data.reference,
            //   });
            // } catch (err) {
            //   console.error('sendClientReceiptMail failed:', err);
            // }
          })();
        });

        return { status: true };
      }

      {
        const {
          slug,
          vendorId,
          clientId,
          serviceId,
          title,
          email,
          userId,
          dayOfWeek,
          startTime,
          endTime,
          clientName,
          clientAddress,
          durationMins,
          businessName,
          vendorEmail,
          city,
          state,
          country,
          vendorUserId,
          phone,
        } = event.data.metadata;

        if (
          !vendorId ||
          !vendorUserId ||
          !serviceId ||
          !clientId ||
          !email ||
          !dayOfWeek ||
          !startTime ||
          !endTime
        ) {
          throw new BadRequestException(
            'Incomplete booking metadata in marketplace',
          );
        }

        const book = await this.bookingService.createBooking(vendorUserId, {
          userId: vendorUserId,
          clientId,
          serviceId,
          date: dayOfWeek,
          clientName,
          clientAddress,
          clientEmail: email,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          status: 'CONFIRMED',
        });

        await this.prisma.transaction.update({
          where: { providerRef: event.data.reference },
          data: { bookingId: book.id },
        });

        const senderDetails = await this.prisma.senderDetails.create({
          data: {
            vendorId: vendorId,
            email: email,
            senderName: accountName ?? clientName,
            senderAccountNumber: accountNumber,
            senderBankName: bank,
            senderDescription: 'Payment via Paystack',
          },
        });

        const percentageFee =
          await this.platformSettingsService.resolvePlatformPercentage(
            vendorId,
          );

        const dto = {
          amount: event.data.amount,
          senderDetailsId: senderDetails.id,
          status: 'PENDING',
          providerRef: event.data.reference,
          paidAt: event.data.paid_at,
          percentageFee,
          bookingId: book.id,
          vendorId,
          slug,
          title,
          paymentMethod: paymentChannel,
          description: 'Payment via Paystack',
        };

        await this.transactionsService.updateTransaction(userId, dto);

        let vendorUserRecord: User | null = null;
        try {
          vendorUserRecord = await this.prisma.user.findUnique({
            where: { id: vendorUserId },
          });
        } catch (err) {
          console.error('Failed to load vendor for receipt emails:', err);
        }

        setImmediate(() => {
          void (async () => {
            try {
              await this.mailService.sendClientBookingMail({
                clientEmail: email,
                serviceName: title,
                vendorName: businessName,
                date: dateConverter(startTime),
                time: timeConverter(startTime),
                endTime: timeConverter(endTime),
                clientName: clientName,
                durationMins: durationMins,
                phone: vendorUserRecord?.phone || '',
                businessName: businessName,
                address: `${city} ${state} ${country}`,
                transactionRef: event.data.reference,
              });
            } catch (err) {
              console.error('sendClientBookingMail failed:', err);
            }

            try {
              await this.mailService.sendVendorBookingMail({
                vendorEmail: vendorEmail,
                clientName: clientName,
                clientEmail: email,
                serviceName: title,
                date: dateConverter(startTime),
                time: timeConverter(startTime),
                endTime: timeConverter(endTime),
                durationMins: durationMins,
                phone,
                transactionRef: event.data.reference,
              });
            } catch (err) {
              console.error('sendVendorBookingMail failed:', err);
            }

            // try {
            //   await this.mailService.sendClientReceiptMail({
            //     clientEmail: email,
            //     bookingName: book.name,
            //     vendorName: businessName,
            //     vendorAddress: `${city} ${state} ${country ?? ''}`.trim(),
            //     vendorPhone: vendorUserRecord?.phone ?? undefined,
            //     serviceName: title,
            //     date: new Date(startTime),
            //     startTime: new Date(startTime),
            //     endTime: new Date(endTime),
            //     transactionRef: event.data.reference,
            //   });
            // } catch (err) {
            //   console.error('sendClientReceiptMail failed:', err);
            // }

            // if (vendorEmail) {
            //   try {
            //     await this.mailService.sendVendorReceiptMail({
            //       vendorEmail,
            //       bookingName: book.name,
            //       clientName,
            //       clientAddress,
            //       clientPhone: phone,
            //       serviceName: title,
            //       date: new Date(startTime).toDateString(),
            //       startTime: new Date(startTime).toDateString(),
            //       endTime: new Date(endTime).toDateString(),
            //       transactionRef: event.data.reference,
            //     });
            //   } catch (err) {
            //     console.error('sendVendorReceiptMail failed:', err);
            //   }
            // }
          })();
        });
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
  @Public()
  getBankList() {
    return this.paystackService.getBankList();
  }
}
