import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ActivityService } from "./activity.service";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { RedisService } from "../redis/redis.service";
import { WebSocketService } from "../websocket/websocket.service";
import { ACTIVITY_EVENTS } from "./constants/activity-events";
import { ProjectRole } from "@prisma/client";

describe("ActivityService (Unit)", () => {
  let service: ActivityService;

  const mockWebSocketService = {
    emitProjectEvent: jest.fn(),
    emitTaskEvent: jest.fn(),
    emitCommentEvent: jest.fn(),
    emitActivityEvent: jest.fn(),
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
    activityLog: {
      create: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockTenancyService = {
    validateAndGetTenantContext: jest.fn(),
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
        ActivityService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TenancyService, useValue: mockTenancyService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: WebSocketService, useValue: mockWebSocketService },
      ],
    }).compile();

    service = module.get<ActivityService>(ActivityService);
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("record", () => {
    it("should create activity log entry", async () => {
      mockPrismaService.activityLog.create.mockResolvedValueOnce({
        id: "log-1",
        organizationId: "org-1",
        userId: "user-1",
        projectId: "proj-1",
        action: ACTIVITY_EVENTS.PROJECT_CREATED,
      });

      const result = await service.record({
        organizationId: "org-1",
        userId: "user-1",
        projectId: "proj-1",
        action: ACTIVITY_EVENTS.PROJECT_CREATED,
        metadata: { name: "Alpha" },
      });

      expect(result.id).toBe("log-1");
      expect(mockPrismaService.activityLog.create).toHaveBeenCalled();
    });
  });

  describe("findByProject", () => {
    it("should throw ForbiddenException if user is NOT a project member", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.findByProject("user-1", "org-1", "proj-1"),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should return paginated activity history for project", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.activityLog.count.mockResolvedValueOnce(1);
      mockPrismaService.activityLog.findMany.mockResolvedValueOnce([
        {
          id: "log-1",
          organizationId: "org-1",
          projectId: "proj-1",
          action: ACTIVITY_EVENTS.PROJECT_CREATED,
          metadata: { name: "Alpha" },
          createdAt: new Date(),
          user: {
            id: "u1",
            firstName: "John",
            lastName: "Doe",
            email: "j@d.com",
          },
        },
      ]);

      const result = await service.findByProject("user-1", "org-1", "proj-1");

      expect(result.data.length).toBe(1);
      expect(result.pagination.total).toBe(1);
      expect(result.data[0].action).toBe(ACTIVITY_EVENTS.PROJECT_CREATED);
    });
  });

  describe("findByTask", () => {
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
        service.findByTask("user-1", "org-1", "proj-1", "task-1"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should return paginated activity history for task", async () => {
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
      mockPrismaService.activityLog.count.mockResolvedValueOnce(1);
      mockPrismaService.activityLog.findMany.mockResolvedValueOnce([
        {
          id: "log-2",
          organizationId: "org-1",
          projectId: "proj-1",
          taskId: "task-1",
          action: ACTIVITY_EVENTS.TASK_CREATED,
          metadata: { title: "First Task" },
          createdAt: new Date(),
          user: {
            id: "u1",
            firstName: "John",
            lastName: "Doe",
            email: "j@d.com",
          },
        },
      ]);

      const result = await service.findByTask(
        "user-1",
        "org-1",
        "proj-1",
        "task-1",
      );

      expect(result.data.length).toBe(1);
      expect(result.data[0].taskId).toBe("task-1");
    });
  });
});
