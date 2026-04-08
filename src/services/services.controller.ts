import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ServicesService } from './services.service';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';

@Controller('services')
export class ServicesController {
  constructor(private servicesService: ServicesService) {}

  @Get('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getAllServices(
    @Req() req: { user: { id: string } },
    @Query() query: { page: number; limit: number; search?: string },
  ) {
    const { page = 1, limit = 10, search } = query;
    return this.servicesService.getAllServices(
      req.user.id,
      page,
      limit,
      search,
    );
  }
}
