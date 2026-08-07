import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { RescheduleService } from './reschedule.service';
import {
  CancelBookingDto,
  CounterProposeRescheduleDto,
  RequestRescheduleDto,
  RespondRescheduleDto,
} from './dto/reschedule.dto';

interface AuthedRequest {
  user: { id: string; email: string; role: string };
}

@Controller('booking/:bookingId')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RescheduleController {
  constructor(private readonly rescheduleService: RescheduleService) {}

  @Post('reschedule')
  @Roles('CLIENT', 'VENDOR')
  requestReschedule(
    @Param('bookingId') bookingId: string,
    @Body() dto: RequestRescheduleDto,
    @Req() req: AuthedRequest,
  ) {
    return this.rescheduleService.requestReschedule(
      bookingId,
      req.user.id,
      dto,
    );
  }

  @Post('reschedule/accept')
  @HttpCode(HttpStatus.OK)
  @Roles('CLIENT', 'VENDOR')
  acceptReschedule(
    @Param('bookingId') bookingId: string,
    @Body() dto: RespondRescheduleDto,
    @Req() req: AuthedRequest,
  ) {
    return this.rescheduleService.acceptReschedule(bookingId, req.user.id, dto);
  }

  @Post('reschedule/reject')
  @HttpCode(HttpStatus.OK)
  @Roles('CLIENT', 'VENDOR')
  rejectReschedule(
    @Param('bookingId') bookingId: string,
    @Body() dto: RespondRescheduleDto,
    @Req() req: AuthedRequest,
  ) {
    return this.rescheduleService.rejectReschedule(bookingId, req.user.id, dto);
  }

  @Post('reschedule/counter')
  @Roles('CLIENT', 'VENDOR')
  counterPropose(
    @Param('bookingId') bookingId: string,
    @Body() dto: CounterProposeRescheduleDto,
    @Req() req: AuthedRequest,
  ) {
    return this.rescheduleService.counterPropose(bookingId, req.user.id, dto);
  }

  @Post('reschedule/override')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  overrideRescheduleLimit(
    @Param('bookingId') bookingId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.rescheduleService.overrideRescheduleLimit(
      bookingId,
      req.user.id,
    );
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @Roles('CLIENT', 'VENDOR')
  cancelBooking(
    @Param('bookingId') bookingId: string,
    @Body() dto: CancelBookingDto,
    @Req() req: AuthedRequest,
  ) {
    return this.rescheduleService.cancelBooking(bookingId, req.user.id, dto);
  }

  @Get('reschedule-history')
  @Roles('CLIENT', 'VENDOR', 'ADMIN')
  getRescheduleHistory(
    @Param('bookingId') bookingId: string,
    @Req() req: AuthedRequest,
  ) {
    return this.rescheduleService.getRescheduleHistory(bookingId, req.user.id);
  }
}
