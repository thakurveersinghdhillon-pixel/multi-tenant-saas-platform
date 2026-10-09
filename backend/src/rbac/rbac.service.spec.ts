import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { RbacService } from "./rbac.service";
import { PrismaService } from "../database/prisma.service";

describe("RbacService (Unit)", () => {
  let service: RbacService;

  const mockPrismaService = {
    organizationMember: {
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    rolePermission: {
      findMany: jest.fn(),
    },
    role: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<RbacService>(RbacService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("hasPermissions", () => {
    it("should return true if no required permissions are requested", async () => {
      const result = await service.hasPermissions("user-1", "org-1", []);
      expect(result).toBe(true);
    });

    it("should return false if user is not an organization member", async () => {
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce(
        null,
      );
      const result = await service.hasPermissions("user-1", "org-1", [
        "member:read",
      ]);
      expect(result).toBe(false);
    });

    it("should return true if user role has all required permissions", async () => {
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        roleId: "role-owner",
      });
      mockPrismaService.rolePermission.findMany.mockResolvedValueOnce([
        { permission: { name: "member:read" } },
        { permission: { name: "member:update" } },
      ]);

      const result = await service.hasPermissions("user-1", "org-1", [
        "member:read",
        "member:update",
      ]);
      expect(result).toBe(true);
    });

    it("should return false if user role lacks any required permission", async () => {
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        roleId: "role-member",
      });
      mockPrismaService.rolePermission.findMany.mockResolvedValueOnce([
        { permission: { name: "member:read" } },
      ]);

      const result = await service.hasPermissions("user-1", "org-1", [
        "member:read",
        "member:update",
      ]);
      expect(result).toBe(false);
    });
  });

  describe("updateMemberRole", () => {
    it("should throw BadRequestException if target role is invalid", async () => {
      await expect(
        service.updateMemberRole("user-1", "org-1", "user-2", "SUPERADMIN"),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw ForbiddenException if requester is not a member", async () => {
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce(
        null,
      );
      await expect(
        service.updateMemberRole("user-1", "org-1", "user-2", "ADMIN"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException if requester lacks member:update permission", async () => {
      // Requester membership
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        role: { name: "VIEWER" },
        roleId: "role-viewer",
      });
      // hasPermissions check for member:update
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        roleId: "role-viewer",
      });
      mockPrismaService.rolePermission.findMany.mockResolvedValueOnce([
        { permission: { name: "organization:read" } },
      ]);

      await expect(
        service.updateMemberRole("user-viewer", "org-1", "user-2", "ADMIN"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException if ADMIN attempts to modify role of an OWNER", async () => {
      // Requester is ADMIN
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        role: { name: "ADMIN" },
        roleId: "role-admin",
      });
      // Requester has member:update permission
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        roleId: "role-admin",
      });
      mockPrismaService.rolePermission.findMany.mockResolvedValueOnce([
        { permission: { name: "member:update" } },
      ]);
      // Target is OWNER
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        role: { name: "OWNER" },
      });

      await expect(
        service.updateMemberRole("admin-1", "org-1", "owner-1", "MEMBER"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException if ADMIN attempts to promote someone to OWNER", async () => {
      // Requester is ADMIN
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        role: { name: "ADMIN" },
        roleId: "role-admin",
      });
      // Requester has member:update permission
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        roleId: "role-admin",
      });
      mockPrismaService.rolePermission.findMany.mockResolvedValueOnce([
        { permission: { name: "member:update" } },
      ]);
      // Target is MEMBER
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        role: { name: "MEMBER" },
      });

      await expect(
        service.updateMemberRole("admin-1", "org-1", "member-1", "OWNER"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException if sole OWNER attempts to demote self", async () => {
      // Requester is OWNER
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        role: { name: "OWNER" },
        roleId: "role-owner",
      });
      // Requester has member:update permission
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        roleId: "role-owner",
      });
      mockPrismaService.rolePermission.findMany.mockResolvedValueOnce([
        { permission: { name: "member:update" } },
      ]);
      // Target is self (OWNER)
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        role: { name: "OWNER" },
      });
      // Owner count is 1
      mockPrismaService.organizationMember.count.mockResolvedValueOnce(1);

      await expect(
        service.updateMemberRole("owner-1", "org-1", "owner-1", "ADMIN"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should update role successfully when authorized", async () => {
      // Requester is OWNER
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        role: { name: "OWNER" },
        roleId: "role-owner",
      });
      // hasPermissions check
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        roleId: "role-owner",
      });
      mockPrismaService.rolePermission.findMany.mockResolvedValueOnce([
        { permission: { name: "member:update" } },
      ]);
      // Target is MEMBER
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        id: "member-link-1",
        role: { name: "MEMBER" },
      });

      // Target new role lookup
      mockPrismaService.role.findFirst.mockResolvedValueOnce({
        id: "role-admin-id",
        name: "ADMIN",
      });

      // Update call
      mockPrismaService.organizationMember.update.mockResolvedValueOnce({
        updatedAt: new Date(),
        user: {
          id: "user-2",
          email: "member@acme.com",
          firstName: "Mike",
          lastName: "Developer",
        },
        role: { name: "ADMIN" },
      });

      const result = await service.updateMemberRole(
        "owner-1",
        "org-1",
        "user-2",
        "ADMIN",
      );

      expect(result.role).toBe("ADMIN");
      expect(result.email).toBe("member@acme.com");
    });
  });
});
