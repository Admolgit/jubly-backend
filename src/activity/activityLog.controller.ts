import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ActivityService } from './activityLog.service';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';

@Controller('activity-logs')
export class ActivityLogController {
  constructor(private activityService: ActivityService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'CLIENT')
  getLogsByUserId(@Req() req: { user: { id: string } }) {
    const userId = req.user.id;
    return this.activityService.getLogsByUserId(userId);
  }
}
