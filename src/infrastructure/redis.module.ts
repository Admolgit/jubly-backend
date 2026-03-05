import { Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { CloudinaryService } from './cloudinary.service';

Module({
  providers: [RedisService, CloudinaryService],
  exports: [RedisService, CloudinaryService],
});
export class RedisModule {}
