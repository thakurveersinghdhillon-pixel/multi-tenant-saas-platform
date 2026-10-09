import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { CommentsService } from "./comments.service";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { ActivityService } from "../activity/activity.service";
import { RedisService } from "../redis/redis.service";
import { WebSocketService } from "../websocket/websocket.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ProjectRole } from "@prisma/client";

describe("CommentsService (Unit)", () => {
  let service: CommentsService;

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

  const mockPrismaService: any = {
    project: {
      findFirst: jest.fn(),
    },
    projectMember: {
      findUnique: jest.fn(),
    },
    task: {
      findFirst: jest.fn(),
    },
    comment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
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
        CommentsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TenancyService, useValue: mockTenancyService },
        { provide: ActivityService, useValue: mockActivityService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: WebSocketService, useValue: mockWebSocketService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("create", () => {
    it("should throw ForbiddenException if user is PROJECT_VIEWER", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_VIEWER,
      });

      await expect(
        service.create("user-1", "org-1", "proj-1", "task-1", {
          content: "Test Comment",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw NotFoundException if task does not exist in project", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create("user-1", "org-1", "proj-1", "task-1", {
          content: "Test Comment",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should create comment and record activity history when valid", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce({ id: "task-1" });
      mockPrismaService.comment.create.mockResolvedValueOnce({
        id: "comment-1",
        taskId: "task-1",
        userId: "user-1",
        content: "New Comment",
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: "user-1",
          firstName: "John",
          lastName: "Doe",
          email: "john@example.com",
          avatarUrl: null,
        },
      });

      const result = await service.create(
        "user-1",
        "org-1",
        "proj-1",
        "task-1",
        {
          content: "New Comment",
        },
      );

      expect(result.id).toBe("comment-1");
      expect(result.content).toBe("New Comment");
      expect(mockActivityService.record).toHaveBeenCalled();
    });
  });

  describe("findAll", () => {
    it("should return comments for task", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce({ id: "task-1" });
      mockPrismaService.comment.findMany.mockResolvedValueOnce([
        {
          id: "c1",
          taskId: "task-1",
          content: "Comment 1",
          user: { id: "u1", firstName: "A", lastName: "B", email: "a@b.com" },
          createdAt: new Date(),
        },
      ]);

      const result = await service.findAll(
        "user-1",
        "org-1",
        "proj-1",
        "task-1",
      );

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("c1");
    });
  });

  describe("update", () => {
    it("should throw ForbiddenException if editing another user comment", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce({ id: "task-1" });
      mockPrismaService.comment.findFirst.mockResolvedValueOnce({
        id: "c1",
        userId: "other-user",
        content: "Original",
      });

      await expect(
        service.update("user-1", "org-1", "proj-1", "task-1", "c1", {
          content: "Updated Content",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should update comment if user is author", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce({ id: "task-1" });
      mockPrismaService.comment.findFirst.mockResolvedValueOnce({
        id: "c1",
        userId: "user-1",
        content: "Original",
      });
      mockPrismaService.comment.update.mockResolvedValueOnce({
        id: "c1",
        content: "Updated Content",
        user: {
          id: "user-1",
          firstName: "John",
          lastName: "Doe",
          email: "j@d.com",
        },
      });

      const result = await service.update(
        "user-1",
        "org-1",
        "proj-1",
        "task-1",
        "c1",
        {
          content: "Updated Content",
        },
      );

      expect(result.content).toBe("Updated Content");
      expect(mockActivityService.record).toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("should allow PROJECT_ADMIN to delete another user comment for moderation", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
        role: { name: "MEMBER" },
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_ADMIN,
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce({ id: "task-1" });
      mockPrismaService.comment.findFirst.mockResolvedValueOnce({
        id: "c1",
        userId: "other-user",
      });
      mockPrismaService.comment.update.mockResolvedValueOnce({ id: "c1" });

      const result = await service.remove(
        "user-1",
        "org-1",
        "proj-1",
        "task-1",
        "c1",
      );

      expect(result.message).toBe("Comment successfully deleted");
      expect(mockActivityService.record).toHaveBeenCalled();
    });

    it("should throw ForbiddenException if non-author / non-admin tries to delete comment", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
        role: { name: "MEMBER" },
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce({ id: "task-1" });
      mockPrismaService.comment.findFirst.mockResolvedValueOnce({
        id: "c1",
        userId: "other-user",
      });

      await expect(
        service.remove("user-1", "org-1", "proj-1", "task-1", "c1"),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
