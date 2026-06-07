import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaModule } from 'prisma/prisma.module';
import { CloudinaryService } from 'src/infrastructure/cloudinary.service';
import { ActivityService } from 'src/activity/activityLog.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, CloudinaryService, ActivityService],
})
export class UsersModule {}
