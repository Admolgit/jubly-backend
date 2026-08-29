import { Module } from '@nestjs/common';
import { NodemailerService } from './nodemailer.service';

@Module({
  controllers: [],
  exports: [NodemailerService],
  imports: [],
  providers: [NodemailerService],
})
export class NodemailerModule {}
