import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getAllServices(
    @Req() req: { user: { id: string } },
    @Query()
    query: { page: number; limit: number; search?: string; isActive?: string },
  ) {
    const { page = 1, limit = 10, search, isActive } = query;
    return this.servicesService.getAllServices(
      req.user.id,
      page,
      limit,
      search,
      isActive,
    );
  }

  @Patch('update/:serviceId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  updateServiceActive(
    @Req() req: { user: { id: string } },
    @Param('serviceId') serviceId: string,
    @Body() dto: { active: string },
  ) {
    return this.servicesService.updateServiceActive(
      serviceId,
      req.user.id,
      dto.active,
    );
  }

  @Get(':serviceId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getService(
    @Req() req: { user: { id: string } },
    @Param('serviceId') serviceId: string,
  ) {
    return this.servicesService.getServiceById(req.user.id, serviceId);
  }
}
