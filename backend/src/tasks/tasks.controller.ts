import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { UpdateTaskStatusDto } from "./dto/update-task-status.dto";
import { AssignTaskDto } from "./dto/assign-task.dto";
import { ReorderTaskDto } from "./dto/reorder-task.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../tenancy/tenant.guard";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../rbac/decorators/require-permissions.decorator";
import { PERMISSIONS } from "../rbac/constants/permissions";
import { TaskPriority, TaskStatus } from "@prisma/client";

@Controller("organizations/:organizationId/projects/:projectId/tasks")
@UseGuards(JwtAuthGuard, TenantGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TASK_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksService.create(userId, organizationId, projectId, dto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TASK_READ)
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Query("status") status?: TaskStatus,
    @Query("priority") priority?: TaskPriority,
    @Query("assigneeId") assigneeId?: string,
  ) {
    return this.tasksService.findAll(userId, organizationId, projectId, {
      status,
      priority,
      assigneeId,
    });
  }

  @Get("board")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TASK_READ)
  @HttpCode(HttpStatus.OK)
  async getBoard(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.tasksService.getBoard(userId, organizationId, projectId);
  }

  @Get(":taskId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TASK_READ)
  @HttpCode(HttpStatus.OK)
  async findOne(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
  ) {
    return this.tasksService.findOne(userId, organizationId, projectId, taskId);
  }

  @Patch(":taskId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TASK_UPDATE)
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(
      userId,
      organizationId,
      projectId,
      taskId,
      dto,
    );
  }

  @Patch(":taskId/status")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TASK_UPDATE)
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.tasksService.updateStatus(
      userId,
      organizationId,
      projectId,
      taskId,
      dto,
    );
  }

  @Patch(":taskId/assignee")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TASK_UPDATE)
  @HttpCode(HttpStatus.OK)
  async assignTask(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
    @Body() dto: AssignTaskDto,
  ) {
    return this.tasksService.assignTask(
      userId,
      organizationId,
      projectId,
      taskId,
      dto,
    );
  }

  @Patch(":taskId/reorder")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TASK_UPDATE)
  @HttpCode(HttpStatus.OK)
  async reorderTask(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
    @Body() dto: ReorderTaskDto,
  ) {
    return this.tasksService.reorderTask(
      userId,
      organizationId,
      projectId,
      taskId,
      dto,
    );
  }

  @Delete(":taskId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TASK_DELETE)
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
  ) {
    return this.tasksService.remove(userId, organizationId, projectId, taskId);
  }
}
