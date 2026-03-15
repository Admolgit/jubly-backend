/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Body, Controller, Post, Req } from '@nestjs/common';
import { BookingService } from './booking.service';
import type { Request } from 'express';
import type { IBooking } from './dto/booking.dto';

@Controller('booking')
export class BookingController {
  constructor(private bookingService: BookingService) {}

  @Post('')
  createBooking(@Req() req: Request, @Body() dto: IBooking) {
    const userId = req.body.id as string;
    return this.bookingService.createBooking(userId, dto);
  }

  @Post('initialize-payment')
  paymentInitialize(@Body() dto: any) {
    return this.bookingService.initializeBookingPayment(
      dto.bookingId as string,
      dto,
    );
  }
}
