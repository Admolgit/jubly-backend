import { Module } from '@nestjs/common';
import { VendorController } from './vendor.controller';
import { VendorService } from './vender.service';
import { PrismaService } from 'prisma/prisma.service';

@Module({
  controllers: [VendorController],
  providers: [VendorService, PrismaService],
  imports: [],
})
export class VendorModule {}
