import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'prisma/prisma.service';
import { CloudinaryService } from 'src/infrastructure/cloudinary.service';
import { PaystackService } from 'src/paystack/paystack.service';
import { ActivityService } from 'src/activity/activityLog.service';
import { VendorService } from './vendor.service';

describe('VendorService', () => {
  let service: VendorService;
  let prisma: {
    subAccount: { updateMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      subAccount: { updateMany: jest.fn() },
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
    it('updates the percentageFee across all subaccounts', async () => {
      prisma.subAccount.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.updateSubAccountFee({
        percentageFee: 0.1,
      });

      expect(prisma.subAccount.updateMany).toHaveBeenCalledWith({
        data: { percentageFee: 0.1 },
      });
      expect(result.data.count).toBe(5);
    });
  });
});
