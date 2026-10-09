import { Test, TestingModule } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import {
  ForbiddenException,
  UnauthorizedException,
  BadRequestException,
  ExecutionContext,
} from "@nestjs/common";
import { PermissionsGuard } from "./permissions.guard";
import { RbacService } from "../rbac.service";
import { PERMISSIONS } from "../constants/permissions";

describe("PermissionsGuard (Unit)", () => {
  let guard: PermissionsGuard;
  let reflector: jest.Mocked<Reflector>;
  let rbacService: jest.Mocked<RbacService>;

  const validOrgId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  beforeEach(async () => {
    const mockReflector = {
      get: jest.fn(),
      getAllAndOverride: jest.fn(),
    };

    const mockRbacService = {
      hasPermissions: jest.fn(),
      getUserPermissions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: RbacService, useValue: mockRbacService },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get(Reflector);
    rbacService = module.get(RbacService);
  });

  const createMockContext = (requestData: any): ExecutionContext => {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ headers: {}, params: {}, ...requestData }),
      }),
    } as unknown as ExecutionContext;
  };

  it("should be defined", () => {
    expect(guard).toBeDefined();
  });

  it("should allow access if no required permissions metadata is set", async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createMockContext({
      user: { id: "user-1" },
      organizationId: validOrgId,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it("should allow access if required permissions array is empty", async () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    const context = createMockContext({
      user: { id: "user-1" },
      organizationId: validOrgId,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });

  it("should throw UnauthorizedException if user is missing", async () => {
    reflector.getAllAndOverride.mockReturnValue([PERMISSIONS.MEMBER_READ]);
    const context = createMockContext({ organizationId: validOrgId });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("should throw BadRequestException if organizationId is missing", async () => {
    reflector.getAllAndOverride.mockReturnValue([PERMISSIONS.MEMBER_READ]);
    const context = createMockContext({ user: { id: "user-1" } });

    await expect(guard.canActivate(context)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("should throw ForbiddenException if user does NOT have required permission", async () => {
    reflector.getAllAndOverride.mockReturnValue([PERMISSIONS.MEMBER_DELETE]);
    rbacService.hasPermissions.mockResolvedValue(false);

    const context = createMockContext({
      user: { id: "user-1" },
      organizationId: validOrgId,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(rbacService.hasPermissions).toHaveBeenCalledWith(
      "user-1",
      validOrgId,
      [PERMISSIONS.MEMBER_DELETE],
    );
  });

  it("should allow access if user has required permission", async () => {
    reflector.getAllAndOverride.mockReturnValue([PERMISSIONS.MEMBER_READ]);
    rbacService.hasPermissions.mockResolvedValue(true);

    const context = createMockContext({
      user: { id: "user-1" },
      organizationId: validOrgId,
    });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(rbacService.hasPermissions).toHaveBeenCalledWith(
      "user-1",
      validOrgId,
      [PERMISSIONS.MEMBER_READ],
    );
  });
});
