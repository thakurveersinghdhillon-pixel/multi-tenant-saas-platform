import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { TenancyService } from "./tenancy.service";

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenancyService: TenancyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const user = request.user;
    if (!user || !user.id) {
      throw new UnauthorizedException(
        "User authentication required before tenant verification",
      );
    }

    // Read organizationId from route params or X-Organization-Id / X-Tenant-Id header
    const paramOrgId = request.params?.organizationId;
    const headerOrgId =
      (request.headers["x-tenant-id"] as string) ||
      (request.headers["X-Tenant-Id"] as string) ||
      (request.headers["x-organization-id"] as string) ||
      (request.headers["X-Organization-Id"] as string);

    if (paramOrgId && headerOrgId && paramOrgId !== headerOrgId) {
      throw new BadRequestException(
        "Mismatch between header tenant ID and URL organization ID",
      );
    }

    const organizationId = paramOrgId || headerOrgId;

    const tenantContext = await this.tenancyService.validateAndGetTenantContext(
      user.id,
      organizationId,
    );

    // Attach tenant context to request
    request.organization = tenantContext.organization;
    request.organizationMember = tenantContext.member;
    request.organizationId = tenantContext.organizationId;
    request.tenantRole = tenantContext.role;

    return true;
  }
}
