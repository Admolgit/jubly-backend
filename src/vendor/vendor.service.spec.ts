import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CloudinaryService } from 'src/infrastructure/cloudinary.service';
import { PaystackService } from 'src/paystack/paystack.service';
import { ActivityService } from 'src/activity/activityLog.service';
import { VendorService } from './vendor.service';

describe('VendorService', () => {
  let service: VendorService;
  let prisma: {
    vendor: { findUnique: jest.Mock };
    subAccount: { findFirst: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      vendor: { findUnique: jest.fn() },
      subAccount: { findFirst: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorService,
        { provide: PrismaService, useValue: prisma },
        { provide: CloudinaryService, useValue: {} },
        { provide: PaystackService, useValue: {} },
        { provide: ActivityService, useValue: { createLog: jest.fn() } },
      ],
    }).compile();

    service = module.get(VendorService);
  });

  describe('updateSubAccountFee', () => {
    it('updates the percentageFee on the vendor subaccount', async () => {
      prisma.vendor.findUnique.mockResolvedValue({
        id: 'vendor-1',
        userId: 'user-1',
      });
      prisma.subAccount.findFirst.mockResolvedValue({
        id: 'subaccount-1',
        userId: 'user-1',
        percentageFee: 0.05,
      });
      prisma.subAccount.update.mockResolvedValue({
        id: 'subaccount-1',
        percentageFee: 0.1,
      });

      const result = await service.updateSubAccountFee('vendor-1', {
        percentageFee: 0.1,
      });

      expect(prisma.subAccount.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(prisma.subAccount.update).toHaveBeenCalledWith({
        where: { id: 'subaccount-1' },
        data: { percentageFee: 0.1 },
      });
      expect(result.data.percentageFee).toBe(0.1);
    });

    it('throws NotFoundException when the vendor does not exist', async () => {
      prisma.vendor.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSubAccountFee('missing-vendor', { percentageFee: 0.1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the vendor has no subaccount yet', async () => {
      prisma.vendor.findUnique.mockResolvedValue({
        id: 'vendor-1',
        userId: 'user-1',
      });
      prisma.subAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.updateSubAccountFee('vendor-1', { percentageFee: 0.1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
