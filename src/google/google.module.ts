import { Module } from '@nestjs/common';
import { GoogleController } from './google.controller';
import { PrismaService } from 'prisma/prisma.service';
import { GoogleCalendarService } from './google.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  controllers: [GoogleController],
  providers: [PrismaService, GoogleCalendarService],
  exports: [],
  imports: [ConfigModule],
})
export class GoogleCalenderModule {}
