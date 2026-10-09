import { Test, TestingModule } from "@nestjs/testing";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { RoleEnum } from "./dto/update-member-role.dto";

describe("OrganizationsService (Unit)", () => {
  let service: OrganizationsService;

  const mockPrismaService = {
    organization: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    role: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    organizationMember: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockTenancyService = {
    validateAndGetTenantContext: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TenancyService, useValue: mockTenancyService },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("create", () => {
    it("should throw ConflictException if slug is taken", async () => {
      mockPrismaService.organization.findUnique.mockResolvedValueOnce({
        id: "org-1",
      });

      await expect(
        service.create("user-1", {
          name: "Duplicate Org",
          slug: "duplicate-slug",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("should create organization and bind creator as OWNER", async () => {
      mockPrismaService.organization.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.role.findFirst.mockResolvedValueOnce({
        id: "owner-role-id",
        name: "OWNER",
      });
      mockPrismaService.organization.create.mockResolvedValueOnce({
        id: "new-org-id",
        name: "New Corp",
        slug: "new-corp",
      });
      mockPrismaService.organizationMember.create.mockResolvedValueOnce({
        id: "mem-1",
      });

      const result = await service.create("user-1", {
        name: "New Corp",
        slug: "new-corp",
      });

      expect(result.id).toBe("new-org-id");
      expect(result.role).toBe("OWNER");
    });
  });

  describe("addMember", () => {
    it("should throw NotFoundException if target user email does not exist", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "OWNER" },
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.addMember("owner-id", "org-id", {
          email: "nonexistent@example.com",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ConflictException if user is already a member", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "OWNER" },
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: "user-2",
        email: "existing@example.com",
      });
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        id: "mem-2",
      });

      await expect(
        service.addMember("owner-id", "org-id", {
          email: "existing@example.com",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("should throw ForbiddenException if ADMIN attempts to add user as OWNER", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "ADMIN" },
      });

      await expect(
        service.addMember("admin-id", "org-id", {
          email: "user@example.com",
          role: RoleEnum.OWNER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should add member successfully when authorized", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "OWNER" },
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: "user-2",
        email: "newmember@example.com",
        firstName: "New",
        lastName: "Member",
      });
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce(
        null,
      );
      mockPrismaService.role.findFirst.mockResolvedValueOnce({
        id: "role-member-id",
        name: "MEMBER",
      });
      mockPrismaService.organizationMember.create.mockResolvedValueOnce({
        createdAt: new Date(),
        user: {
          id: "user-2",
          email: "newmember@example.com",
          firstName: "New",
          lastName: "Member",
          avatarUrl: null,
        },
        role: { name: "MEMBER" },
      });

      const result = await service.addMember("owner-id", "org-id", {
        email: "newmember@example.com",
        role: RoleEnum.MEMBER,
      });

      expect(result.userId).toBe("user-2");
      expect(result.role).toBe("MEMBER");
    });
  });

  describe("removeMember", () => {
    it("should throw NotFoundException if target member does not exist in organization", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "OWNER" },
      });
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce(
        null,
      );

      await expect(
        service.removeMember("owner-id", "org-id", "non-existent-user"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if ADMIN attempts to remove an OWNER", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "ADMIN" },
      });
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        id: "mem-owner",
        role: { name: "OWNER" },
      });

      await expect(
        service.removeMember("admin-id", "org-id", "owner-id"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException if ADMIN attempts to remove another ADMIN", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "ADMIN" },
      });
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        id: "mem-admin2",
        role: { name: "ADMIN" },
      });

      await expect(
        service.removeMember("admin-id", "org-id", "admin2-id"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException if trying to remove the sole OWNER", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "OWNER" },
      });
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        id: "mem-owner",
        role: { name: "OWNER" },
      });
      mockPrismaService.organizationMember.count.mockResolvedValueOnce(1);

      await expect(
        service.removeMember("owner-id", "org-id", "owner-id"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should remove member successfully when authorized", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "OWNER" },
      });
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        id: "mem-member",
        role: { name: "MEMBER" },
      });
      mockPrismaService.organizationMember.delete.mockResolvedValueOnce({});

      const result = await service.removeMember(
        "owner-id",
        "org-id",
        "member-id",
      );
      expect(result.userId).toBe("member-id");
      expect(result.message).toBe(
        "Member successfully removed from organization",
      );
    });
  });

  describe("leaveOrganization", () => {
    it("should throw ForbiddenException if sole OWNER attempts to leave", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "OWNER" },
      });
      mockPrismaService.organizationMember.count.mockResolvedValueOnce(1);

      await expect(
        service.leaveOrganization("owner-id", "org-id"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should allow MEMBER to leave organization", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        role: { name: "MEMBER" },
      });
      mockPrismaService.organizationMember.delete.mockResolvedValueOnce({});

      const result = await service.leaveOrganization("member-id", "org-id");
      expect(result.message).toBe("Successfully left the organization");
    });
  });
});
