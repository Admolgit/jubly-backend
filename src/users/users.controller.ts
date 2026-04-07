import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { UsersService } from './users.service';
import type { Request } from 'express';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { FileFieldsInterceptor } from '@nestjs/platform-express';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getMe(@Req() req: Request & { user: { id: string } }) {
    return this.usersService.getMe(req.user.id);
  }
  @Get(':clientVendorId')
  getClientsByVendor(@Param('clientVendorId') clientVendorId: string) {
    return this.usersService.getClientsByVendor(clientVendorId);
  }
  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'profileImage', maxCount: 1 }]),
  )
  updateProfileImage(
    @Req() req: Request & { user: { id: string } },
    file: Express.Multer.File,
  ) {
    return this.usersService.updateProfilePicture(req.user.id, file);
  }
  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getUserById(@Req() req: Request & { user: { id: string } }) {
    return this.usersService.getUserById(req.user.id);
  }
}
