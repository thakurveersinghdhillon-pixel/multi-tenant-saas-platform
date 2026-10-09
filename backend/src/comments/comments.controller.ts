import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { CommentsService } from "./comments.service";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { UpdateCommentDto } from "./dto/update-comment.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../tenancy/tenant.guard";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../rbac/decorators/require-permissions.decorator";
import { PERMISSIONS } from "../rbac/constants/permissions";

@Controller(
  "organizations/:organizationId/projects/:projectId/tasks/:taskId/comments",
)
@UseGuards(JwtAuthGuard, TenantGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMMENT_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(
      userId,
      organizationId,
      projectId,
      taskId,
      dto,
    );
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMMENT_READ)
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
  ) {
    return this.commentsService.findAll(
      userId,
      organizationId,
      projectId,
      taskId,
    );
  }

  @Patch(":commentId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMMENT_UPDATE)
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
    @Param("commentId") commentId: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.commentsService.update(
      userId,
      organizationId,
      projectId,
      taskId,
      commentId,
      dto,
    );
  }

  @Delete(":commentId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.COMMENT_DELETE)
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("taskId") taskId: string,
    @Param("commentId") commentId: string,
  ) {
    return this.commentsService.remove(
      userId,
      organizationId,
      projectId,
      taskId,
      commentId,
    );
  }
}
