/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { successResponse } from 'src/utils/response';
import { CloudinaryService } from 'src/infrastructure/cloudinary.service';
import { KYCStatus, Prisma } from '@prisma/client';
import { generateSlug } from 'src/utils/generateSlug';
import { PaystackService } from 'src/paystack/paystack.service';
import { CreateSubaccountDto } from 'src/paystack';
import { BulkUpdateItemDto, ServiceItemDto } from './dto/services.dto';

@Injectable()
export class VendorService {
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
    private paystackService: PaystackService,
  ) {}

  async completeOnboarding(userId: string, dto, files) {
    return await this.prisma.$transaction(async (tx) => {
      await this.createProfile(userId, dto.profile, tx);

      await this.createServices(userId, dto.services, tx);

      await this.createPaystackSubaccount(userId, dto.subaccount, tx);

      await this.submitProfileImage(userId, files.profileImage, tx);

      await this.submitIdentity(userId, dto.identity, files, tx);

      await this.uploadPortfolio(userId, files.portfolio, tx);

      return { message: 'Onboarding completed successfully' };
    });
  }

  async createProfile(
    userId: string,
    dto: CreateVendorDto,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.prisma;

    const exists = await prisma.vendor.findUnique({ where: { userId } });
    if (exists) throw new BadRequestException('Vendor profile already exists');

    const slug = generateSlug(dto.businessName);

    const vendor = await prisma.vendor.create({
      data: {
        userId,
        ...dto,
        kycStatus: KYCStatus.NOT_SUBMITTED,
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { slug },
    });

    return successResponse({ vendor }, 'Vendor created successfully', 201);
  }

  async createServices(
    userId: string,
    services: ServiceItemDto[],
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.prisma;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (!Array.isArray(services)) {
      throw new BadRequestException('Services must be an array');
    }

    const created = await Promise.all(
      services.map((s) =>
        prisma.service.create({
          data: {
            userId,
            name: s.name ?? '',
            description: s.description ?? '',
            price: s.price ?? 0,
            durationMins: s.durationMins ?? null,
          },
        }),
      ),
    );

    return successResponse({ created }, 'Services successfully created', 201);
  }

  async createPaystackSubaccount(
    userId: string,
    dto: CreateSubaccountDto,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.prisma;

    const vendor = await prisma.vendor.findFirst({ where: { userId } });
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) throw new NotFoundException('User not found');
    if (!vendor) throw new NotFoundException('Vendor not found');

    const doesAccountExists = await prisma.subAccount.findFirst({
      where: {
        vendorId: vendor.id,
        accountNumber: dto.accountNumber,
      },
    });

    if (doesAccountExists) {
      throw new BadRequestException(
        'This bank account is already linked to your vendor profile.',
      );
    }

    // External API calls (NOT inside prisma)
    const verifyAccount = await this.paystackService.resolveBankAccount(
      dto.accountNumber,
      dto.settlementBank,
    );

    if (!verifyAccount.status) {
      throw new BadRequestException('Account details does not match.');
    }

    const res: any = await this.paystackService.createSubaccount({
      business_name: verifyAccount.account_name,
      settlement_bank: dto.settlementBank,
      account_number: dto.accountNumber,
      percentage_charge: 0.1,
      charge_cap: 5000,
    });

    const paystackSubId =
      res?.data?.data?.subaccount_code ??
      res?.data?.data?.subaccount_id ??
      res?.data?.data?.id ??
      null;

    if (!paystackSubId) {
      throw new InternalServerErrorException(
        'Paystack subaccount creation failed',
      );
    }

    const verifyRes =
      await this.paystackService.verifySubaccount(paystackSubId);

    if (!verifyRes.active) {
      throw new BadRequestException('Paystack subaccount verification failed');
    }

    const pastackUserAccount = await prisma.subAccount.create({
      data: {
        vendorId: vendor.id,
        paystackAccountId: paystackSubId,
        bankName: dto.settlementBank,
        accountNumber: dto.accountNumber,
        accountName: dto.businessName,
        limit: 5000000,
      },
    });

    await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        paystackSubaccount: paystackSubId,
        bankAccountNumber: dto.accountNumber,
        bankCode: dto.settlementBank,
      },
    });

    return successResponse(
      pastackUserAccount,
      'Paystack subaccount created and verified successfully',
      201,
    );
  }

  async submitProfileImage(
    userId: string,
    file: Express.Multer.File,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.prisma;

    if (!file) {
      throw new BadRequestException('Profile image is required');
    }

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const uploadResult = await this.cloudinaryService.uploadImage(file);

    const updatedVendor = prisma.vendor.update({
      where: { userId },
      data: {
        profileImage: uploadResult,
      },
    });

    return successResponse(
      { updatedVendor },
      'Profile image submitted successfully',
    );
  }

  async submitIdentity(
    userId: string,
    body: { identityType: string },
    files: {
      documentFrontUrl?: Express.Multer.File[];
      documentBackUrl?: Express.Multer.File[];
    },
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.prisma;

    if (!body.identityType) {
      throw new BadRequestException('Identity type is required');
    }

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    const frontFile = files.documentFrontUrl?.[0];
    const backFile = files.documentBackUrl?.[0];

    if (!frontFile || !backFile) {
      throw new BadRequestException(
        'Both front and back identity images are required',
      );
    }

    const frontUpload = await this.cloudinaryService.uploadImage(frontFile);
    const backUpload = await this.cloudinaryService.uploadImage(backFile);

    const updatedVendor = prisma.vendor.update({
      where: { userId },
      data: {
        identityType: body.identityType,
        documentFrontUrl: frontUpload,
        documentBackUrl: backUpload,
      },
    });

    return successResponse(
      { updatedVendor },
      'Identity image submitted successfully',
    );
  }

  async uploadPortfolio(
    userId: string,
    files: Express.Multer.File[],
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx ?? this.prisma;

    if (!files?.length) {
      throw new BadRequestException('At least one image is required');
    }

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    // Upload to Cloudinary (external service)
    const uploads = await Promise.all(
      files.map((file) => this.cloudinaryService.uploadImage(file)),
    );

    const uploadedPortfolios = prisma.vendor.update({
      where: { userId },
      data: {
        portfolioImages: {
          push: uploads, // uploads already contains the URLs
        },
        kycStatus: KYCStatus.PENDING,
      },
    });

    return successResponse(
      { uploadedPortfolios },
      'Uploaded portfolio successfully',
    );
  }

  async updateProfile(userId: string, dto: CreateVendorDto) {
    try {
      const exists = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!exists)
        throw new BadRequestException('Vendor profile does not exists');

      const vendor = await this.prisma.vendor.update({
        where: { userId },
        data: {
          ...dto,
        },
      });

      return successResponse(
        { vendor },
        'Vendor profile updated successfully',
        201,
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to update vendor profile',
        error.message,
      );
    }
  }

  async bulkUpdateServices(userId: string, updates: BulkUpdateItemDto[]) {
    try {
      // Ensure the vendor exists
      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });
      if (!vendor) throw new NotFoundException('Vendor not found');

      // Update each service in parallel
      const updatedServices = await Promise.all(
        updates.map(async (item) => {
          // Verify the service belongs to this vendor
          const service = await this.prisma.service.findFirst({
            where: {
              id: item.id,
              userId,
            },
          });
          if (!service) {
            throw new NotFoundException(`Service ${item.id} not found`);
          }

          // Update only the provided fields
          return await this.prisma.service.update({
            where: { id: item.id },
            data: item.data,
          });
        }),
      );

      return successResponse(
        { updatedServices },
        'Service updated successfully.',
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to update vendor services',
        error.message,
      );
    }
  }

  async getVendorServices(userId: string) {
    try {
      const services = await this.prisma.service.findMany({
        where: { userId },
      });

      if (!services) throw new NotFoundException('No services found');

      return successResponse(
        { services },
        'Vendor services fetched successfully.',
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch vendor services',
        error.message,
      );
    }
  }

  async getPendingVendors() {
    try {
      const pendingVendors = await this.prisma.vendor.findMany({
        where: { kycStatus: KYCStatus.PENDING },
      });

      return successResponse(
        { pendingVendors },
        'Pending vendors retrieved successfully',
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to get pending vendors',
        error.message,
      );
    }
  }

  async getPendingVendorsById(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findFirst({
        where: {
          userId,
          kycStatus: KYCStatus.PENDING,
        },
      });

      return successResponse(vendor, 'Pending vendor fetched successfully.');
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch pending vendor',
        error.message,
      );
    }
  }

  async getAllVendors() {
    try {
      const vendors = await this.prisma.vendor.findMany();
      if (!vendors || vendors.length === 0) {
        throw new NotFoundException('No vendors found');
      }

      return successResponse({ vendors }, 'Vendors retrieved successfully');
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to get all vendors',
        error.message,
      );
    }
  }

  async approveVendor(vendorId: string) {
    try {
      const approveVendor = await this.prisma.vendor.update({
        where: { id: vendorId },
        data: {
          kycStatus: KYCStatus.APPROVED,
          isApproved: true,
          isActive: true,
        },
      });

      return successResponse({ approveVendor }, 'Vendor approved successfully');
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to approve vendor',
        error.message,
      );
    }
  }

  async getVendorStatus(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
      if (!vendor) throw new NotFoundException('Vendor not found');

      const status = await this.prisma.vendor.findUnique({
        where: { userId },
        select: {
          kycStatus: true,
          isApproved: true,
          isActive: true,
        },
      });

      return successResponse(
        { status },
        'Vendor status retrieved successfully',
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to get vendor status',
        error.message,
      );
    }
  }

  async rejectVendor(vendorId: string) {
    try {
      const rejectVendor = await this.prisma.vendor.update({
        where: { id: vendorId },
        data: {
          kycStatus: KYCStatus.REJECTED,
          isApproved: false,
          isActive: false,
        },
      });

      return successResponse({ rejectVendor }, 'Vendor rejected successfully');
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to reject vendor',
        error.message,
      );
    }
  }

  // Booking creation vendor check
  ensureVendorIsActive(vendor: { isActive: boolean; kycStatus: string }) {
    if (!vendor.isActive || vendor.kycStatus !== 'APPROVED') {
      throw new ForbiddenException('Vendor not approved');
    }
  }
}
