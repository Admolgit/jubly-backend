import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ActivityService } from './activityLog.service';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';

@Controller('activity-logs')
export class ActivityLogController {
  constructor(private activityService: ActivityService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'CLIENT')
  getLogsByUserId(
    @Req() req: { user: { id: string } },
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const userId = req.user.id;
    return this.activityService.getLogsByUserId(userId, page, limit);
  }
}
