/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { CancellationPolicyService } from './cancellation-policy.service';
import { UpdateCancellationPolicyDto } from './dto/cancellation-policy.dto';

@Controller('admin/cancellation-policy')
export class CancellationPolicyController {
  constructor(
    private readonly cancellationPolicyService: CancellationPolicyService,
  ) {}

  @Get('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getPolicy() {
    return this.cancellationPolicyService.getPolicy();
  }

  @Put('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updatePolicy(@Body() dto: UpdateCancellationPolicyDto, @Req() req) {
    return this.cancellationPolicyService.updatePolicy(dto, req.user.id);
  }
}
