import { Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CancellationPolicyController } from './cancellation-policy.controller';
import { CancellationPolicyRepository } from './cancellation-policy.repository';
import { CancellationPolicyService } from './cancellation-policy.service';

@Module({
  controllers: [CancellationPolicyController],
  providers: [
    PrismaService,
    CancellationPolicyRepository,
    CancellationPolicyService,
  ],
  exports: [CancellationPolicyService],
})
export class CancellationPolicyModule {}
