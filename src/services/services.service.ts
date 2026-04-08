/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}

  async getAllServices(
    userId: string,
    page: number,
    limit: number,
    search?: string,
  ) {
    try {
      const isActive =
        search === 'true' ? true : search === 'false' ? false : undefined;

      const services = await this.prisma.service.findMany({
        where: {
          userId,
          ...(isActive !== undefined && {
            active: isActive,
          }),
        },
        include: {
          _count: {
            select: {
              booking: true,
            },
          },
        },
        skip: (page - 1) * limit,
        take: Number(limit),
      });

      const totalCount = await this.prisma.service.count({
        where: {
          userId,
          ...(isActive !== undefined && {
            active: isActive,
          }),
        },
      });

      return successResponse(services, 'Services fetched successfully.', 200, {
        totalCount,
        page,
        limit,
      });
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        'Failed to fetch services',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  async updateServiceStatus(serviceId: string, userId: string, active: string) {
    try {
      const isActive = active === 'true';

      const service = await this.prisma.service.update({
        where: {
          id: serviceId,
          userId,
        },
        data: {
          active: isActive,
        },
      });
    } catch (error: unknown) {
      throw new InternalServerErrorException(
        'Failed to fetch services',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }
}
