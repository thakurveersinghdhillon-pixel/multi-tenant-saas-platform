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
import { OrganizationsService } from "./organizations.service";
import { RbacService } from "../rbac/rbac.service";
import { CreateOrganizationDto } from "./dto/create-organization.dto";
import { UpdateOrganizationDto } from "./dto/update-organization.dto";
import { UpdateMemberRoleDto } from "./dto/update-member-role.dto";
import { AddMemberDto } from "./dto/add-member.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../tenancy/tenant.guard";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { CurrentOrganization } from "../tenancy/decorators/current-organization.decorator";
import { RequirePermissions } from "../rbac/decorators/require-permissions.decorator";
import { PERMISSIONS } from "../rbac/constants/permissions";

@Controller("organizations")
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly rbacService: RbacService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser("id") userId: string,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(userId, dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async findAllForUser(@CurrentUser("id") userId: string) {
    return this.organizationsService.findAllForUser(userId);
  }

  @Get("current")
  @UseGuards(TenantGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.ORGANIZATION_READ)
  @HttpCode(HttpStatus.OK)
  async getCurrent(
    @CurrentUser("id") userId: string,
    @CurrentOrganization("id") organizationId: string,
  ) {
    return this.organizationsService.getCurrent(userId, organizationId);
  }

  @Get(":organizationId")
  @UseGuards(TenantGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.ORGANIZATION_READ)
  @HttpCode(HttpStatus.OK)
  async findOne(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.findOneForMember(userId, organizationId);
  }

  @Patch(":organizationId")
  @UseGuards(TenantGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.ORGANIZATION_UPDATE)
  @HttpCode(HttpStatus.OK)
  async update(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(userId, organizationId, dto);
  }

  @Get(":organizationId/members")
  @UseGuards(TenantGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.MEMBER_READ)
  @HttpCode(HttpStatus.OK)
  async getMembers(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.getMembers(userId, organizationId);
  }

  @Post(":organizationId/members")
  @UseGuards(TenantGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.MEMBER_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async addMember(
    @CurrentUser("id") requesterUserId: string,
    @Param("organizationId") organizationId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.organizationsService.addMember(
      requesterUserId,
      organizationId,
      dto,
    );
  }

  @Patch(":organizationId/members/:targetUserId/role")
  @UseGuards(TenantGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.MEMBER_UPDATE)
  @HttpCode(HttpStatus.OK)
  async updateMemberRole(
    @CurrentUser("id") requesterUserId: string,
    @Param("organizationId") organizationId: string,
    @Param("targetUserId") targetUserId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.rbacService.updateMemberRole(
      requesterUserId,
      organizationId,
      targetUserId,
      dto.role,
    );
  }

  @Delete(":organizationId/members/:targetUserId")
  @UseGuards(TenantGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.MEMBER_DELETE)
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @CurrentUser("id") requesterUserId: string,
    @Param("organizationId") organizationId: string,
    @Param("targetUserId") targetUserId: string,
  ) {
    return this.organizationsService.removeMember(
      requesterUserId,
      organizationId,
      targetUserId,
    );
  }

  @Post(":organizationId/leave")
  @UseGuards(TenantGuard)
  @HttpCode(HttpStatus.OK)
  async leave(
    @CurrentUser("id") userId: string,
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.leaveOrganization(userId, organizationId);
  }
}
