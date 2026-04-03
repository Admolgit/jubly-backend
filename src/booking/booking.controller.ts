/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { BookingService } from './booking.service';
import type { IBooking } from './dto/booking.dto';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { RolesGuard, Roles } from 'src/auth/role.guard';
import { UseGuards } from '@nestjs/common';

@Controller('booking')
export class BookingController {
  constructor(private bookingService: BookingService) {}

  @Post('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  createBooking(@Req() req: { user: { id: string } }, @Body() dto: IBooking) {
    const userId = req.user.id;
    return this.bookingService.createBooking(userId, dto);
  }

  @Post('initialize-payment')
  paymentInitialize(@Body() dto: any) {
    return this.bookingService.initializeBookingPayment(
      dto.bookingId as string,
      dto,
    );
  }

  @Get('dashboard-stats/:vendorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getDashboardStats(
    @Req() req: { user: { id: string } },
    @Param('vendorId') vendorId: string,
  ) {
    const userId = req.user.id;
    return this.bookingService.dashboardStats(userId, vendorId);
  }
}
