import { Module } from '@nestjs/common';
import { GoogleController } from './google.controller';
import { PrismaService } from 'prisma/prisma.service';
import { GoogleCalendarService } from './google.service';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { NodemailerService } from 'src/nodemailer/nodemailer.service';
import { ActivityService } from 'src/activity/activityLog.service';

@Module({
  controllers: [GoogleController],
  providers: [
    PrismaService,
    GoogleCalendarService,
    AuthService,
    NodemailerService,
    ActivityService,
  ],
  exports: [],
  imports: [ConfigModule],
})
export class GoogleCalenderModule {}
