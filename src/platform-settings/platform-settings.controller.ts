import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { PlatformSettingsService } from './platform-settings.service';
import { UpdatePlatformSettingsDto } from './dto/platform-settings.dto';
import { UpdateVendorPlatformSettingsDto } from './dto/vendor-platform-settings.dto';

@Controller('admin/platform-settings')
export class PlatformSettingsController {
  constructor(
    private readonly platformSettingsService: PlatformSettingsService,
  ) {}

  @Get('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.VENDOR)
  getSettings() {
    return this.platformSettingsService.getSettings();
  }

  @Patch('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateSettings(
    @Body() dto: UpdatePlatformSettingsDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.platformSettingsService.updateSettings(dto, req.user.id);
  }

  @Get('vendor/:vendorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getVendorOverride(@Param('vendorId') vendorId: string) {
    return this.platformSettingsService.getVendorOverride(vendorId);
  }

  @Patch('vendor/:vendorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateVendorOverride(
    @Param('vendorId') vendorId: string,
    @Body() dto: UpdateVendorPlatformSettingsDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.platformSettingsService.updateVendorOverride(
      vendorId,
      dto,
      req.user.id,
    );
  }

  @Delete('vendor/:vendorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  clearVendorOverride(@Param('vendorId') vendorId: string) {
    return this.platformSettingsService.clearVendorOverride(vendorId);
  }
}
