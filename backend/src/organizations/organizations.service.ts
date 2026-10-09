import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { CreateOrganizationDto } from "./dto/create-organization.dto";
import { UpdateOrganizationDto } from "./dto/update-organization.dto";
import { AddMemberDto } from "./dto/add-member.dto";
import { RoleEnum } from "./dto/update-member-role.dto";

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancyService: TenancyService,
  ) {}

  /**
   * Create a new Organization and automatically bind creator as OWNER using a transaction
   */
  async create(userId: string, dto: CreateOrganizationDto) {
    const slug = dto.slug.toLowerCase();

    // Check slug uniqueness
    const existingOrg = await this.prisma.organization.findUnique({
      where: { slug },
    });

    if (existingOrg) {
      throw new ConflictException("Organization slug is already in use");
    }

    // Ensure system OWNER role exists
    let ownerRole = await this.prisma.role.findFirst({
      where: { name: "OWNER", organizationId: null },
    });

    if (!ownerRole) {
      ownerRole = await this.prisma.role.create({
        data: {
          name: "OWNER",
          description: "System default OWNER role",
          organizationId: null,
        },
      });
    }

    // Execute atomic creation transaction
    const organization = await this.prisma.$transaction(async (tx) => {
      const newOrg = await tx.organization.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,
        },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: newOrg.id,
          userId,
          roleId: ownerRole.id,
        },
      });

      return newOrg;
    });

    return {
      ...organization,
      role: "OWNER",
    };
  }

  /**
   * List all organizations where the authenticated user is a member
   */
  async findAllForUser(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: {
        organization: true,
        role: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      description: m.organization.description,
      role: m.role.name,
      createdAt: m.organization.createdAt,
      updatedAt: m.organization.updatedAt,
    }));
  }

  /**
   * Get single organization by ID (enforces member access)
   */
  async findOneForMember(userId: string, organizationId: string) {
    const tenantContext = await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    return {
      ...tenantContext.organization,
      role: tenantContext.role.name,
    };
  }

  /**
   * Update organization details (enforces member access)
   */
  async update(
    userId: string,
    organizationId: string,
    dto: UpdateOrganizationDto,
  ) {
    // Validate user membership first
    await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    if (dto.slug) {
      const slug = dto.slug.toLowerCase();
      const existing = await this.prisma.organization.findUnique({
        where: { slug },
      });

      if (existing && existing.id !== organizationId) {
        throw new ConflictException("Organization slug is already in use");
      }
    }

    const updated = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.slug && { slug: dto.slug.toLowerCase() }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    return updated;
  }

  /**
   * List all members of an organization (enforces member access)
   */
  async getMembers(userId: string, organizationId: string) {
    // Validate requester's membership
    await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: {
        user: true,
        role: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return members.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      avatarUrl: m.user.avatarUrl,
      role: m.role.name,
      joinedAt: m.createdAt,
    }));
  }

  /**
   * Get current organization from X-Organization-Id context
   */
  async getCurrent(userId: string, organizationId: string) {
    const tenantContext = await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );

    return {
      organization: tenantContext.organization,
      role: tenantContext.role.name,
      memberSince: tenantContext.member.createdAt,
    };
  }

  /**
   * Add an existing user to the organization by email
   */
  async addMember(
    requesterUserId: string,
    organizationId: string,
    dto: AddMemberDto,
  ) {
    // 1. Validate requester tenant context
    const tenantContext = await this.tenancyService.validateAndGetTenantContext(
      requesterUserId,
      organizationId,
    );

    const requesterRole = tenantContext.role.name;
    const targetRoleName = (dto.role || RoleEnum.MEMBER).toUpperCase();

    // Validate target role enum
    const validRoles = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
    if (!validRoles.includes(targetRoleName)) {
      throw new BadRequestException(
        `Invalid role: ${dto.role}. Must be one of OWNER, ADMIN, MEMBER, VIEWER`,
      );
    }

    // 2. Enforce Hierarchy Rules: ADMIN cannot add someone directly as OWNER
    if (requesterRole === "ADMIN" && targetRoleName === "OWNER") {
      throw new ForbiddenException(
        "Admins cannot add or promote users to Owner",
      );
    }

    // 3. Find target user by email
    const targetUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!targetUser) {
      throw new NotFoundException(`User with email ${dto.email} not found`);
    }

    // 4. Check if user is already a member
    const existingMembership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUser.id,
        },
      },
    });

    if (existingMembership) {
      throw new ConflictException(
        "User is already a member of this organization",
      );
    }

    // 5. Lookup target role record
    let roleRecord = await this.prisma.role.findFirst({
      where: { name: targetRoleName, organizationId: null },
    });

    if (!roleRecord) {
      roleRecord = await this.prisma.role.create({
        data: {
          name: targetRoleName,
          description: `System default ${targetRoleName} role`,
          organizationId: null,
        },
      });
    }

    // 6. Execute member creation transaction
    const newMember = await this.prisma.$transaction(async (tx) => {
      return tx.organizationMember.create({
        data: {
          organizationId,
          userId: targetUser.id,
          roleId: roleRecord.id,
        },
        include: {
          user: true,
          role: true,
        },
      });
    });

    return {
      userId: newMember.user.id,
      email: newMember.user.email,
      firstName: newMember.user.firstName,
      lastName: newMember.user.lastName,
      avatarUrl: newMember.user.avatarUrl,
      role: newMember.role.name,
      joinedAt: newMember.createdAt,
    };
  }

  /**
   * Remove a member from the organization
   */
  async removeMember(
    requesterUserId: string,
    organizationId: string,
    targetUserId: string,
  ) {
    // 1. Validate requester tenant context
    const tenantContext = await this.tenancyService.validateAndGetTenantContext(
      requesterUserId,
      organizationId,
    );
    const requesterRole = tenantContext.role.name;

    // 2. Fetch target user's membership
    const targetMembership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
      include: {
        role: true,
        user: true,
      },
    });

    if (!targetMembership) {
      throw new NotFoundException(
        "Target user is not a member of this organization",
      );
    }

    const targetRole = targetMembership.role.name;

    // 3. Hierarchy Rules Enforcement: ADMIN restrictions
    if (requesterRole === "ADMIN") {
      if (targetRole === "OWNER") {
        throw new ForbiddenException("Admins cannot remove an Owner");
      }
      if (targetRole === "ADMIN") {
        throw new ForbiddenException("Admins cannot remove another Admin");
      }
    }

    // 4. Sole Owner Safety Rule: Cannot remove sole owner
    if (targetRole === "OWNER") {
      const ownerCount = await this.prisma.organizationMember.count({
        where: {
          organizationId,
          role: { name: "OWNER" },
        },
      });

      if (ownerCount <= 1) {
        throw new ForbiddenException(
          "Cannot remove the sole Owner of an organization. Transfer ownership first.",
        );
      }
    }

    // 5. Execute deletion in transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMember.delete({
        where: { id: targetMembership.id },
      });
    });

    return {
      message: "Member successfully removed from organization",
      userId: targetUserId,
      organizationId,
    };
  }

  /**
   * Allow an authenticated user to leave an organization
   */
  async leaveOrganization(userId: string, organizationId: string) {
    // 1. Validate membership in organization
    const tenantContext = await this.tenancyService.validateAndGetTenantContext(
      userId,
      organizationId,
    );
    const userRole = tenantContext.role.name;

    // 2. Sole Owner Safety Rule: Sole owner cannot leave
    if (userRole === "OWNER") {
      const ownerCount = await this.prisma.organizationMember.count({
        where: {
          organizationId,
          role: { name: "OWNER" },
        },
      });

      if (ownerCount <= 1) {
        throw new ForbiddenException(
          "The sole Owner cannot leave the organization. Transfer ownership or delete the organization first.",
        );
      }
    }

    // 3. Execute leave deletion in transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMember.delete({
        where: {
          organizationId_userId: {
            organizationId,
            userId,
          },
        },
      });
    });

    return {
      message: "Successfully left the organization",
      organizationId,
    };
  }
}
