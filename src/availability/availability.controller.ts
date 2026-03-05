/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Controller,
  Get,
  Req,
  UseGuards,
  Post,
  Body,
  Delete,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { UserRole } from '@prisma/client';
import { CreateVendorAvailabilityDto } from './dto/availability.dto';

@Controller('availability')
export class AvailabilityController {
  constructor(private availabilityService: AvailabilityService) {}

  @Get('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  getAvailability(@Req() req) {
    return this.availabilityService.getAvailability(req.user.id);
  }

  @Get('grouped-availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  getAvailabilityGrouped(@Req() req) {
    return this.availabilityService.getAvailabilityGrouped(req.user.id);
  }

  @Post('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  setAvailability(@Req() req, @Body() body: CreateVendorAvailabilityDto) {
    return this.availabilityService.setAvailability(req.user.id, body);
  }

  @Delete(':dayOfWeek')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  deleteAvailability(
    @Req() req,
    @Param('dayOfWeek', ParseIntPipe) dayOfWeek: number,
  ) {
    return this.availabilityService.deleteAvailability(req.user.id, dayOfWeek);
  }
}
