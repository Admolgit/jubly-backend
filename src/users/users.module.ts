import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { PrismaModule } from 'prisma/prisma.module';
import { CloudinaryService } from 'src/infrastructure/cloudinary.service';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, CloudinaryService],
})
export class UsersModule {}
