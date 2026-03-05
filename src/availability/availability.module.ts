import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { PrismaService } from 'prisma/prisma.service';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [AvailabilityController],
  providers: [PrismaService, AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
