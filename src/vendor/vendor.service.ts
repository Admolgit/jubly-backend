/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from 'prisma/prisma.service';
import { CreateVendorDto, QueryVendorsDto } from './dto/create-vendor.dto';
import { successResponse } from 'src/utils/response';
import { CloudinaryService } from 'src/infrastructure/cloudinary.service';
import { Prisma } from '@prisma/client';
import { generateSlug } from 'src/utils/generateSlug';
import { PaystackService } from 'src/paystack/paystack.service';
import { CreateSubaccountDto, UpdateBankDetailsDto } from 'src/paystack';
import { BulkUpdateItemDto, ServiceItemDto } from './dto/services.dto';
import { Parser } from 'json2csv';
import dayjs from 'dayjs';
import { ActivityService } from 'src/activity/activityLog.service';

@Injectable()
export class VendorService {
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
    private paystackService: PaystackService,
    private activityService: ActivityService,
  ) {}

  async completeOnboarding(userId: string, dto, files) {
    try {
      await this.createServices(userId, dto.profile.vendorId, dto.services);

      const createdVendor = await this.submitIdentity(
        userId,
        dto.identityType,
        files,
      );

      await this.createPaystackSubaccount(userId, dto.subaccount);

      await this.submitProfileImage(userId, files.profileImage);
      await this.uploadPortfolio(userId, files.portfolio);

      await this.prisma.service.updateMany({
        where: { userId },
        data: { vendorId: dto.profile.vendorId },
      });

      return successResponse(
        { createdVendor },
        'Onboarding completed successfully',
        201,
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed', error.message);
    }
  }

  async createProfile(
    userId: string,
    dto: CreateVendorDto,
    tx?: Prisma.TransactionClient,
  ) {
    try {
      const prisma = tx ?? this.prisma;

      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      const slug = generateSlug(dto.businessName);

      const vendor = await prisma.vendor.upsert({
        where: { userId },
        update: {
          ...dto,
          kycStatus: 'NOT_SUBMITTED',
        },
        create: {
          userId,
          ...dto,
          kycStatus: 'NOT_SUBMITTED',
        },
      });

      await prisma.user.update({
        where: { id: userId },
        data: { slug },
      });

      return successResponse({ vendor }, 'Vendor created successfully', 201);
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed', error.message);
    }
  }

  async createServices(
    userId: string,
    vendorId: string,
    services: ServiceItemDto[],
    tx?: Prisma.TransactionClient,
  ) {
    try {
      if (tx) {
        return this._createServicesLogic(userId, vendorId, services, tx);
      }

      return this.prisma.$transaction((db) =>
        this._createServicesLogic(userId, vendorId, services, db),
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        error.message || 'Failed to create services',
      );
    }
  }

  private async _createServicesLogic(
    userId: string,
    vendorId: string,
    services: ServiceItemDto[],
    db: Prisma.TransactionClient,
  ) {
    const user = await db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const created = await Promise.all(
      services.map((service) =>
        db.service.upsert({
          where: {
            userId_name: {
              userId,
              name: service.name || '',
            },
          },
          update: {
            description: service.description,
            price: service.price,
            durationMins: service.durationMins,
            vendorId,
          },
          create: {
            userId,
            vendorId,
            name: service.name ?? '',
            description: service.description,
            price: service.price ?? 0,
            durationMins: service.durationMins,
          },
        }),
      ),
    );

    return successResponse(created, 'Services successfully created', 201);
  }

  async createPaystackSubaccount(userId: string, dto: CreateSubaccountDto) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });

      if (!user) throw new NotFoundException('User not found');

      const vendor = await this.prisma.vendor.findFirst({
        where: { userId: user.id },
      });
      if (!vendor) throw new NotFoundException('Vendor not found');

      const doesAccountExists = await this.prisma.subAccount.findFirst({
        where: {
          userId: user.id,
          accountNumber: dto.accountNumber,
        },
      });

      if (doesAccountExists) {
        throw new BadRequestException(
          'This bank account is already linked to your vendor profile.',
        );
      }

      const verifyAccount = await this.paystackService.resolveBankAccount(
        dto.accountNumber,
        dto.settlementBank,
      );

      if (!verifyAccount.status) {
        throw new BadRequestException('Account details does not match.');
      }

      const pastackUserAccount = await this.prisma.subAccount.create({
        data: {
          userId,
          paystackAccountId: `local_${randomUUID()}`,
          bankName: dto.settlementBank,
          accountNumber: dto.accountNumber,
          accountName: dto.businessName,
          limit: 5000000,
        },
      });

      await this.prisma.vendor.update({
        where: { userId },
        data: {
          bankAccountNumber: dto.accountNumber,
          bankCode: dto.settlementBank,
        },
      });

      return successResponse(
        pastackUserAccount,
        'Payout account created and verified successfully',
        201,
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to create subaccount',
        error.message,
      );
    }
  }

  async updateBankDetails(userId: string, dto: UpdateBankDetailsDto) {
    try {
      if (!/^\d{10}$/.test(dto.accountNumber)) {
        throw new BadRequestException('Account number must contain 10 digits');
      }

      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor || !vendor.bankAccountNumber) {
        throw new NotFoundException('Vendor payout account not found');
      }

      const subAccount = await this.prisma.subAccount.findFirst({
        where: { userId },
      });

      if (!subAccount) {
        throw new NotFoundException('Vendor payout account not found');
      }

      const resolvedAccount = await this.paystackService.resolveBankAccount(
        dto.accountNumber,
        dto.settlementBank,
      );

      if (!resolvedAccount?.status || !resolvedAccount?.data?.account_name) {
        throw new BadRequestException('Unable to verify these bank details');
      }

      const accountName = resolvedAccount.data.account_name;

      const [updatedSubAccount] = await this.prisma.$transaction([
        this.prisma.subAccount.update({
          where: { id: subAccount.id },
          data: {
            bankName: dto.settlementBank,
            accountNumber: dto.accountNumber,
            accountName,
          },
        }),
        this.prisma.vendor.update({
          where: { id: vendor.id },
          data: {
            bankAccountNumber: dto.accountNumber,
            bankCode: dto.settlementBank,
          },
        }),
      ]);

      return successResponse(
        updatedSubAccount,
        'Bank details updated successfully',
      );
    } catch (error: any) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof HttpException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to update bank details',
        error.message,
      );
    }
  }
  async submitProfileImage(userId: string, file: Express.Multer.File) {
    try {
      if (!file) {
        throw new BadRequestException('Profile image is required');
      }

      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }

      const uploadResult = await this.cloudinaryService.uploadImage(file);

      const updatedVendor = await this.prisma.vendor.update({
        where: { userId },
        data: {
          profileImage: uploadResult,
        },
      });

      return successResponse(
        { updatedVendor },
        'Profile image submitted successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to submit image',
        error.message,
      );
    }
  }

  async submitIdentity(userId: string, identityType: string, files: any) {
    try {
      if (!identityType) {
        throw new BadRequestException('Identity type is required');
      }

      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }

      const frontFile = files.documentFront;

      if (!frontFile) {
        throw new BadRequestException('Front identity images are required');
      }

      const frontUpload = await this.cloudinaryService.uploadImage(frontFile);

      const updatedVendor = await this.prisma.vendor.update({
        where: { userId },
        data: {
          identityType: identityType,
          documentFrontUrl: frontUpload,
        },
      });

      return successResponse(
        { updatedVendor },
        'Identity image submitted successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to submit identity',
        error.message,
      );
    }
  }

  async uploadPortfolio(userId: string, files: Express.Multer.File[]) {
    try {
      if (!files?.length) {
        throw new BadRequestException('At least one image is required');
      }

      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        throw new NotFoundException('Vendor not found');
      }

      const uploads = await Promise.all(
        files.map((file) => this.cloudinaryService.uploadImage(file)),
      );

      const uploadedPortfolios = await this.prisma.vendor.update({
        where: { userId },
        data: {
          portfolioImages: {
            push: uploads,
          },
          kycStatus: 'PENDING',
        },
      });

      await this.activityService.createLog({
        vendorId: vendor.id,
        userId: vendor.userId,
        action: 'VENDOR_CREATED',
        description: 'Vendor account was successfully created.',
        actor: 'System',
        actorType: 'VENDOR',
        color: 'pink',
      });

      return successResponse(
        { uploadedPortfolios },
        'Uploaded portfolio successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to upload portfolio.',
        error.message,
      );
    }
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
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to update vendor profile',
        error.message,
      );
    }
  }

  async bulkUpdateServices(userId: string, updates: BulkUpdateItemDto[]) {
    try {
      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });
      if (!vendor) throw new NotFoundException('Vendor not found');
      const updatedServices = await Promise.all(
        updates.map(async (item) => {
          const service = await this.prisma.service.findFirst({
            where: {
              id: item.id,
              userId,
            },
          });
          if (!service) {
            throw new NotFoundException(`Service ${item.id} not found`);
          }

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
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

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
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch vendor services',
        error.message,
      );
    }
  }

  async getPendingVendors() {
    try {
      const pendingVendors = await this.prisma.vendor.findMany({
        where: { kycStatus: 'PENDING' },
      });

      return successResponse(
        { pendingVendors },
        'Pending vendors retrieved successfully',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

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
          kycStatus: 'PENDING',
        },
      });

      return successResponse(
        { vendor },
        'Pending vendor fetched successfully.',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch pending vendor',
        error.message,
      );
    }
  }

  async getAllVendors() {
    try {
      const vendors = await this.prisma.vendor.findMany({
        where: {
          kycStatus: 'APPROVED',
        },
        include: {
          services: true,
        },
      });
      if (!vendors || vendors.length === 0) {
        throw new NotFoundException('No vendors found');
      }

      return successResponse({ vendors }, 'Vendors retrieved successfully');
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to get all vendors',
        error.message,
      );
    }
  }

  async approveVendor(vendorId: string) {
    return await this.prisma.$transaction(async (db) => {
      // 1. Approve vendor (idempotent)
      const vendor = await db.vendor.update({
        where: { id: vendorId },
        data: {
          kycStatus: 'APPROVED',
          isApproved: true,
          isActive: true,
        },
      });

      // 2. Assign vendor to ALL user's services safely
      await db.service.updateMany({
        where: {
          userId: vendor.userId,
          OR: [{ vendorId: null }, { vendorId: { not: vendorId } }],
        },
        data: {
          vendorId: vendorId,
        },
      });

      return successResponse({ vendor }, 'Vendor approved successfully');
    });
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
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

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
          kycStatus: 'REJECTED',
          isApproved: false,
          isActive: false,
        },
      });

      return successResponse({ rejectVendor }, 'Vendor rejected successfully');
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to reject vendor',
        error.message,
      );
    }
  }

  async deletePaystackSubaccount(userId: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    if (!vendor.bankAccountNumber) {
      throw new BadRequestException('Vendor has no payout account');
    }

    await this.prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        paystackSubaccount: null,
        bankAccountNumber: null,
        bankCode: null,
      },
    });

    return {
      message: 'Subaccount deleted successfully',
    };
  }

  ensureVendorIsActive(vendor: { isActive: boolean; kycStatus: string }) {
    if (!vendor.isActive || vendor.kycStatus !== 'APPROVED') {
      throw new ForbiddenException('Vendor not approved');
    }
  }

  async getVendorByUserId(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findFirst({
        where: {
          userId,
        },
      });

      return successResponse({ vendor }, 'Vendor fetched successfully.');
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch vendor profile',
        error.message,
      );
    }
  }

  async vendorBooking(slug: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: { slug },
      });

      if (!user) {
        throw new BadRequestException('User not found');
      }

      const vendor = await this.prisma.vendor.findUnique({
        where: {
          userId: user.id,
          kycStatus: 'APPROVED',
        },
        include: {
          user: {
            select: {
              email: true,
              id: true,
              slug: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      });

      if (!vendor) {
        throw new BadRequestException('Vendor profile not found.');
      }

      const services = await this.prisma.service.findMany({
        where: {
          userId: vendor?.userId,
          active: true,
        },
      });

      const vendorAvailability = await this.prisma.vendorAvailability.findMany({
        where: {
          vendorId: vendor?.id,
        },
      });

      await this.prisma.vendor.update({
        where: {
          id: vendor.id,
        },
        data: {
          vendorViews: { increment: 1 },
        },
      });

      return successResponse(
        { vendor, services, vendorAvailability },
        'Booking page fetched.',
      );
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch vendor',
        error.message,
      );
    }
  }

  async getServiceById(serviceId) {
    try {
      const service = await this.prisma.service.findFirst({
        where: {
          id: serviceId,
        },
      });

      return successResponse({ service }, 'Service fetched successfully');
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetched service',
        error.message,
      );
    }
  }

  async findVendors(query: QueryVendorsDto) {
    try {
      const { name, location, type, page = 1, limit = 10 } = query;

      const filters: any = {};
      if (name) filters.businessName = { contains: name, mode: 'insensitive' };
      if (location) filters.city = { contains: location, mode: 'insensitive' };
      if (type) filters.category = type;

      const skip = (page - 1) * limit;

      const [data, total] = await Promise.all([
        this.prisma.vendor.findMany({
          where: filters,
          skip,
          take: Number(limit),
        }),
        this.prisma.vendor.count({ where: filters }),
      ]);

      return successResponse({ data, total }, 'Successful');
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetched vendors',
        error.message,
      );
    }
  }

  async exportBookingsToCSV(userId: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor) {
        throw new BadRequestException('Vendor profile not found.');
      }

      const bookings = await this.prisma.booking.findMany({
        where: {
          vendorId: vendor.id,
        },
        include: {
          services: true,
        },
      });

      const fields = [
        {
          label: 'Client Name',
          value: 'clientName',
        },
        {
          label: 'Client Email',
          value: 'clientEmail',
        },
        {
          label: 'Service',
          value: 'serviceName',
        },
        {
          label: 'Price',
          value: 'price',
        },
        {
          label: 'Status',
          value: 'status',
        },
        {
          label: 'Date',
          value: 'date',
        },
        {
          label: 'Start Time',
          value: 'startTime',
        },
        {
          label: 'End Time',
          value: 'endTime',
        },
        {
          label: 'Created At',
          value: 'createdAt',
        },
      ];

      const formattedBookings = bookings.map((booking) => ({
        clientName: booking.clientName,
        clientEmail: booking.clientEmail,
        serviceName: booking.services?.name,
        price: booking.services?.price,
        status: booking.status,
        date: dayjs(booking.date).format('DD/MM/YYYY'),
        startTime: dayjs(booking.startTime).format('hh:mm A'),
        endTime: dayjs(booking.endTime).format('hh:mm A'),
        createdAt: dayjs(booking.createdAt).format('DD/MM/YYYY hh:mm A'),
      }));

      const parser = new Parser({
        fields,
      });

      return parser.parse(formattedBookings);
    } catch (error: any) {
      console.log(error);
      throw new InternalServerErrorException(
        'Failed to export bookings to csv',
      );
    }
  }
}
