/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async createLog(data: {
    userId?: string;
    vendorId?: string;
    action: string;
    description: string;
    actor: string;
    actorType: 'SYSTEM' | 'CLIENT' | 'VENDOR' | 'ADMIN';
    metadata?: any;
    color?: string;
  }) {
    const activity = await this.prisma.activityLog.create({
      data: {
        userId: data.userId || undefined,
        vendorId: data.vendorId || undefined,
        action: data.action,
        description: data.description,
        actor: data.actor,
        actorType: data.actorType,
        metadata: data.metadata,
        color: data.color,
      },
    });

    return successResponse(activity, 'Activity log created successfully', 201);
  }

  async getLogsByUserId(userId: string, page?: number, limit?: number) {
    try {
      const where = { userId };

      const logs = await this.prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page && limit ? (Number(page) - 1) * Number(limit) : undefined,
        take: limit ? Number(limit) : undefined,
      });

      const total = await this.prisma.activityLog.count({ where });

      return successResponse(
        logs,
        'Activity logs retrieved successfully',
        200,
        {
          total,
          page,
          limit,
        },
      );
    } catch (err: any) {
      console.error('Error retrieving activity logs:', err);
      throw new InternalServerErrorException(
        'Failed to retrieve activity logs',
        err,
      );
    }
  }
}
