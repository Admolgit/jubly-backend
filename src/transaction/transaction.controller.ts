import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { TransactionService } from './transaction.service';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';

@Controller('transactions')
export class TransactionController {
  constructor(private transactionService: TransactionService) {}

  @Get('transactions-stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  async dashboardStats(@Req() req: { user: { id: string } }) {
    const userId = req.user.id;
    return this.transactionService.getDashboardStats(userId);
  }

  @Get(':vendorId')
  findAllVendorTransactions(
    @Param('vendorId') vendorId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.transactionService.findAllVendorTransactions(
      vendorId,
      page as number,
      limit as number,
      search as string,
    );
  }

  @Get(':vendorId/amount')
  getTotalTransactionsAmountByVendorId(
    @Param('vendorId') vendorId: string,
    @Query('view') view: 'day' | 'week' | 'month' | 'year',
  ) {
    return this.transactionService.getTotalTransactionsAmountByVendorId(
      vendorId,
      view,
    );
  }

  @Get('analytics/earnings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getAnalytics(
    @Req() req: { user: { id: string } },
    @Query('view') view: 'day' | 'week' | 'month' | 'year',
  ) {
    return this.transactionService.getEarningsAnalytics(req.user.id, view);
  }
}
