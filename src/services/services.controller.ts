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

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async getAllServicesAdmin(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('date') date?: string,
    @Query('month') month?: number,
    @Query('year') year?: number,
  ) {
    return this.servicesService.getAllServicesAdmin(
      Number(page),
      Number(limit),
      search,
      isActive,
      date,
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
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
