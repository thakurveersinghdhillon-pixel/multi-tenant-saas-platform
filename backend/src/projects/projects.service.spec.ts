import { Test, TestingModule } from "@nestjs/testing";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ProjectsService } from "./projects.service";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { ActivityService } from "../activity/activity.service";
import { RedisService } from "../redis/redis.service";
import { WebSocketService } from "../websocket/websocket.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ProjectRole } from "@prisma/client";

describe("ProjectsService (Unit)", () => {
  let service: ProjectsService;

  const mockNotificationsService = {
    createNotification: jest.fn(),
  };

  const mockWebSocketService = {
    emitProjectEvent: jest.fn(),
    emitTaskEvent: jest.fn(),
    emitCommentEvent: jest.fn(),
    emitActivityEvent: jest.fn(),
    emitNotificationEvent: jest.fn(),
  };

  const mockPrismaService = {
    project: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    projectMember: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    organizationMember: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(mockPrismaService)),
  };

  const mockTenancyService = {
    validateAndGetTenantContext: jest.fn(),
  };

  const mockActivityService = {
    record: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
    invalidateByPrefix: jest.fn().mockResolvedValue(0),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TenancyService, useValue: mockTenancyService },
        { provide: ActivityService, useValue: mockActivityService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: WebSocketService, useValue: mockWebSocketService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("create", () => {
    it("should throw ConflictException if slug is already taken in the same organization", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findUnique.mockResolvedValueOnce({
        id: "proj-1",
        slug: "test-slug",
      });

      await expect(
        service.create("user-1", "org-1", {
          name: "Test Project",
          slug: "test-slug",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("should create project and auto-bind creator as PROJECT_ADMIN", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.project.create.mockResolvedValueOnce({
        id: "new-proj-id",
        name: "New Project",
        slug: "new-project",
        organizationId: "org-1",
      });
      mockPrismaService.projectMember.create.mockResolvedValueOnce({
        id: "pmem-1",
      });

      const result = await service.create("user-1", "org-1", {
        name: "New Project",
        slug: "new-project",
      });

      expect(result.id).toBe("new-proj-id");
      expect(result.creatorRole).toBe(ProjectRole.PROJECT_ADMIN);
    });
  });

  describe("findOne", () => {
    it("should throw NotFoundException if project is not found in organization", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.findOne("user-1", "org-1", "nonexistent-proj"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("addMember", () => {
    it("should throw NotFoundException if target user email does not exist", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.addMember("user-1", "org-1", "proj-1", {
          email: "nonexistent@example.com",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ForbiddenException if target user does NOT belong to the organization", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: "user-outside",
        email: "outside@example.com",
      });
      // Target user is NOT an OrganizationMember
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce(
        null,
      );

      await expect(
        service.addMember("user-1", "org-1", "proj-1", {
          email: "outside@example.com",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ConflictException if user is already a project member", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: "user-inside",
        email: "inside@example.com",
      });
      // Target user IS an OrganizationMember
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        id: "omem-1",
      });
      // Target user IS ALREADY a ProjectMember
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        id: "pmem-1",
      });

      await expect(
        service.addMember("user-1", "org-1", "proj-1", {
          email: "inside@example.com",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("should add project member successfully when user belongs to organization", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: "user-2",
        email: "valid@example.com",
        firstName: "Valid",
        lastName: "Member",
      });
      // Target user IS an OrganizationMember
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        id: "omem-1",
      });
      // Target user IS NOT a ProjectMember
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.projectMember.create.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
        createdAt: new Date(),
        user: {
          id: "user-2",
          email: "valid@example.com",
          firstName: "Valid",
          lastName: "Member",
          avatarUrl: null,
        },
      });

      const result = await service.addMember("user-1", "org-1", "proj-1", {
        email: "valid@example.com",
        role: ProjectRole.PROJECT_MEMBER,
      });

      expect(result.userId).toBe("user-2");
      expect(result.role).toBe(ProjectRole.PROJECT_MEMBER);
    });
  });

  describe("updateMemberRole", () => {
    it("should throw ForbiddenException if demoting sole PROJECT_ADMIN", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        id: "pmem-1",
        role: ProjectRole.PROJECT_ADMIN,
      });
      mockPrismaService.projectMember.count.mockResolvedValueOnce(1);

      await expect(
        service.updateMemberRole("user-1", "org-1", "proj-1", "user-1", {
          role: ProjectRole.PROJECT_MEMBER,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("removeMember", () => {
    it("should throw ForbiddenException if removing sole PROJECT_ADMIN", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        id: "pmem-1",
        role: ProjectRole.PROJECT_ADMIN,
      });
      mockPrismaService.projectMember.count.mockResolvedValueOnce(1);

      await expect(
        service.removeMember("user-1", "org-1", "proj-1", "user-1"),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
