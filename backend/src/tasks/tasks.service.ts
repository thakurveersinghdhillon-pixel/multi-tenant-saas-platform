import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { ActivityService } from "../activity/activity.service";
import { ACTIVITY_EVENTS } from "../activity/constants/activity-events";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { UpdateTaskStatusDto } from "./dto/update-task-status.dto";
import { AssignTaskDto } from "./dto/assign-task.dto";
import { ReorderTaskDto } from "./dto/reorder-task.dto";
import { ProjectRole, TaskPriority, TaskStatus } from "@prisma/client";
import { RedisService } from "../redis/redis.service";
import { CacheKeys } from "../redis/cache-keys";
import { CACHE_TTL } from "../redis/redis.constants";
import { WebSocketService } from "../websocket/websocket.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NOTIFICATION_TYPES } from "../notifications/constants/notification-types";

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancyService: TenancyService,
    private readonly activityService: ActivityService,
    private readonly redisService: RedisService,
    private readonly webSocketService: WebSocketService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Validate that the active organization owns the project and check caller project permissions
   */
  private async validateProjectAccess(
    userId: string,
    organizationId: string,
    projectId: string,
    requireMutationPermission = false,
  ) {
    // 1. Verify tenant membership
    await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    // 2. Verify project exists in active organization
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId,
      },
    });

    if (!project) {
      throw new NotFoundException("Project not found in this organization");
    }

    // 3. Lookup caller's project membership
    const projectMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!projectMember) {
      throw new ForbiddenException(
        "You must be a member of this project to view or modify tasks",
      );
    }

    if (
      requireMutationPermission &&
      projectMember.role === ProjectRole.PROJECT_VIEWER
    ) {
      throw new ForbiddenException("Project Viewers cannot modify tasks");
    }

    return { project, projectMember };
  }

  /**
   * Validate target assignee belongs to both the active organization AND the active project
   */
  private async validateAssignee(
    organizationId: string,
    projectId: string,
    assigneeId: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: assigneeId },
    });

    if (!user) {
      throw new NotFoundException("Assignee user not found");
    }

    // Must be Organization Member
    const isOrgMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: assigneeId,
        },
      },
    });

    if (!isOrgMember) {
      throw new ForbiddenException(
        "Assignee must be a member of this organization",
      );
    }

    // Must be Project Member
    const isProjMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: assigneeId,
        },
      },
    });

    if (!isProjMember) {
      throw new ForbiddenException("Assignee must be a member of this project");
    }
  }

  /**
   * Private helper to invalidate all task, board, detail, and activity caches under a project
   */
  private async invalidateTaskCaches(
    organizationId: string,
    projectId: string,
    taskId?: string,
  ) {
    try {
      if (taskId) {
        await this.redisService.del(
          CacheKeys.taskDetail(organizationId, projectId, taskId),
        );
      }
      await this.redisService.invalidateByPrefix(
        CacheKeys.projectPrefix(organizationId, projectId),
      );
    } catch {
      // Gracefully catch any Redis invalidation errors so main DB operations succeed
    }
  }

  /**
   * Create a new task inside a project
   */
  async create(
    userId: string,
    organizationId: string,
    projectId: string,
    dto: CreateTaskDto,
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, true);

    if (dto.assigneeId) {
      await this.validateAssignee(organizationId, projectId, dto.assigneeId);
    }

    const targetStatus = dto.status || TaskStatus.TODO;

    // Calculate initial position server-side
    const maxTask = await this.prisma.task.findFirst({
      where: { projectId, status: targetStatus },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const nextPosition = maxTask ? maxTask.position + 1000 : 1000;

    const task = await this.prisma.$transaction(async (tx) => {
      const newTask = await tx.task.create({
        data: {
          projectId,
          title: dto.title,
          description: dto.description,
          status: targetStatus,
          priority: dto.priority || TaskPriority.MEDIUM,
          position: nextPosition,
          createdById: userId,
          assignedToId: dto.assigneeId || null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        },
        include: {
          createdBy: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          assignedTo: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
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
          taskId: newTask.id,
          action: ACTIVITY_EVENTS.TASK_CREATED,
          metadata: {
            title: newTask.title,
            status: newTask.status,
            priority: newTask.priority,
            assigneeId: newTask.assignedToId,
          },
        },
        tx,
      );

      if (newTask.assignedToId && newTask.assignedToId !== userId) {
        await this.notificationsService.createNotification(
          {
            organizationId,
            userId: newTask.assignedToId,
            actorId: userId,
            projectId,
            taskId: newTask.id,
            type: NOTIFICATION_TYPES.TASK_ASSIGNED,
            title: "Task Assigned",
            message: `You have been assigned to task "${newTask.title}"`,
          },
          tx,
        );
      }

      return newTask;
    });

    await this.invalidateTaskCaches(organizationId, projectId, task.id);

    this.webSocketService.emitTaskEvent(
      organizationId,
      projectId,
      task.id,
      "TASK_CREATED",
      task,
      { id: userId, email: "" },
    );

    return task;
  }

  /**
   * List tasks for a project with optional filtering by status, priority, and assignee
   */
  async findAll(
    userId: string,
    organizationId: string,
    projectId: string,
    filters: {
      status?: TaskStatus;
      priority?: TaskPriority;
      assigneeId?: string;
    },
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, false);

    const cacheKey = CacheKeys.taskList(organizationId, projectId, filters);
    const cached = await this.redisService.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        projectId,
        ...(filters.status && { status: filters.status }),
        ...(filters.priority && { priority: filters.priority }),
        ...(filters.assigneeId && { assignedToId: filters.assigneeId }),
      },
      include: {
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        assignedTo: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: [{ status: "asc" }, { position: "asc" }],
    });

    await this.redisService.set(cacheKey, tasks, CACHE_TTL.TASK_LIST);

    return tasks;
  }

  /**
   * Get Kanban board structure with tasks grouped by column status
   */
  async getBoard(userId: string, organizationId: string, projectId: string) {
    await this.validateProjectAccess(userId, organizationId, projectId, false);

    const cacheKey = CacheKeys.taskBoard(organizationId, projectId);
    const cached =
      await this.redisService.get<Record<TaskStatus, any[]>>(cacheKey);
    if (cached) {
      return cached;
    }

    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      include: {
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        assignedTo: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { position: "asc" },
    });

    const board: Record<TaskStatus, any[]> = {
      [TaskStatus.TODO]: [],
      [TaskStatus.IN_PROGRESS]: [],
      [TaskStatus.IN_REVIEW]: [],
      [TaskStatus.DONE]: [],
    };

    for (const task of tasks) {
      if (board[task.status]) {
        board[task.status].push(task);
      }
    }

    await this.redisService.set(cacheKey, board, CACHE_TTL.TASK_BOARD);

    return board;
  }

  /**
   * Get single task details by ID
   */
  async findOne(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, false);

    const cacheKey = CacheKeys.taskDetail(organizationId, projectId, taskId);
    const cached = await this.redisService.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        projectId,
      },
      include: {
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        assignedTo: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException("Task not found in this project");
    }

    await this.redisService.set(cacheKey, task, CACHE_TTL.TASK_DETAIL);

    return task;
  }

  /**
   * Update task properties
   */
  async update(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, true);

    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
    });

    if (!existing) {
      throw new NotFoundException("Task not found in this project");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id: taskId },
        data: {
          ...(dto.title && { title: dto.title }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.status && { status: dto.status }),
          ...(dto.priority && { priority: dto.priority }),
          ...(dto.dueDate !== undefined && {
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          }),
        },
        include: {
          createdBy: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          assignedTo: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
            },
          },
        },
      });

      if (dto.status && dto.status !== existing.status) {
        await this.activityService.record(
          {
            organizationId,
            userId,
            projectId,
            taskId,
            action: ACTIVITY_EVENTS.TASK_STATUS_CHANGED,
            metadata: { oldStatus: existing.status, newStatus: dto.status },
          },
          tx,
        );
      } else if (dto.priority && dto.priority !== existing.priority) {
        await this.activityService.record(
          {
            organizationId,
            userId,
            projectId,
            taskId,
            action: ACTIVITY_EVENTS.TASK_PRIORITY_CHANGED,
            metadata: {
              oldPriority: existing.priority,
              newPriority: dto.priority,
            },
          },
          tx,
        );
      } else {
        await this.activityService.record(
          {
            organizationId,
            userId,
            projectId,
            taskId,
            action: ACTIVITY_EVENTS.TASK_UPDATED,
            metadata: { title: task.title },
          },
          tx,
        );
      }

      return task;
    });

    await this.invalidateTaskCaches(organizationId, projectId, taskId);

    const eventType = dto.status
      ? "TASK_STATUS_CHANGED"
      : dto.priority
        ? "TASK_PRIORITY_CHANGED"
        : "TASK_UPDATED";

    this.webSocketService.emitTaskEvent(
      organizationId,
      projectId,
      taskId,
      eventType,
      updated,
      { id: userId, email: "" },
    );

    return updated;
  }

  /**
   * Update task status (e.g. column transition)
   */
  async updateStatus(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
    dto: UpdateTaskStatusDto,
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, true);

    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
    });

    if (!existing) {
      throw new NotFoundException("Task not found in this project");
    }

    let nextPosition = existing.position;

    if (existing.status !== dto.status) {
      const maxTask = await this.prisma.task.findFirst({
        where: { projectId, status: dto.status },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      nextPosition = maxTask ? maxTask.position + 1000 : 1000;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id: taskId },
        data: {
          status: dto.status,
          position: nextPosition,
        },
        include: {
          createdBy: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          assignedTo: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
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
          action: ACTIVITY_EVENTS.TASK_STATUS_CHANGED,
          metadata: { oldStatus: existing.status, newStatus: dto.status },
        },
        tx,
      );

      if (
        existing.status !== dto.status &&
        task.assignedToId &&
        task.assignedToId !== userId
      ) {
        await this.notificationsService.createNotification(
          {
            organizationId,
            userId: task.assignedToId,
            actorId: userId,
            projectId,
            taskId,
            type: NOTIFICATION_TYPES.TASK_STATUS_CHANGED,
            title: "Task Status Updated",
            message: `Task "${task.title}" status changed to ${dto.status}`,
          },
          tx,
        );
      }

      return task;
    });

    await this.invalidateTaskCaches(organizationId, projectId, taskId);

    this.webSocketService.emitTaskEvent(
      organizationId,
      projectId,
      taskId,
      "TASK_STATUS_CHANGED",
      updated,
      { id: userId, email: "" },
    );

    return updated;
  }

  /**
   * Assign task to a valid project member or unassign (null)
   */
  async assignTask(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
    dto: AssignTaskDto,
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, true);

    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
    });

    if (!existing) {
      throw new NotFoundException("Task not found in this project");
    }

    if (dto.assigneeId) {
      await this.validateAssignee(organizationId, projectId, dto.assigneeId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id: taskId },
        data: {
          assignedToId: dto.assigneeId || null,
        },
        include: {
          createdBy: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          assignedTo: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              avatarUrl: true,
            },
          },
        },
      });

      const action = dto.assigneeId
        ? ACTIVITY_EVENTS.TASK_ASSIGNED
        : ACTIVITY_EVENTS.TASK_UNASSIGNED;

      await this.activityService.record(
        {
          organizationId,
          userId,
          projectId,
          taskId,
          action,
          metadata: {
            oldAssigneeId: existing.assignedToId,
            newAssigneeId: dto.assigneeId || null,
          },
        },
        tx,
      );

      // Handle Notification creation for assignee changes
      const oldAssigneeId = existing.assignedToId;
      const newAssigneeId = dto.assigneeId || null;

      if (oldAssigneeId !== newAssigneeId) {
        // 1. Notify previous assignee if unassigned/reassigned (and actor is not previous assignee)
        if (oldAssigneeId && oldAssigneeId !== userId) {
          await this.notificationsService.createNotification(
            {
              organizationId,
              userId: oldAssigneeId,
              actorId: userId,
              projectId,
              taskId,
              type: NOTIFICATION_TYPES.TASK_UNASSIGNED,
              title: "Task Unassigned",
              message: `You were unassigned from task "${task.title}"`,
            },
            tx,
          );
        }

        // 2. Notify new assignee (and actor is not new assignee)
        if (newAssigneeId && newAssigneeId !== userId) {
          await this.notificationsService.createNotification(
            {
              organizationId,
              userId: newAssigneeId,
              actorId: userId,
              projectId,
              taskId,
              type: NOTIFICATION_TYPES.TASK_ASSIGNED,
              title: "Task Assigned",
              message: `You have been assigned to task "${task.title}"`,
            },
            tx,
          );
        }
      }

      return task;
    });

    await this.invalidateTaskCaches(organizationId, projectId, taskId);

    const eventType = dto.assigneeId ? "TASK_ASSIGNED" : "TASK_UNASSIGNED";
    this.webSocketService.emitTaskEvent(
      organizationId,
      projectId,
      taskId,
      eventType,
      updated,
      { id: userId, email: "" },
    );

    return updated;
  }

  /**
   * Reorder task within Kanban column
   */
  async reorderTask(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
    dto: ReorderTaskDto,
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, true);

    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
    });

    if (!existing) {
      throw new NotFoundException("Task not found in this project");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id: taskId },
        data: {
          ...(dto.status && { status: dto.status }),
          position: dto.position,
        },
        include: {
          createdBy: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          assignedTo: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
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
          action: ACTIVITY_EVENTS.TASK_REORDERED,
          metadata: {
            oldPosition: existing.position,
            newPosition: dto.position,
            status: task.status,
          },
        },
        tx,
      );

      return task;
    });

    await this.invalidateTaskCaches(organizationId, projectId, taskId);

    this.webSocketService.emitTaskEvent(
      organizationId,
      projectId,
      taskId,
      "TASK_REORDERED",
      updated,
      { id: userId, email: "" },
    );

    return updated;
  }

  /**
   * Delete task
   */
  async remove(
    userId: string,
    organizationId: string,
    projectId: string,
    taskId: string,
  ) {
    await this.validateProjectAccess(userId, organizationId, projectId, true);

    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, projectId },
    });

    if (!existing) {
      throw new NotFoundException("Task not found in this project");
    }

    await this.prisma.$transaction(async (tx) => {
      await this.activityService.record(
        {
          organizationId,
          userId,
          projectId,
          taskId,
          action: ACTIVITY_EVENTS.TASK_DELETED,
          metadata: { title: existing.title },
        },
        tx,
      );

      await tx.task.delete({
        where: { id: taskId },
      });
    });

    await this.invalidateTaskCaches(organizationId, projectId, taskId);

    this.webSocketService.emitTaskEvent(
      organizationId,
      projectId,
      taskId,
      "TASK_DELETED",
      { id: taskId, title: existing.title },
      { id: userId, email: "" },
    );

    return {
      message: "Task successfully deleted",
      taskId,
      projectId,
    };
  }
}
