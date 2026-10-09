import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { ActivityService } from "../activity/activity.service";
import { ACTIVITY_EVENTS } from "../activity/constants/activity-events";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { AddProjectMemberDto } from "./dto/add-project-member.dto";
import { UpdateProjectMemberDto } from "./dto/update-project-member.dto";
import { ProjectRole } from "@prisma/client";
import { RedisService } from "../redis/redis.service";
import { CacheKeys } from "../redis/cache-keys";
import { CACHE_TTL } from "../redis/redis.constants";
import { WebSocketService } from "../websocket/websocket.service";
import { NotificationsService } from "../notifications/notifications.service";
import { NOTIFICATION_TYPES } from "../notifications/constants/notification-types";

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancyService: TenancyService,
    private readonly activityService: ActivityService,
    private readonly redisService: RedisService,
    private readonly webSocketService: WebSocketService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Create a new project inside an organization and auto-bind creator as PROJECT_ADMIN
   */
  async create(userId: string, organizationId: string, dto: CreateProjectDto) {
    // 1. Validate organization membership
    await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    const slug = dto.slug.toLowerCase();

    // 2. Check tenant-scoped slug uniqueness (organizationId + slug)
    const existingProject = await this.prisma.project.findUnique({
      where: {
        organizationId_slug: {
          organizationId,
          slug,
        },
      },
    });

    if (existingProject) {
      throw new ConflictException(
        "Project slug is already in use within this organization",
      );
    }

    // 3. Execute atomic creation transaction
    const project = await this.prisma.$transaction(async (tx) => {
      const newProject = await tx.project.create({
        data: {
          organizationId,
          name: dto.name,
          slug,
          description: dto.description,
          createdById: userId,
        },
      });

      // Auto-bind creator as PROJECT_ADMIN
      await tx.projectMember.create({
        data: {
          projectId: newProject.id,
          userId,
          role: ProjectRole.PROJECT_ADMIN,
        },
      });

      // Record Activity History
      await this.activityService.record(
        {
          organizationId,
          userId,
          projectId: newProject.id,
          action: ACTIVITY_EVENTS.PROJECT_CREATED,
          metadata: { name: newProject.name, slug: newProject.slug },
        },
        tx,
      );

      return newProject;
    });

    await this.redisService.invalidateByPrefix(
      CacheKeys.orgProjectsPrefix(organizationId),
    );

    this.webSocketService.emitProjectEvent(
      organizationId,
      project.id,
      "PROJECT_CREATED",
      { id: project.id, name: project.name, slug: project.slug },
      { id: userId, email: "" },
    );

    return {
      ...project,
      creatorRole: ProjectRole.PROJECT_ADMIN,
    };
  }

  /**
   * List all projects belonging to the active organization
   */
  async findAllForOrganization(userId: string, organizationId: string) {
    // Validate organization membership
    await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    const cacheKey = CacheKeys.projectList(organizationId);
    const cached = await this.redisService.get<any[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const projects = await this.prisma.project.findMany({
      where: { organizationId },
      include: {
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        _count: {
          select: { members: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = projects.map((p) => ({
      id: p.id,
      organizationId: p.organizationId,
      name: p.name,
      slug: p.slug,
      description: p.description,
      status: p.status,
      createdBy: p.createdBy,
      memberCount: p._count.members,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    await this.redisService.set(cacheKey, result, CACHE_TTL.PROJECT_LIST);

    return result;
  }

  /**
   * Get single project by ID (tenant-scoped)
   */
  async findOne(userId: string, organizationId: string, projectId: string) {
    // Validate organization membership
    await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    const cacheKey = CacheKeys.projectDetail(organizationId, projectId);
    const cached = await this.redisService.get<any>(cacheKey);
    if (cached) {
      return cached;
    }

    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        organizationId,
      },
      include: {
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException("Project not found in this organization");
    }

    const result = {
      id: project.id,
      organizationId: project.organizationId,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status,
      createdBy: project.createdBy,
      members: project.members.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
        joinedAt: m.createdAt,
      })),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };

    await this.redisService.set(cacheKey, result, CACHE_TTL.PROJECT_DETAIL);

    return result;
  }

  /**
   * Update project details (tenant-scoped)
   */
  async update(
    userId: string,
    organizationId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ) {
    // Validate organization membership
    await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    const existing = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!existing) {
      throw new NotFoundException("Project not found in this organization");
    }

    if (dto.slug) {
      const slug = dto.slug.toLowerCase();
      if (slug !== existing.slug) {
        const taken = await this.prisma.project.findUnique({
          where: {
            organizationId_slug: { organizationId, slug },
          },
        });

        if (taken) {
          throw new ConflictException(
            "Project slug is already in use within this organization",
          );
        }
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const proj = await tx.project.update({
        where: { id: projectId },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.slug && { slug: dto.slug.toLowerCase() }),
          ...(dto.description !== undefined && {
            description: dto.description,
          }),
          ...(dto.status && { status: dto.status }),
        },
      });

      await this.activityService.record(
        {
          organizationId,
          userId,
          projectId,
          action: ACTIVITY_EVENTS.PROJECT_UPDATED,
          metadata: {
            ...(dto.name && { name: dto.name }),
            ...(dto.slug && { slug: dto.slug }),
            ...(dto.status && { status: dto.status }),
          },
        },
        tx,
      );

      return proj;
    });

    await this.redisService.del(
      CacheKeys.projectDetail(organizationId, projectId),
    );
    await this.redisService.invalidateByPrefix(
      CacheKeys.orgProjectsPrefix(organizationId),
    );

    this.webSocketService.emitProjectEvent(
      organizationId,
      projectId,
      "PROJECT_UPDATED",
      {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        status: updated.status,
      },
      { id: userId, email: "" },
    );

    return updated;
  }

  /**
   * Delete project (tenant-scoped)
   */
  async remove(userId: string, organizationId: string, projectId: string) {
    // Validate organization membership
    await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    const existing = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!existing) {
      throw new NotFoundException("Project not found in this organization");
    }

    await this.prisma.$transaction(async (tx) => {
      await this.activityService.record(
        {
          organizationId,
          userId,
          projectId,
          action: ACTIVITY_EVENTS.PROJECT_DELETED,
          metadata: { name: existing.name },
        },
        tx,
      );

      await tx.projectMember.deleteMany({
        where: { projectId },
      });
      await tx.project.delete({
        where: { id: projectId },
      });
    });

    await this.redisService.invalidateByPrefix(
      CacheKeys.projectPrefix(organizationId, projectId),
    );
    await this.redisService.invalidateByPrefix(
      CacheKeys.orgProjectsPrefix(organizationId),
    );

    this.webSocketService.emitProjectEvent(
      organizationId,
      projectId,
      "PROJECT_DELETED",
      { id: projectId, name: existing.name },
      { id: userId, email: "" },
    );

    return {
      message: "Project successfully deleted",
      projectId,
    };
  }

  /**
   * List members of a project
   */
  async getMembers(userId: string, organizationId: string, projectId: string) {
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

    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  /**
   * Add a member to a project
   */
  async addMember(
    requesterUserId: string,
    organizationId: string,
    projectId: string,
    dto: AddProjectMemberDto,
  ) {
    // 1. Validate tenant membership
    await this.tenancyService.validateAndGetTenantContext(
      requesterUserId,
      organizationId,
    );

    // 2. Verify project exists in active organization
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!project) {
      throw new NotFoundException("Project not found in this organization");
    }

    // 3. Find target user by email
    const targetUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!targetUser) {
      throw new NotFoundException(`User with email ${dto.email} not found`);
    }

    // 4. CRITICAL: Target user MUST be an OrganizationMember of this organization
    const isOrgMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUser.id,
        },
      },
    });

    if (!isOrgMember) {
      throw new ForbiddenException(
        "Target user must be a member of the organization before joining a project",
      );
    }

    // 5. Check if user is already a project member
    const existingProjectMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUser.id,
        },
      },
    });

    if (existingProjectMember) {
      throw new ConflictException("User is already a member of this project");
    }

    const targetRole = dto.role || ProjectRole.PROJECT_MEMBER;
    const validRoles = [
      ProjectRole.PROJECT_ADMIN,
      ProjectRole.PROJECT_MEMBER,
      ProjectRole.PROJECT_VIEWER,
    ];

    if (!validRoles.includes(targetRole)) {
      throw new BadRequestException(
        `Invalid role: ${dto.role}. Must be PROJECT_ADMIN, PROJECT_MEMBER, or PROJECT_VIEWER`,
      );
    }

    // 6. Execute atomic creation in transaction
    const newMember = await this.prisma.$transaction(async (tx) => {
      const pMember = await tx.projectMember.create({
        data: {
          projectId,
          userId: targetUser.id,
          role: targetRole,
        },
        include: { user: true },
      });

      await this.activityService.record(
        {
          organizationId,
          userId: requesterUserId,
          projectId,
          action: ACTIVITY_EVENTS.PROJECT_MEMBER_ADDED,
          metadata: {
            targetUserId: targetUser.id,
            email: targetUser.email,
            role: targetRole,
          },
        },
        tx,
      );

      await this.notificationsService.createNotification(
        {
          organizationId,
          userId: targetUser.id,
          actorId: requesterUserId,
          projectId,
          type: NOTIFICATION_TYPES.PROJECT_MEMBER_ADDED,
          title: "Added to Project",
          message: `You were added to project "${project.name}"`,
        },
        tx,
      );

      return pMember;
    });

    await this.redisService.del(
      CacheKeys.projectDetail(organizationId, projectId),
    );
    await this.redisService.invalidateByPrefix(
      CacheKeys.orgProjectsPrefix(organizationId),
    );

    return {
      userId: newMember.user.id,
      email: newMember.user.email,
      firstName: newMember.user.firstName,
      lastName: newMember.user.lastName,
      avatarUrl: newMember.user.avatarUrl,
      role: newMember.role,
      joinedAt: newMember.createdAt,
    };
  }

  /**
   * Update role of a project member
   */
  async updateMemberRole(
    requesterUserId: string,
    organizationId: string,
    projectId: string,
    targetUserId: string,
    dto: UpdateProjectMemberDto,
  ) {
    await this.tenancyService.validateAndGetTenantContext(
      requesterUserId,
      organizationId,
    );

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!project) {
      throw new NotFoundException("Project not found in this organization");
    }

    const targetMembership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
      include: { user: true },
    });

    if (!targetMembership) {
      throw new NotFoundException(
        "Target user is not a member of this project",
      );
    }

    // Sole PROJECT_ADMIN Protection
    if (
      targetMembership.role === ProjectRole.PROJECT_ADMIN &&
      dto.role !== ProjectRole.PROJECT_ADMIN
    ) {
      const adminCount = await this.prisma.projectMember.count({
        where: {
          projectId,
          role: ProjectRole.PROJECT_ADMIN,
        },
      });

      if (adminCount <= 1) {
        throw new ForbiddenException(
          "Cannot demote the sole Project Admin of a project",
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const pMember = await tx.projectMember.update({
        where: { id: targetMembership.id },
        data: { role: dto.role },
        include: { user: true },
      });

      await this.activityService.record(
        {
          organizationId,
          userId: requesterUserId,
          projectId,
          action: ACTIVITY_EVENTS.PROJECT_MEMBER_ROLE_CHANGED,
          metadata: {
            targetUserId,
            oldRole: targetMembership.role,
            newRole: dto.role,
          },
        },
        tx,
      );

      await this.notificationsService.createNotification(
        {
          organizationId,
          userId: targetUserId,
          actorId: requesterUserId,
          projectId,
          type: NOTIFICATION_TYPES.PROJECT_MEMBER_ROLE_CHANGED,
          title: "Project Role Updated",
          message: `Your role in project "${project.name}" was updated to ${dto.role}`,
        },
        tx,
      );

      return pMember;
    });

    await this.redisService.del(
      CacheKeys.projectDetail(organizationId, projectId),
    );

    return {
      userId: updated.user.id,
      email: updated.user.email,
      firstName: updated.user.firstName,
      lastName: updated.user.lastName,
      role: updated.role,
      updatedAt: updated.createdAt,
    };
  }

  /**
   * Remove a member from a project
   */
  async removeMember(
    requesterUserId: string,
    organizationId: string,
    projectId: string,
    targetUserId: string,
  ) {
    await this.tenancyService.validateAndGetTenantContext(
      requesterUserId,
      organizationId,
    );

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!project) {
      throw new NotFoundException("Project not found in this organization");
    }

    const targetMembership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: targetUserId,
        },
      },
    });

    if (!targetMembership) {
      throw new NotFoundException(
        "Target user is not a member of this project",
      );
    }

    // Sole PROJECT_ADMIN Protection
    if (targetMembership.role === ProjectRole.PROJECT_ADMIN) {
      const adminCount = await this.prisma.projectMember.count({
        where: {
          projectId,
          role: ProjectRole.PROJECT_ADMIN,
        },
      });

      if (adminCount <= 1) {
        throw new ForbiddenException(
          "Cannot remove the sole Project Admin of a project",
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.projectMember.delete({
        where: { id: targetMembership.id },
      });

      await this.activityService.record(
        {
          organizationId,
          userId: requesterUserId,
          projectId,
          action: ACTIVITY_EVENTS.PROJECT_MEMBER_REMOVED,
          metadata: { targetUserId },
        },
        tx,
      );
      await this.notificationsService.createNotification(
        {
          organizationId,
          userId: targetUserId,
          actorId: requesterUserId,
          projectId,
          type: NOTIFICATION_TYPES.PROJECT_MEMBER_REMOVED,
          title: "Removed from Project",
          message: `You were removed from project "${project.name}"`,
        },
        tx,
      );
    });

    await this.redisService.del(
      CacheKeys.projectDetail(organizationId, projectId),
    );
    await this.redisService.invalidateByPrefix(
      CacheKeys.orgProjectsPrefix(organizationId),
    );

    return {
      message: "Project member successfully removed",
      projectId,
      userId: targetUserId,
    };
  }
}
