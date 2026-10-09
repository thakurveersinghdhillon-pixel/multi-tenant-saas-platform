import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { RedisService } from "../redis/redis.service";
import { WebSocketService } from "../websocket/websocket.service";
import { CreateNotificationDto } from "./dto/create-notification.dto";
import { QueryNotificationsDto } from "./dto/query-notifications.dto";
import { Prisma } from "@prisma/client";

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly webSocketService: WebSocketService,
  ) {}

  /**
   * Cache key generator for user unread notification count
   */
  private unreadCountCacheKey(organizationId: string, userId: string): string {
    return `v1:tenant:${organizationId}:user:${userId}:notifications:unread-count`;
  }

  /**
   * Create a new persistent notification in PostgreSQL and trigger post-commit WebSocket delivery
   */
  async createNotification(
    dto: CreateNotificationDto,
    prismaTx?: Prisma.TransactionClient,
  ) {
    // Avoid self-notification
    if (dto.actorId && dto.actorId === dto.userId) {
      this.logger.debug(
        `Skipping self-notification for user ${dto.userId} (actorId matches recipientId)`,
      );
      return null;
    }

    const prismaClient = prismaTx || this.prisma;

    const notification = await prismaClient.notification.create({
      data: {
        organizationId: dto.organizationId,
        userId: dto.userId,
        actorId: dto.actorId || null,
        projectId: dto.projectId || null,
        taskId: dto.taskId || null,
        type: dto.type,
        title: dto.title,
        message: dto.message,
        metadata: dto.metadata || Prisma.JsonNull,
      },
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        task: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    // Invalidate unread count cache
    await this.redisService.del(
      this.unreadCountCacheKey(dto.organizationId, dto.userId),
    );

    // Emit real-time WebSocket notification to recipient's personal user room
    const actorInfo = notification.actor
      ? { id: notification.actor.id, email: notification.actor.email }
      : undefined;

    this.webSocketService.emitNotificationEvent(
      dto.organizationId,
      dto.userId,
      {
        id: notification.id,
        organizationId: notification.organizationId,
        userId: notification.userId,
        actorId: notification.actorId,
        projectId: notification.projectId,
        taskId: notification.taskId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        isRead: notification.isRead,
        createdAt: notification.createdAt,
        actor: notification.actor,
        project: notification.project,
        task: notification.task,
        metadata: notification.metadata,
      },
      actorInfo,
    );

    return notification;
  }

  /**
   * Paginated retrieval of notifications belonging ONLY to the authenticated user and active tenant
   */
  async findAllForUser(
    userId: string,
    organizationId: string,
    query: QueryNotificationsDto,
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = {
      userId,
      organizationId,
      ...(query.unread === true && { isRead: false }),
    };

    const [notifications, total, unreadCountRes] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          actor: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      }),
      this.prisma.notification.count({ where }),
      this.getUnreadCount(userId, organizationId),
    ]);

    return {
      data: notifications,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        unreadCount: unreadCountRes.count,
      },
    };
  }

  /**
   * Get unread notification count for user in tenant organization with Redis caching
   */
  async getUnreadCount(
    userId: string,
    organizationId: string,
  ): Promise<{ count: number }> {
    const cacheKey = this.unreadCountCacheKey(organizationId, userId);
    const cached = await this.redisService.get<{ count: number }>(cacheKey);

    if (cached && typeof cached.count === "number") {
      return cached;
    }

    const count = await this.prisma.notification.count({
      where: {
        userId,
        organizationId,
        isRead: false,
      },
    });

    const result = { count };
    await this.redisService.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Retrieve a single notification by ID ensuring user and tenant ownership
   */
  async findOne(
    userId: string,
    organizationId: string,
    notificationId: string,
  ) {
    const notification = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        userId,
        organizationId,
      },
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        task: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!notification) {
      throw new NotFoundException("Notification not found");
    }

    return notification;
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(
    userId: string,
    organizationId: string,
    notificationId: string,
  ) {
    const notification = await this.findOne(
      userId,
      organizationId,
      notificationId,
    );

    if (!notification.isRead) {
      const updated = await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          isRead: true,
          readAt: new Date(),
        },
        include: {
          actor: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
            },
          },
          project: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      await this.redisService.del(
        this.unreadCountCacheKey(organizationId, userId),
      );
      return updated;
    }

    return notification;
  }

  /**
   * Mark all unread notifications as read for current user in active tenant
   */
  async markAllAsRead(userId: string, organizationId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        organizationId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    await this.redisService.del(
      this.unreadCountCacheKey(organizationId, userId),
    );

    return {
      message: "All notifications marked as read",
      count: result.count,
    };
  }
}
