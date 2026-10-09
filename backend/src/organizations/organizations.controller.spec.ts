import { Test, TestingModule } from "@nestjs/testing";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";
import { RbacService } from "../rbac/rbac.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../tenancy/tenant.guard";
import { PermissionsGuard } from "../rbac/guards/permissions.guard";

describe("OrganizationsController (Unit)", () => {
  let controller: OrganizationsController;
  let service: jest.Mocked<OrganizationsService>;
  let rbacService: jest.Mocked<RbacService>;

  beforeEach(async () => {
    const mockOrganizationsService = {
      create: jest.fn(),
      findAllForUser: jest.fn(),
      getCurrent: jest.fn(),
      findOneForMember: jest.fn(),
      update: jest.fn(),
      getMembers: jest.fn(),
      addMember: jest.fn(),
      removeMember: jest.fn(),
      leaveOrganization: jest.fn(),
    };

    const mockRbacService = {
      updateMemberRole: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrganizationsController],
      providers: [
        { provide: OrganizationsService, useValue: mockOrganizationsService },
        { provide: RbacService, useValue: mockRbacService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OrganizationsController>(OrganizationsController);
    service = module.get(OrganizationsService);
    rbacService = module.get(RbacService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("create", () => {
    it("should delegate create to service", async () => {
      const dto = { name: "Acme Corp", slug: "acme-corp" };
      service.create.mockResolvedValue({ id: "org-1", ...dto } as any);

      const result = await controller.create("user-1", dto);

      expect(service.create).toHaveBeenCalledWith("user-1", dto);
      expect(result.id).toBe("org-1");
    });
  });

  describe("findAllForUser", () => {
    it("should delegate listing organizations to service", async () => {
      service.findAllForUser.mockResolvedValue([{ id: "org-1" }] as any);

      const result = await controller.findAllForUser("user-1");

      expect(service.findAllForUser).toHaveBeenCalledWith("user-1");
      expect(result).toHaveLength(1);
    });
  });

  describe("getCurrent", () => {
    it("should delegate getCurrent to service", async () => {
      service.getCurrent.mockResolvedValue({
        organization: { id: "org-1", name: "Org 1" },
      } as any);

      const result = await controller.getCurrent("user-1", "org-1");

      expect(service.getCurrent).toHaveBeenCalledWith("user-1", "org-1");
      expect(result.organization.id).toBe("org-1");
    });
  });

  describe("updateMemberRole", () => {
    it("should delegate role update to rbacService", async () => {
      const dto = { role: "ADMIN" as any };
      rbacService.updateMemberRole.mockResolvedValue({
        id: "mem-1",
        role: "ADMIN",
      } as any);

      const result = await controller.updateMemberRole(
        "user-1",
        "org-1",
        "user-2",
        dto,
      );

      expect(rbacService.updateMemberRole).toHaveBeenCalledWith(
        "user-1",
        "org-1",
        "user-2",
        "ADMIN",
      );
      expect(result.role).toBe("ADMIN");
    });
  });
});
