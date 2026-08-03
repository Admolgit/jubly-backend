/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationCategory,
  NotificationType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { CloudinaryService } from 'src/infrastructure/cloudinary.service';
import { successResponse } from 'src/utils/response';
import { UpdateNotificationDto } from './dto/notification.dto';
import { ActivityService } from 'src/activity/activityLog.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private cloudinaryService: CloudinaryService,
    private activityService: ActivityService,
  ) {}

  private sanitizeUser<T extends Record<string, any> | null | undefined>(
    user: T,
  ) {
    if (!user) return user;
    const {
      password,
      refreshTokenHash,
      verificationCode,
      codeExpiresAt,
      ...safeUser
    } = user;
    return safeUser;
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return successResponse({ user: this.sanitizeUser(user) }, 'successful');
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
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to initialize payment',
        error.message as string,
      );
    }
  }

  async updateUserProfile(userId: string, dto: any) {
    try {
      const existingUser = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          firstName: dto.firstName || existingUser.firstName,
          lastName: dto.lastName || existingUser.lastName,
          phone: dto.phone || existingUser.phone,
          email: dto.email || existingUser.email,
        },
      });

      await this.activityService.createLog({
        vendorId: vendor ? vendor.id : undefined,
        userId: userId,
        action: 'PROFILE_UPDATED',
        description: 'Business information was updated.',
        actor: vendor
          ? vendor.businessName
          : `${existingUser.firstName} ${existingUser.lastName}`,
        actorType: existingUser?.role === UserRole.VENDOR ? 'VENDOR' : 'CLIENT',
        color: 'indigo',
      });

      return successResponse(
        this.sanitizeUser(updatedUser),
        'Profile updated successfully.',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to initialize payment',
        error.message as string,
      );
    }
  }

  async updateProfilePicture(
    userId: string,
    file: Express.Multer.File | undefined,
  ) {
    try {
      if (!file) {
        throw new BadRequestException('Profile image is required');
      }

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
      if (error instanceof HttpException) {
        throw error;
      }

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

      return successResponse(
        this.sanitizeUser(user),
        'User fetched successfully.',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch user',
        error.message as string,
      );
    }
  }

  async getClientsByVendor(
    userId: string,
    vendorId: string,
    page?: number,
    limit?: number,
    search?: string,
  ) {
    try {
      const vendor = await this.prisma.vendor.findUnique({
        where: { userId },
      });

      if (!vendor || vendor.id !== vendorId) {
        throw new ForbiddenException(
          'You are not allowed to view these clients',
        );
      }

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
        // count the total booking for each client too
        include: {
          _count: {
            select: {
              bookings: true,
            },
          },
        },
      });

      const total = await this.prisma.user.count({ where });

      return successResponse(
        { clients: clients.map((client) => this.sanitizeUser(client)) },
        'Successfully fetched clients.',
        200,
        {
          total,
          page,
          limit,
        },
      );
    } catch (error: any) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

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
      if (error instanceof HttpException) {
        throw error;
      }

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
      if (error instanceof HttpException) {
        throw error;
      }

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

      return successResponse(
        this.sanitizeUser(user),
        'User fetched successfully.',
      );
    } catch (error: any) {
      if (error instanceof HttpException) {
        throw error;
      }

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
      if (error instanceof HttpException) {
        throw error;
      }

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
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to update notification.',
        error as string,
      );
    }
  }

  async createAndSend(
    userId: string,
    payload: {
      title: string;
      message: string;
    },
  ) {
    const settings = await this.prisma.notificationSettings.findFirst({
      where: {
        userId,
      },
    });

    if (!settings) {
      throw new NotFoundException('Settings not found for this user');
    }

    if (settings.emailNotifications) {
      const notification = await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.INFO,
          isRead: false,
          category: NotificationCategory.PAYMENT,
          message: payload.message,
          title: payload.title,
        },
      });

      return successResponse(notification, 'Notifications created', 201);
    } else {
      throw new BadRequestException(
        'Email notification is false, please set to true',
      );
    }
  }

  async getAllUserNotifications(
    userId: string,
    query: { page: number; limit: number },
  ) {
    try {
      let { page, limit } = query;

      page = Number(page) || 1;
      limit = Number(limit) || 10;

      const skip = (Number(page) - 1) * limit;

      const [result, allResults, unreadCount, total] =
        await this.prisma.$transaction([
          this.prisma.notification.findMany({
            where: {
              userId,
              isRead: false,
            },
            orderBy: {
              createdAt: 'desc',
            },
            skip,
            take: Number(limit),
          }),

          this.prisma.notification.findMany({
            where: {
              userId,
            },
            orderBy: {
              createdAt: 'desc',
            },
            skip,
            take: Number(limit),
          }),

          this.prisma.notification.count({
            where: {
              userId,
              isRead: false,
            },
          }),

          this.prisma.notification.count({
            where: {
              userId,
            },
          }),
        ]);

      return successResponse(
        {
          result,
          allResults,
          count: unreadCount,
          total,
        },
        'Notifications fetched.',
        200,
        {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to update notification.',
        error as string,
      );
    }
  }

  async getUnread(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId, isRead: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(userId: string, notificationId: string) {
    return this.prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId,
      },
      data: { isRead: true },
    });
  }
}
