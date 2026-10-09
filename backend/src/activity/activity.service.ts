import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { RedisService } from "../redis/redis.service";
import { CacheKeys } from "../redis/cache-keys";
import { CACHE_TTL } from "../redis/redis.constants";
import { WebSocketService } from "../websocket/websocket.service";
import { Prisma } from "@prisma/client";

export interface RecordActivityInput {
  organizationId: string;
  userId?: string;
  projectId?: string;
  taskId?: string;
  action: string;
  metadata?: Record<string, any>;
}

export interface ActivityQueryOptions {
  page?: number;
  limit?: number;
  eventType?: string;
  actorId?: string;
  taskId?: string;
}

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancyService: TenancyService,
    private readonly redisService: RedisService,
    private readonly webSocketService: WebSocketService,
  ) {}

  /**
   * Record activity log entry (supports passing optional Prisma transaction client)
   * Automatically invalidates project/task activity caches upon creation
   */
  async record(
    input: RecordActivityInput,
    tx?: Prisma.TransactionClient | PrismaService,
  ) {
    const client = tx || this.prisma;
    const log = await client.activityLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId || null,
        projectId: input.projectId || null,
        taskId: input.taskId || null,
        action: input.action,
        metadata: input.metadata
          ? (input.metadata as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    // Invalidate activity caches and emit WebSocket activity event for this project/tenant (only when not inside active DB transaction)
    if (input.projectId && !tx) {
      try {
        await this.redisService.invalidateByPrefix(
          CacheKeys.projectPrefix(input.organizationId, input.projectId),
        );
        this.webSocketService.emitActivityEvent(
          input.organizationId,
          input.projectId,
          input.taskId || undefined,
          input.action,
          {
            id: log.id,
            action: log.action,
            metadata: log.metadata,
            createdAt: log.createdAt,
          },
          input.userId ? { id: input.userId, email: "" } : undefined,
        );
      } catch {
        // Fail-safe catch so recording activity never throws on Redis/WebSocket error
      }
    }

    return log;
  }

  /**
   * Retrieve project activity history with cache-aside pattern, filtering, and pagination
   */
  async findByProject(
    userId: string,
    organizationId: string,
    projectId: string,
    query: ActivityQueryOptions = {},
  ) {
    // 1. Verify tenant & project access
    await this.validateProjectAccess(userId, organizationId, projectId);

    // 2. Check Redis Cache
    const cacheKey = CacheKeys.projectActivity(
      organizationId,
      projectId,
      query,
    );
    const cached = await this.redisService.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    // 3. Parse pagination parameters (default 50, max 100)
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const skip = (page - 1) * limit;

    // 4. Build query filter
    const where: Prisma.ActivityLogWhereInput = {
      organizationId,
      projectId,
      ...(query.eventType && { action: query.eventType }),
      ...(query.actorId && { userId: query.actorId }),
      ...(query.taskId && { taskId: query.taskId }),
    };

    // 5. Query PostgreSQL
    const [total, logs] = await Promise.all([
      this.prisma.activityLog.count({ where }),
      this.prisma.activityLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    const result = {
      data: logs.map(this.formatActivityLogResponse),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    // 6. Cache result in Redis
    await this.redisService.set(cacheKey, result, CACHE_TTL.ACTIVITY);

    return result;
  }

  /**
   * Retrieve task activity history with cache-aside pattern, filtering, and pagination
   */
  async findByTask(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
    query: ActivityQueryOptions = {},
  ) {
    // 1. Verify tenant & project access
    await this.validateProjectAccess(userId, organizationId, projectId);

    // 2. Check Redis Cache
    const cacheKey = CacheKeys.taskActivity(
      organizationId,
      projectId,
      taskId,
      query,
    );
    const cached = await this.redisService.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    // 3. Verify task belongs to project
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
    });
    if (!task) {
      throw new NotFoundException("Task not found in this project");
    }

    // 4. Parse pagination parameters
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const skip = (page - 1) * limit;

    // 5. Build query filter
    const where: Prisma.ActivityLogWhereInput = {
      organizationId,
      projectId,
      taskId,
      ...(query.eventType && { action: query.eventType }),
      ...(query.actorId && { userId: query.actorId }),
    };

    const [total, logs] = await Promise.all([
      this.prisma.activityLog.count({ where }),
      this.prisma.activityLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    const result = {
      data: logs.map(this.formatActivityLogResponse),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };

    // 6. Cache result in Redis
    await this.redisService.set(cacheKey, result, CACHE_TTL.ACTIVITY);

    return result;
  }

  /**
   * Helper to validate user membership in organization and project
   */
  private async validateProjectAccess(
    userId: string,
    organizationId: string,
    projectId: string,
  ) {
    await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });
    if (!project) {
      throw new NotFoundException("Project not found in this organization");
    }

    const projectMember = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });

    if (!projectMember) {
      throw new ForbiddenException(
        "You must be a member of this project to view activity history",
      );
    }

    return { project, projectMember };
  }

  /**
   * Format activity log entry ensuring no sensitive data is exposed
   */
  private formatActivityLogResponse(log: any) {
    return {
      id: log.id,
      organizationId: log.organizationId,
      projectId: log.projectId,
      taskId: log.taskId,
      action: log.action,
      metadata: log.metadata || {},
      actor: log.user
        ? {
            id: log.user.id,
            firstName: log.user.firstName,
            lastName: log.user.lastName,
            email: log.user.email,
            avatarUrl: log.user.avatarUrl,
          }
        : null,
      createdAt: log.createdAt,
    };
  }
}
