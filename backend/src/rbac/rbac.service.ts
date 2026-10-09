import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

export type SystemRoleName = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Evaluates if a user has all required permissions within the target organization
   */
  async hasPermissions(
    userId: string,
    organizationId: string,
    requiredPermissions: string[],
  ): Promise<boolean> {
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    // 1. Fetch user membership in organization
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      select: {
        roleId: true,
      },
    });

    if (!membership) {
      return false;
    }

    // 2. Fetch all permissions mapped to the user's role
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { roleId: membership.roleId },
      include: {
        permission: true,
      },
    });

    const grantedPermissionNames = new Set(
      rolePermissions.map((rp) => rp.permission.name),
    );

    // 3. Verify that ALL required permissions exist in granted permissions
    return requiredPermissions.every((perm) =>
      grantedPermissionNames.has(perm),
    );
  }

  /**
   * Update a member's role enforcing hierarchy and owner protection rules
   */
  async updateMemberRole(
    requesterUserId: string,
    organizationId: string,
    targetUserId: string,
    newRoleName: string,
  ) {
    const validRoles: SystemRoleName[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
    const targetRoleUpper = newRoleName.toUpperCase() as SystemRoleName;

    if (!validRoles.includes(targetRoleUpper)) {
      throw new BadRequestException(
        `Invalid role: ${newRoleName}. Must be one of OWNER, ADMIN, MEMBER, VIEWER`,
      );
    }

    // 1. Requester membership & permission check
    const requesterMembership = await this.prisma.organizationMember.findUnique(
      {
        where: {
          organizationId_userId: { organizationId, userId: requesterUserId },
        },
        include: { role: true },
      },
    );

    if (!requesterMembership) {
      throw new ForbiddenException("You are not a member of this organization");
    }

    const hasUpdatePerm = await this.hasPermissions(
      requesterUserId,
      organizationId,
      ["member:update"],
    );
    if (!hasUpdatePerm) {
      throw new ForbiddenException(
        "You do not have permission to update member roles",
      );
    }

    const requesterRole = requesterMembership.role.name as SystemRoleName;

    // 2. Target member lookup
    const targetMembership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId, userId: targetUserId },
      },
      include: { role: true },
    });

    if (!targetMembership) {
      throw new NotFoundException(
        "Target user is not a member of this organization",
      );
    }

    const targetCurrentRole = targetMembership.role.name as SystemRoleName;

    // 3. Hierarchy Rules Enforcement
    // Rule: ADMIN cannot modify an OWNER or demote/promote an OWNER
    if (requesterRole === "ADMIN") {
      if (targetCurrentRole === "OWNER") {
        throw new ForbiddenException(
          "Admins cannot modify the role of an Owner",
        );
      }
      if (targetRoleUpper === "OWNER") {
        throw new ForbiddenException("Admins cannot promote a user to Owner");
      }
    }

    // Rule: MEMBER or VIEWER cannot update roles (already caught by hasUpdatePerm, but enforcing explicitly)
    if (requesterRole === "MEMBER" || requesterRole === "VIEWER") {
      throw new ForbiddenException("Members and Viewers cannot update roles");
    }

    // 4. Sole Owner Protection
    // If the sole owner attempts to demote themselves, reject request
    if (targetCurrentRole === "OWNER" && targetRoleUpper !== "OWNER") {
      const ownerCount = await this.prisma.organizationMember.count({
        where: {
          organizationId,
          role: { name: "OWNER" },
        },
      });

      if (ownerCount <= 1) {
        throw new ForbiddenException(
          "Cannot demote the sole Owner of an organization. Transfer ownership first.",
        );
      }
    }

    // 5. Lookup new target Role ID
    let newRole = await this.prisma.role.findFirst({
      where: { name: targetRoleUpper, organizationId: null },
    });

    if (!newRole) {
      newRole = await this.prisma.role.create({
        data: {
          name: targetRoleUpper,
          description: `System default ${targetRoleUpper} role`,
          organizationId: null,
        },
      });
    }

    // 6. Update role
    const updatedMembership = await this.prisma.organizationMember.update({
      where: { id: targetMembership.id },
      data: { roleId: newRole.id },
      include: {
        user: true,
        role: true,
      },
    });

    return {
      userId: updatedMembership.user.id,
      email: updatedMembership.user.email,
      firstName: updatedMembership.user.firstName,
      lastName: updatedMembership.user.lastName,
      role: updatedMembership.role.name,
      updatedAt: updatedMembership.updatedAt,
    };
  }
}
