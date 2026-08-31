import { Module } from '@nestjs/common';
import { ActivityLogController } from './activityLog.controller';
import { ActivityService } from './activityLog.service';
import { PrismaService } from 'prisma/prisma.service';
import { VendorModule } from 'src/vendor/vendor.module';

@Module({
  imports: [],
  controllers: [ActivityLogController],
  providers: [ActivityService, PrismaService, VendorModule],
  exports: [ActivityService],
})
export class ActivityLogModule {}
