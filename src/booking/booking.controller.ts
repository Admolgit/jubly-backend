/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { BookingService, DateFilter } from './booking.service';
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

  @Get('upcoming')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  async getTopUpcoming(@Req() req) {
    return this.bookingService.getNext24HoursBookings(req.user.id as string);
  }

  @Get('upcoming-bookings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getUpcomingBookings(@Req() req: { user: { id: string } }) {
    return this.bookingService.getUpcomingBookings(req.user.id);
  }

  @Get('services-count')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  async getServicesByCount(@Req() req) {
    return this.bookingService.countBookingsByService(req.user.id as string);
  }

  @Get('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  async getBookings(
    @Req() req: { user: { id: string } },
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
    @Query('dateFilter') dateFilter?: DateFilter,
    @Query('date') date?: string,
    @Query('status') status?: string,
  ) {
    return this.bookingService.getBookings(
      req.user.id,
      page,
      limit,
      search as string,
      dateFilter as DateFilter,
      date as any,
      status as string,
    );
  }

  @Get('clients/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getStats(@Req() req: { user: { id: string } }) {
    const userId = req.user.id;
    return this.bookingService.getClientsStats(userId);
  }
}
