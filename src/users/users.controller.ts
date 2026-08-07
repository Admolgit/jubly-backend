/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Public } from 'src/auth/public.decorator';
import { UsersService } from './users.service';
import type { Request } from 'express';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { UpdateNotificationDto } from './dto/notification.dto';
import { cloudinaryMulterOptions } from 'src/middlewares/cloudinary.middleware';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getMe(@Req() req: Request & { user: { id: string } }) {
    return this.usersService.getMe(req.user.id);
  }

  @Patch('profile-image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'profileImage', maxCount: 1 }],
      cloudinaryMulterOptions,
    ),
  )
  updateProfileImage(
    @Req() req: Request & { user: { id: string } },
    @UploadedFiles() files: { profileImage?: Express.Multer.File[] },
  ) {
    return this.usersService.updateProfilePicture(
      req.user.id,
      files.profileImage?.[0],
    );
  }

  @Patch('user/update')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  updateProfile(
    @Req() req: Request & { user: { id: string } },
    @Body() dto: any,
  ) {
    return this.usersService.updateProfile(req.user.id, dto);
  }
  @Get('user/:userId')
  @Public()
  getUserById(@Param('userId') userId: string) {
    return this.usersService.getUserById(userId);
  }

  @Get('me/sub-account')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getUserSubAccount(@Req() req: Request & { user: { id: string } }) {
    return this.usersService.getUserSubAccount(req.user.id);
  }

  @Get('email/:email')
  @Public()
  getUserByEmail(@Param('email') email: string) {
    return this.usersService.getUserEmail(email);
  }

  @Post('enquiry')
  @Public()
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

  @Patch('notification')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'CLIENT')
  updateNotifications(
    @Req() req: { user: { id: string } },
    @Body() dto: UpdateNotificationDto,
  ) {
    const userId = req.user.id;

    return this.usersService.createNotification(userId, dto);
  }

  // @Patch('notification')
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles('VENDOR', 'CLIENT')
  // getNotification(@Req() req: { user: { id: string } }) {
  //   const userId = req.user.id;

  //   return this.usersService.getNotificationPreference(userId);
  // }

  @Get('notification')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'CLIENT')
  getNotication(@Req() req: { user: { id: string } }) {
    return this.usersService.getNotificationPreference(req.user.id);
  }

  @Get('user-notification')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'CLIENT')
  getNotications(
    @Req() req: { user: { id: string } },
    @Query() query: { page: number; limit: number },
  ) {
    return this.usersService.getAllUserNotifications(req.user.id, query);
  }

  @Post('create-notification')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR', 'CLIENT')
  createAndSendNotification(
    @Body() dto: any,
    @Req() req: { user: { id: string } },
  ) {
    const userId = req.user.id;
    return this.usersService.createAndSend(userId, dto);
  }

  @Get(':clientVendorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('VENDOR')
  getClientsByVendor(
    @Req() req: Request & { user: { id: string } },
    @Param('clientVendorId') clientVendorId: string,
  ) {
    return this.usersService.getClientsByVendor(req.user.id, clientVendorId);
  }
}
