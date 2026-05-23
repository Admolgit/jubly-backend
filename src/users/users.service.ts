/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { CloudinaryService } from 'src/infrastructure/cloudinary.service';
import { successResponse } from 'src/utils/response';
import { UpdateNotificationDto } from './dto/notification.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
  ) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return successResponse({ user }, 'successful');
  }

  async updateProfile(userId: string, dto: any) {
    try {
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
        },
      });

      return successResponse({ updatedUser }, 'Profile updated successfully.');
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to initialize payment',
        error.message as string,
      );
    }
  }

  async updateProfilePicture(userId: string, file: Express.Multer.File) {
    try {
      const imageUrl = await this.cloudinaryService.uploadImage(file);
      const updatedPicture = await this.prisma.vendor.update({
        where: { userId },
        data: {
          profileImage: imageUrl,
        },
      });

      return successResponse(
        { updatedPicture },
        'Profile picture updated successfully.',
      );
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to update profile pics',
        error.message as string,
      );
    }
  }

  async getUserById(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      return successResponse(user, 'User fetched successfully.');
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to fetch user',
        error.message as string,
      );
    }
  }

  async getClientsByVendor(
    vendorId,
    page?: number,
    limit?: number,
    search?: string,
  ) {
    try {
      let where: any = {};
      if (vendorId) {
        where.clientVendorId = vendorId;
        where.role = UserRole.CLIENT;
      }

      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }

      const clients = await this.prisma.user.findMany({
        where,
        skip: page && limit ? (Number(page) - 1) * Number(limit) : undefined,
        take: limit ? Number(limit) : undefined,
        include: {
          bookings: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const total = await this.prisma.user.count({ where });

      return successResponse(
        { clients },
        'Successfully fetched clients.',
        200,
        {
          total,
          page,
          limit,
        },
      );
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to fetch user',
        error.message as string,
      );
    }
  }

  async getUserSubAccount(userId: string) {
    try {
      const subAccount = await this.prisma.subAccount.findFirst({
        where: { userId },
      });

      return successResponse(subAccount, 'Sub account fetched successfully.');
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to fetch user',
        error.message as string,
      );
    }
  }

  async createEnquiry(dto: {
    name: string;
    email: string;
    phone: string;
    message: string;
  }) {
    try {
      const enquiry = await this.prisma.enquiry.create({
        data: {
          ...dto,
        },
      });

      return successResponse(enquiry, 'Enquiry submitted successfully.', 201);
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to create enquiry.',
        error.message as string,
      );
    }
  }

  async getUserEmail(email: string) {
    try {
      const user = await this.prisma.user.findFirst({
        where: {
          email: email,
        },
      });

      return successResponse(user, 'User fetched successfully.');
    } catch (error: any) {
      throw new InternalServerErrorException(
        'Failed to create enquiry.',
        error.message as string,
      );
    }
  }

  async createNotification(userId: string, dto: UpdateNotificationDto) {
    try {
      const result = await this.prisma.notificationSettings.upsert({
        where: { userId: userId },
        update: {
          emailNotifications: dto.emailNotifications,
          pushNotifications: dto.pushNotifications,
          smsNotifications: dto.smsNotifications,
          bookingDigest: dto.bookingDigest,
        },
        create: {
          userId,
          emailNotifications: dto.emailNotifications,
          pushNotifications: dto.pushNotifications,
          smsNotifications: dto.smsNotifications,
          bookingDigest: dto.bookingDigest,
        },
      });
      return successResponse(
        result,
        'Notification setting successfully created.',
      );
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to update notification.',
        error as string,
      );
    }
  }

  async getNotificationPreference(userId: string) {
    try {
      const result = await this.prisma.notificationSettings.findUnique({
        where: {
          userId,
        },
      });
      return successResponse(result, 'Notification fetched successfully.');
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to update notification.',
        error as string,
      );
    }
  }
}
