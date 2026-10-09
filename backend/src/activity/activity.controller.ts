import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ActivityService } from "./activity.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../tenancy/tenant.guard";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../rbac/decorators/require-permissions.decorator";
import { PERMISSIONS } from "../rbac/constants/permissions";

@Controller("organizations/:organizationId/projects/:projectId")
@UseGuards(JwtAuthGuard, TenantGuard)
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get("activity")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PROJECT_READ)
  @HttpCode(HttpStatus.OK)
  async findByProject(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
    @Query("eventType") eventType?: string,
    @Query("actorId") actorId?: string,
    @Query("taskId") taskId?: string,
  ) {
    return this.activityService.findByProject(
      userId,
      organizationId,
      projectId,
      {
        page,
        limit,
        eventType,
        actorId,
        taskId,
      },
    );
  }

  @Get("tasks/:taskId/activity")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.TASK_READ)
  @HttpCode(HttpStatus.OK)
  async findByTask(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
    @Query("eventType") eventType?: string,
    @Query("actorId") actorId?: string,
  ) {
    return this.activityService.findByTask(
      userId,
      organizationId,
      projectId,
      taskId,
      {
        page,
        limit,
        eventType,
        actorId,
      },
    );
  }
}
