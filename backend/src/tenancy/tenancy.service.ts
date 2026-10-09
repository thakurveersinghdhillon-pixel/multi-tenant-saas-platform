import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { isUUID } from "class-validator";

@Injectable()
export class TenancyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate user membership in an organization and return the full tenant context
   */
  async validateAndGetTenantContext(userId: string, organizationId: string) {
    if (!organizationId) {
      throw new BadRequestException(
        "Organization ID or X-Organization-Id header is required",
      );
    }

    if (!isUUID(organizationId)) {
      throw new BadRequestException(
        "Invalid Organization ID format; must be a valid UUID",
      );
    }

    // Query organization membership
    const membership = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      include: {
        organization: true,
        role: true,
      },
    });

    if (!membership) {
      // Check if organization exists in DB to differentiate 404 vs 403
      const orgExists = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      });

      if (!orgExists) {
        throw new NotFoundException("Organization not found");
      }

      // Organization exists, but user is not an active member -> 403 Forbidden
      throw new ForbiddenException(
        "You do not have permission to access this organization",
      );
    }

    return {
      organization: membership.organization,
      member: membership,
      role: membership.role,
      organizationId: membership.organizationId,
    };
  }
}
