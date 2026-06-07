import { Module } from '@nestjs/common';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { PrismaService } from 'prisma/prisma.service';
import { CloudinaryService } from 'src/infrastructure/cloudinary.service';
import { PaystackService } from 'src/paystack/paystack.service';
import { ActivityService } from 'src/activity/activityLog.service';

@Module({
  controllers: [VendorController],
  providers: [
    VendorService,
    PrismaService,
    CloudinaryService,
    PaystackService,
    ActivityService,
    ActivityService,
  ],
  imports: [],
})
export class VendorModule {}
