/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllServices(
    userId: string,
    page: number,
    limit: number,
    search?: string,
    isActive?: string,
  ) {
    try {
      const currentPage = Math.max(1, Number(page));
      const pageSize = Math.max(1, Number(limit));

      const filters: any = {
        userId,
      };

      if (search?.trim()) {
        filters.name = {
          contains: search.trim(),
          mode: 'insensitive',
        };
      }

      if (isActive !== 'ALL') {
        filters.active = isActive === 'ACTIVE' ? true : false;
      }

      const [services, totalCount, all, active, inactive] = await Promise.all([
        this.prisma.service.findMany({
          where: filters,
          include: {
            _count: {
              select: {
                booking: true,
              },
            },
          },
          skip: (currentPage - 1) * pageSize,
          take: pageSize,
        }),

        this.prisma.service.count({
          where: filters,
        }),

        this.prisma.service.count({
          where: {
            userId,
          },
        }),
        this.prisma.service.count({
          where: {
            userId,
            active: true,
          },
        }),
        this.prisma.service.count({
          where: {
            userId,
            active: false,
          },
        }),
      ]);

      return successResponse(services, 'Services fetched successfully.', 200, {
        totalCount,
        page: currentPage,
        limit: pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
        all,
        active,
        inactive,
      });
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch services',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  async updateServiceActive(serviceId: string, userId: string, active: string) {
    try {
      const isActive = active === 'true';

      await this.prisma.service.update({
        where: {
          id: serviceId,
          userId,
        },
        data: {
          active: isActive,
        },
      });

      return successResponse(null, 'Service status updated successfully.');
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to update service status',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  async getServiceById(userId: string, serviceId: string) {
    try {
      const service = await this.prisma.service.findFirst({
        where: {
          id: serviceId,
          userId,
        },
      });
      return successResponse(service, 'Service fetched successfully.');
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to fetch service',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }
}
