/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { VendorService } from './vendor.service';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { UserRole } from '@prisma/client';
import {
  CompleteVendorOnboardingDto,
  CreateVendorDto,
} from './dto/create-vendor.dto';
import {
  FileFieldsInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { cloudinaryMulterOptions } from 'src/middlewares/cloudinary.middleware';
import { CreateSubaccountDto } from 'src/paystack';
import { BulkUpdateItemDto, CreateServicesDto } from './dto/services.dto';

@Controller('vendor')
export class VendorController {
  constructor(private vendorService: VendorService) {}

  @Post('onboarding/complete-onboarding')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'profileImage', maxCount: 1 },
      { name: 'documentFrontUrl', maxCount: 1 },
      { name: 'portfolio', maxCount: 10 },
    ]),
  )
  async completeOnboarding(
    @Req() req: { user: { id: string } },
    @Body() body: any,
    @UploadedFiles()
    files: {
      profileImage?: Express.Multer.File[];
      documentFrontUrl?: Express.Multer.File[];
      portfolio?: Express.Multer.File[];
    },
  ) {
    const userId = req.user.id;

    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    let parsedDto: CompleteVendorOnboardingDto;

    try {
      parsedDto = {
        profile: JSON.parse(body.profile),
        services: JSON.parse(body.services),
        subaccount: JSON.parse(body.subaccount),
        identityType: body.identityType,
      };
    } catch (err: any) {
      throw new BadRequestException(
        'Invalid JSON structure in request body',
        err.message,
      );
    }

    return this.vendorService.completeOnboarding(userId, parsedDto, {
      profileImage: files.profileImage?.[0],
      documentFront: files.documentFrontUrl?.[0],
      portfolio: files.portfolio ?? [],
    });
  }

  @Post('onboarding/profile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  createProfile(
    @Req() req: { user: { id: string } },
    @Body() dto: CreateVendorDto,
  ) {
    const userId = req.user.id;
    return this.vendorService.createProfile(userId, dto);
  }

  @Post('onboarding/services')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  createServices(@Req() req, @Body() body: CreateServicesDto) {
    return this.vendorService.createServices(
      req.user.id,
      body.services,
      req.user.id,
    );
  }

  @Patch('onboarding/update-services')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  bulkUpdateServices(
    @Req() req: { user: { id: string } },
    @Body() body: { updates: BulkUpdateItemDto[] },
  ) {
    return this.vendorService.bulkUpdateServices(req.user.id, body.updates);
  }

  @Get('onboarding/vendor-services/:userId')
  getVendorServices(@Param('userId') userId: string) {
    return this.vendorService.getVendorServices(userId);
  }

  @Patch('onboarding/profile-update')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  updateProfile(@Req() req: { user: { id: string } }, @Body() dto: any) {
    const userId = req.user.id;
    return this.vendorService.updateProfile(userId, dto);
  }

  @Post('onboarding/create-subaccount')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  createSubaccount(
    @Req() req: { user: { id: string } },
    @Body() dto: CreateSubaccountDto,
  ) {
    const userId = req.user.id;
    return this.vendorService.createPaystackSubaccount(userId, dto);
  }

  @Patch('onboarding/identity-image')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'documentFrontUrl', maxCount: 1 },
      { name: 'documentBackUrl', maxCount: 1 },
    ]),
  )
  @Patch('onboarding/portfolio-images')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  @UseInterceptors(FilesInterceptor('files', 10, cloudinaryMulterOptions))
  submitPortfolioImages(
    @Req() req: { user: { id: string } },
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.vendorService.uploadPortfolio(req.user.id, files);
  }

  @Get('onboarding/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  getStatus(@Req() req: { user: { id: string } }) {
    return this.vendorService.getVendorStatus(req.user.id);
  }

  @Get('')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  getVendorByUserId(@Req() req: { user: { id: string } }) {
    return this.vendorService.getVendorByUserId(req.user.id);
  }

  @Get('admin/all-vendors')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getAllVendors() {
    return this.vendorService.getAllVendors();
  }

  @Patch('admin/approve/:vendorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  approveVendor(@Param('vendorId') vendorId: string) {
    return this.vendorService.approveVendor(vendorId);
  }

  @Patch('admin/reject/:vendorId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  rejectVendor(@Param('vendorId') vendorId: string) {
    return this.vendorService.rejectVendor(vendorId);
  }

  @Get('admin/pending')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getPendingVendors() {
    return this.vendorService.getPendingVendors();
  }

  @Get('booking-vendor/:slug')
  getBookingPage(@Param('slug') slug: string) {
    return this.vendorService.vendorBooking(slug);
  }

  @Get('service/:serviceId')
  getServiceById(@Param('serviceId') serviceId: string) {
    return this.vendorService.getServiceById(serviceId);
  }
}
