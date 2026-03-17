import { Module } from '@nestjs/common';
import { GoogleController } from './google.controller';
import { PrismaService } from 'prisma/prisma.service';
import { GoogleCalendarService } from './google.service';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';

@Module({
  controllers: [GoogleController],
  providers: [PrismaService, GoogleCalendarService, AuthService],
  exports: [],
  imports: [ConfigModule],
})
export class GoogleCalenderModule {}
