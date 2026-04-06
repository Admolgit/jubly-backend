import { Controller, Get, Param, Query } from '@nestjs/common';
import { TransactionService } from './transaction.service';

@Controller('transactions')
export class TransactionController {
  constructor(private transactionService: TransactionService) {}

  @Get(':vendorId')
  findAllVendorTransactions(
    @Param('vendorId') vendorId: string,
    @Query('page') page: number,
    @Query('limit') limit: number,
    @Query('search') search: string,
  ) {
    return this.transactionService.findAllVendorTransactions(
      vendorId,
      page,
      limit,
      search,
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
}
