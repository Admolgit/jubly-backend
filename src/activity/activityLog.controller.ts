import { Controller, Get, Req } from '@nestjs/common';
import { ActivityService } from './activityLog.service';

@Controller('activity-logs')
export class ActivityLogController {
  constructor(private activityService: ActivityService) {}

  @Get()
  getLogsByUserId(@Req() req: { user: { id: string } }) {
    const userId = req.user.id;
    return this.activityService.getLogsByUserId(userId);
  }
}
