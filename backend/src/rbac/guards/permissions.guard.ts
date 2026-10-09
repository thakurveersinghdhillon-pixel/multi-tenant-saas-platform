import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";
import { RbacService } from "../rbac.service";
import { isUUID } from "class-validator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If endpoint has no @RequirePermissions decorator, pass through
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // 1. Ensure user authentication
    const user = request.user;
    if (!user || !user.id) {
      throw new UnauthorizedException("Authentication required");
    }

    // 2. Resolve target organization ID from request params, header, or tenant context
    const organizationId =
      request.organizationId ||
      request.params?.organizationId ||
      (request.headers["x-organization-id"] as string) ||
      (request.headers["X-Organization-Id"] as string);

    if (!organizationId) {
      throw new BadRequestException(
        "Organization context required for permission verification",
      );
    }

    if (!isUUID(organizationId)) {
      throw new BadRequestException("Invalid organization ID format");
    }

    // 3. Evaluate permissions in database using RbacService
    const hasPermission = await this.rbacService.hasPermissions(
      user.id,
      organizationId,
      requiredPermissions,
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `Insufficient permissions. Required: ${requiredPermissions.join(", ")}`,
      );
    }

    return true;
  }
}
