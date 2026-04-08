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
    } catch (error) {
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
    } catch (error) {
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

      return successResponse({ user }, 'User fetched successfully.');
    } catch (error) {
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
    } catch (error) {
      throw new InternalServerErrorException(
        'Failed to fetch user',
        error.message as string,
      );
    }
  }
}
