/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  findAllVendorTransactions(
    @Req() req: { user: { id: string } },
    @Param('vendorId') vendorId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.transactionService.findAllVendorTransactions(
      req.user.id,
      vendorId,
      page as number,
      limit as number,
      search as string,
    );
  }

  @Get(':vendorId/amount')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getTotalTransactionsAmountByVendorId(
    @Req() req: { user: { id: string } },
    @Param('vendorId') vendorId: string,
    @Query('view') view: 'day' | 'week' | 'month' | 'year',
  ) {
    return this.transactionService.getTotalTransactionsAmountByVendorId(
      req.user.id,
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

  @Get('export/csv')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  async exportTransactionsCSV(
    @Req() req: { user: { id: string } },
    @Res() res: any,
  ) {
    const csv = await this.transactionService.exportTransactionsToCSV(
      req.user.id,
    );

    res.setHeader('Content-Type', 'text/csv');

    res.setHeader(
      'Content-Disposition',
      `attachment; filename=transactions-${Date.now()}.csv`,
    );

    return res.status(200).send(csv);
  }
}
