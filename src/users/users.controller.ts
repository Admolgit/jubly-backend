import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
  @Get('user/:userId')
  getUserById(@Param('userId') userId: string) {
    return this.usersService.getUserById(userId);
  }

  @Get('me/sub-account')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getUserSubAccount(@Req() req: Request & { user: { id: string } }) {
    return this.usersService.getUserSubAccount(req.user.id);
  }

  @Post('enquiry')
  createEnquiry(
    @Body()
    body: {
      name: string;
      email: string;
      phone: string;
      message: string;
    },
  ) {
    return this.usersService.createEnquiry(body);
  }
}
