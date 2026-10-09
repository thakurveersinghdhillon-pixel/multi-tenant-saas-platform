import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { ActivityService } from "../activity/activity.service";
import { ACTIVITY_EVENTS } from "../activity/constants/activity-events";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { UpdateCommentDto } from "./dto/update-comment.dto";
import { ProjectRole } from "@prisma/client";
import { RedisService } from "../redis/redis.service";
import { CacheKeys } from "../redis/cache-keys";
import { WebSocketService } from "../websocket/websocket.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NOTIFICATION_TYPES } from "../notifications/constants/notification-types";

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancyService: TenancyService,
    private readonly activityService: ActivityService,
    private readonly redisService: RedisService,
    private readonly webSocketService: WebSocketService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Create a new task comment
   */
  async create(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
    dto: CreateCommentDto,
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, true);

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
    });
    if (!task) {
      throw new NotFoundException("Task not found in this project");
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          taskId,
          userId,
          content: dto.content,
        },
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
      });

      await this.activityService.record(
        {
          organizationId,
          userId,
          projectId,
          taskId,
          action: ACTIVITY_EVENTS.COMMENT_CREATED,
          metadata: {
            commentId: created.id,
            contentSnippet: dto.content.slice(0, 100),
          },
        },
        tx,
      );

      if (task.assignedToId && task.assignedToId !== userId) {
        await this.notificationsService.createNotification(
          {
            organizationId,
            userId: task.assignedToId,
            actorId: userId,
            projectId,
            taskId,
            type: NOTIFICATION_TYPES.TASK_COMMENTED,
            title: "New Comment on Task",
            message: `A new comment was posted on task "${task.title}"`,
            metadata: { commentId: created.id },
          },
          tx,
        );
      }

      return created;
    });

    await this.invalidateProjectCaches(organizationId, projectId);

    const response = this.formatCommentResponse(comment);

    this.webSocketService.emitCommentEvent(
      organizationId,
      projectId,
      taskId,
      comment.id,
      "COMMENT_CREATED",
      response,
      { id: userId, email: "" },
    );

    return response;
  }

  /**
   * Private helper to invalidate project caches upon comment mutation
   */
  private async invalidateProjectCaches(
    organizationId: string,
    projectId: string,
  ) {
    try {
      await this.redisService.invalidateByPrefix(
        CacheKeys.projectPrefix(organizationId, projectId),
      );
    } catch {
      // Graceful fallback
    }
  }

  /**
   * List active task comments in chronological order
   */
  async findAll(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, false);

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
    });
    if (!task) {
      throw new NotFoundException("Task not found in this project");
    }

    const comments = await this.prisma.comment.findMany({
      where: {
        taskId,
        deletedAt: null,
      },
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
      orderBy: { createdAt: "asc" },
    });

    return comments.map(this.formatCommentResponse);
  }

  /**
   * Update own comment
   */
  async update(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
    commentId: string,
    dto: UpdateCommentDto,
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, true);

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
    });
    if (!task) {
      throw new NotFoundException("Task not found in this project");
    }

    const existing = await this.prisma.comment.findFirst({
      where: { id: commentId, taskId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException("Comment not found in this task");
    }

    // Ownership check: Only comment author can edit comment
    if (existing.userId !== userId) {
      throw new ForbiddenException("You can only edit your own comments");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const comment = await tx.comment.update({
        where: { id: commentId },
        data: { content: dto.content },
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
      });

      await this.activityService.record(
        {
          organizationId,
          userId,
          projectId,
          taskId,
          action: ACTIVITY_EVENTS.COMMENT_UPDATED,
          metadata: { commentId },
        },
        tx,
      );

      return comment;
    });

    await this.invalidateProjectCaches(organizationId, projectId);

    const response = this.formatCommentResponse(updated);

    this.webSocketService.emitCommentEvent(
      organizationId,
      projectId,
      taskId,
      commentId,
      "COMMENT_UPDATED",
      response,
      { id: userId, email: "" },
    );

    return response;
  }

  /**
   * Delete comment (Author OR Project Admin / Org Admin moderation)
   */
  async remove(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
    commentId: string,
  ) {
    const { tenantContext, projectMember } = await this.validateProjectAccess(
      userId,
      organizationId,
      projectId,
      true,
    );

    const task = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
    });
    if (!task) {
      throw new NotFoundException("Task not found in this project");
    }

    const existing = await this.prisma.comment.findFirst({
      where: { id: commentId, taskId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException("Comment not found in this task");
    }

    // Ownership / Moderation check: Author OR Project Admin OR Org Owner/Admin
    const isAuthor = existing.userId === userId;
    const isProjectAdmin = projectMember.role === ProjectRole.PROJECT_ADMIN;
    const isOrgAdminOrOwner =
      tenantContext.role.name === "OWNER" ||
      tenantContext.role.name === "ADMIN";

    if (!isAuthor && !isProjectAdmin && !isOrgAdminOrOwner) {
      throw new ForbiddenException(
        "You do not have permission to delete this comment",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Soft deletion strategy
      await tx.comment.update({
        where: { id: commentId },
        data: { deletedAt: new Date() },
      });

      await this.activityService.record(
        {
          organizationId,
          userId,
          projectId,
          taskId,
          action: ACTIVITY_EVENTS.COMMENT_DELETED,
          metadata: {
            commentId,
            deletedBy: userId,
            isModeration: !isAuthor,
          },
        },
        tx,
      );
    });

    await this.invalidateProjectCaches(organizationId, projectId);

    this.webSocketService.emitCommentEvent(
      organizationId,
      projectId,
      taskId,
      commentId,
      "COMMENT_DELETED",
      { id: commentId, taskId },
      { id: userId, email: "" },
    );

    return {
      message: "Comment successfully deleted",
      commentId,
      taskId,
    };
  }

  /**
   * Helper to validate user project membership and project-level role permissions
   */
  private async validateProjectAccess(
    userId: string,
    organizationId: string,
    projectId: string,
    requireMutationPermission = false,
  ) {
    const tenantContext = await this.tenancyService.validateAndGetTenantContext(
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
        "You must be a member of this project to view or modify comments",
      );
    }

    if (
      requireMutationPermission &&
      projectMember.role === ProjectRole.PROJECT_VIEWER
    ) {
      throw new ForbiddenException("Project Viewers cannot modify comments");
    }

    return { tenantContext, project, projectMember };
  }

  /**
   * Safe comment response formatting
   */
  private formatCommentResponse(comment: any) {
    return {
      id: comment.id,
      taskId: comment.taskId,
      content: comment.content,
      author: comment.user
        ? {
            id: comment.user.id,
            firstName: comment.user.firstName,
            lastName: comment.user.lastName,
            email: comment.user.email,
            avatarUrl: comment.user.avatarUrl,
          }
        : null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
    };
  }
}
