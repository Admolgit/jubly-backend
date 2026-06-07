/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { successResponse } from 'src/utils/response';

@Injectable()
export class ActivityService {
  constructor(private prisma: PrismaService) {}

  async createLog(data: {
    userId?: string;
    vendorId?: string;
    action: string;
    description: string;
    actor: string;
    actorType: 'SYSTEM' | 'CLIENT' | 'VENDOR' | 'ADMIN';
    metadata?: any;
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
      },
    });

    return successResponse(activity, 'Activity log created successfully', 201);
  }

  async getLogsByUserId(userId: string) {
    try {
      const logs = await this.prisma.activityLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      return successResponse(logs, 'Activity logs retrieved successfully');
    } catch (err: any) {
      console.error('Error retrieving activity logs:', err);
      throw new InternalServerErrorException(
        'Failed to retrieve activity logs',
        err,
      );
    }
  }
}
