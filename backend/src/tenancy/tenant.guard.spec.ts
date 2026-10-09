import { Test, TestingModule } from "@nestjs/testing";
import {
  UnauthorizedException,
  BadRequestException,
  ExecutionContext,
} from "@nestjs/common";
import { TenantGuard } from "./tenant.guard";
import { TenancyService } from "./tenancy.service";

describe("TenantGuard (Unit)", () => {
  let guard: TenantGuard;
  let tenancyService: jest.Mocked<TenancyService>;

  beforeEach(async () => {
    const mockTenancyService = {
      validateAndGetTenantContext: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantGuard,
        { provide: TenancyService, useValue: mockTenancyService },
      ],
    }).compile();

    guard = module.get<TenantGuard>(TenantGuard);
    tenancyService = module.get(TenancyService);
  });

  const createMockContext = (requestData: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => requestData,
      }),
    } as unknown as ExecutionContext;
  };

  it("should be defined", () => {
    expect(guard).toBeDefined();
  });

  it("should throw UnauthorizedException if user is missing", async () => {
    const req = { headers: {}, params: {} };
    const context = createMockContext(req);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("should throw BadRequestException if route param organizationId and X-Tenant-Id header mismatch", async () => {
    const req = {
      user: { id: "user-1" },
      params: { organizationId: "org-1" },
      headers: { "x-tenant-id": "org-2" },
    };
    const context = createMockContext(req);

    await expect(guard.canActivate(context)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("should resolve organizationId from route param if header is omitted", async () => {
    const req: any = {
      user: { id: "user-1" },
      params: { organizationId: "org-1" },
      headers: {},
    };
    const context = createMockContext(req);

    tenancyService.validateAndGetTenantContext.mockResolvedValue({
      organization: { id: "org-1", name: "Org 1" } as any,
      member: { id: "mem-1" } as any,
      organizationId: "org-1",
      role: "MEMBER" as any,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(tenancyService.validateAndGetTenantContext).toHaveBeenCalledWith(
      "user-1",
      "org-1",
    );
    expect(req.organizationId).toBe("org-1");
    expect(req.tenantRole).toBe("MEMBER");
  });

  it("should resolve organizationId from X-Organization-Id header if route param is omitted", async () => {
    const req: any = {
      user: { id: "user-1" },
      params: {},
      headers: { "x-organization-id": "org-10" },
    };
    const context = createMockContext(req);

    tenancyService.validateAndGetTenantContext.mockResolvedValue({
      organization: { id: "org-10", name: "Org 10" } as any,
      member: { id: "mem-10" } as any,
      organizationId: "org-10",
      role: "ADMIN" as any,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(tenancyService.validateAndGetTenantContext).toHaveBeenCalledWith(
      "user-1",
      "org-10",
    );
    expect(req.organizationId).toBe("org-10");
    expect(req.tenantRole).toBe("ADMIN");
  });
});
