import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  log(input: {
    entityType: string;
    entityId: string;
    action: string;
    message: string;
    userId?: string;
    metadataJson?: unknown;
  }) {
    return this.prisma.activityLog.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        message: input.message,
        userId: input.userId,
        metadataJson: input.metadataJson as object | undefined
      }
    });
  }
}
