import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityService } from '../activity/activityLog.service';
import { TransactionService } from './transaction.service';
import { AdminTransactionsQueryDto } from './dto/admin-transaction-query.dto';

describe('TransactionService', () => {
  let service: TransactionService;
  let prisma: {
    transaction: { findMany: jest.Mock; count: jest.Mock };
    vendor: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      transaction: { findMany: jest.fn(), count: jest.fn() },
      vendor: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ActivityService, useValue: { createLog: jest.fn() } },
      ],
    }).compile();

    service = module.get(TransactionService);
  });

  describe('getAdminTransactions', () => {
    it('builds a case-insensitive OR search clause and status/vendorId filters', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(0);

      const query: AdminTransactionsQueryDto = {
        page: 2,
        limit: 5,
        search: 'jane',
        status: 'COMPLETED',
        vendorId: 'vendor-1',
      };

      await service.getAdminTransactions(query);

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'COMPLETED',
            vendorId: 'vendor-1',
            OR: expect.arrayContaining([
              { providerRef: { contains: 'jane', mode: 'insensitive' } },
            ]),
          }),
          skip: 5,
          take: 5,
        }),
      );
    });

    it('returns pagination meta derived from the total count', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);
      prisma.transaction.count.mockResolvedValue(23);

      const result = await service.getAdminTransactions({ page: 1, limit: 10 });

      expect(result.meta).toEqual({
        total: 23,
        page: 1,
        limit: 10,
        totalPages: 3,
      });
    });
  });

  describe('getAdminTransactionStats', () => {
    const now = new Date();
    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 15);
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    it('buckets COMPLETED transactions correctly and computes month-over-month growth', async () => {
      prisma.transaction.findMany
        .mockResolvedValueOnce([
          { status: 'COMPLETED', amount: 1000, createdAt: currentMonth },
          { status: 'PENDING', amount: 500, createdAt: currentMonth },
          { status: 'failed', amount: 200, createdAt: currentMonth },
        ])
        .mockResolvedValueOnce([
          { status: 'COMPLETED', amount: 400, createdAt: previousMonth },
        ]);

      const result = await service.getAdminTransactionStats();

      expect(result.data.completed).toEqual({
        amount: 1000,
        count: 1,
        growth: 150,
      });
      expect(result.data.pending).toEqual({
        amount: 500,
        count: 1,
        growth: 100,
      });
      expect(result.data.failed).toEqual({
        amount: 200,
        count: 1,
        growth: 100,
      });
      expect(result.data.total).toEqual({
        amount: 1500,
        count: 2,
        growth: 275,
      });
    });
  });

  describe('getAdminTransactionAnalytics', () => {
    it('buckets amounts into the correct day-of-week slot for the week view', async () => {
      const monday = new Date();
      const day = monday.getDay();
      const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
      monday.setDate(diff);
      monday.setHours(10, 0, 0, 0);

      prisma.transaction.findMany.mockResolvedValue([
        { amount: 300, createdAt: monday },
      ]);

      const result = await service.getAdminTransactionAnalytics('week');

      expect(result.data.total).toBe(300);
      expect(result.data.data[0]).toEqual({ label: 'Mon', amount: 300 });
    });
  });

  describe('exportAdminTransactionsToCSV', () => {
    it('computes the fee and net amount columns from the transaction percentageFee', async () => {
      prisma.transaction.findMany.mockResolvedValue([
        {
          id: 'txn-1',
          amount: 1000,
          currency: 'NGN',
          percentageFee: 0.05,
          status: 'COMPLETED',
          providerRef: 'ref-1',
          paidAt: new Date(),
          createdAt: new Date(),
          senderDetails: { senderName: 'Jane', senderDescription: 'Test' },
          vendor: { businessName: 'Glow Studio' },
        },
      ]);

      const csv = await service.exportAdminTransactionsToCSV({});

      expect(csv).toContain('Fee (%)');
      expect(csv).toContain('5.00%');
      expect(csv).toContain('Glow Studio');
      expect(csv).toContain('₦950');
    });
  });

  describe('getDashboardStats (bug fix regression)', () => {
    it('counts COMPLETED transactions in the completed bucket instead of always zero', async () => {
      prisma.vendor.findFirst.mockResolvedValue({ id: 'vendor-1' });
      prisma.transaction.findMany
        .mockResolvedValueOnce([
          { status: 'COMPLETED', amount: 800, createdAt: new Date() },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.getDashboardStats('user-1');

      expect(result.completed).toBe(800);
    });
  });

  describe('getPlatformRevenue (bug fix regression)', () => {
    it('sums each transaction amount times its own percentageFee, without crashing on a non-array subaccount lookup', async () => {
      prisma.transaction.findMany.mockResolvedValue([
        { amount: 1000, percentageFee: 0.05 },
        { amount: 2000, percentageFee: 0.1 },
        { amount: 500, percentageFee: null },
      ]);

      const result = await service.getPlatformRevenue();

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'COMPLETED' } }),
      );
      expect(result.data.platformRevenue).toBe(250);
    });

    it('returns 0 when there are no completed transactions', async () => {
      prisma.transaction.findMany.mockResolvedValue([]);

      const result = await service.getPlatformRevenue();

      expect(result.data.platformRevenue).toBe(0);
    });
  });
});
