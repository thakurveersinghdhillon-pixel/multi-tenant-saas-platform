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
import { ProjectsService } from "./projects.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { AddProjectMemberDto } from "./dto/add-project-member.dto";
import { UpdateProjectMemberDto } from "./dto/update-project-member.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../tenancy/tenant.guard";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../rbac/decorators/require-permissions.decorator";
import { PERMISSIONS } from "../rbac/constants/permissions";

@Controller("organizations/:organizationId/projects")
@UseGuards(JwtAuthGuard, TenantGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PROJECT_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.create(userId, organizationId, dto);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PROJECT_READ)
  @HttpCode(HttpStatus.OK)
  async findAll(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
  ) {
    return this.projectsService.findAllForOrganization(userId, organizationId);
  }

  @Get(":projectId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PROJECT_READ)
  @HttpCode(HttpStatus.OK)
  async findOne(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.projectsService.findOne(userId, organizationId, projectId);
  }

  @Patch(":projectId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PROJECT_UPDATE)
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(userId, organizationId, projectId, dto);
  }

  @Delete(":projectId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PROJECT_DELETE)
  @HttpCode(HttpStatus.OK)
  async remove(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.projectsService.remove(userId, organizationId, projectId);
  }

  @Get(":projectId/members")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PROJECT_READ)
  @HttpCode(HttpStatus.OK)
  async getMembers(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
  ) {
    return this.projectsService.getMembers(userId, organizationId, projectId);
  }

  @Post(":projectId/members")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PROJECT_UPDATE)
  @HttpCode(HttpStatus.CREATED)
  async addMember(
    @CurrentUser("id") requesterUserId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.projectsService.addMember(
      requesterUserId,
      organizationId,
      projectId,
      dto,
    );
  }

  @Patch(":projectId/members/:targetUserId/role")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PROJECT_UPDATE)
  @HttpCode(HttpStatus.OK)
  async updateMemberRole(
    @CurrentUser("id") requesterUserId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("targetUserId") targetUserId: string,
    @Body() dto: UpdateProjectMemberDto,
  ) {
    return this.projectsService.updateMemberRole(
      requesterUserId,
      organizationId,
      projectId,
      targetUserId,
      dto,
    );
  }

  @Delete(":projectId/members/:targetUserId")
  @UseGuards(PermissionsGuard)
  @RequirePermissions(PERMISSIONS.PROJECT_UPDATE)
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @CurrentUser("id") requesterUserId: string,
    @Param("organizationId") organizationId: string,
    @Param("projectId") projectId: string,
    @Param("targetUserId") targetUserId: string,
  ) {
    return this.projectsService.removeMember(
      requesterUserId,
      organizationId,
      projectId,
      targetUserId,
    );
  }
}
