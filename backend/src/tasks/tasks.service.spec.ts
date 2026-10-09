import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { ActivityService } from "../activity/activity.service";
import { RedisService } from "../redis/redis.service";
import { WebSocketService } from "../websocket/websocket.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ProjectRole, TaskPriority, TaskStatus } from "@prisma/client";

describe("TasksService (Unit)", () => {
  let service: TasksService;

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
    organizationMember: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    task: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
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
        TasksService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TenancyService, useValue: mockTenancyService },
        { provide: ActivityService, useValue: mockActivityService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: WebSocketService, useValue: mockWebSocketService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
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
        service.create("user-1", "org-1", "proj-1", {
          title: "Test Task",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should throw ForbiddenException if assignee is NOT a project member", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique
        .mockResolvedValueOnce({ role: ProjectRole.PROJECT_MEMBER }) // requester project member check
        .mockResolvedValueOnce(null); // assignee target project member check
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: "user-outside",
      });
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        id: "omem-1",
      });

      await expect(
        service.create("user-1", "org-1", "proj-1", {
          title: "Test Task",
          assigneeId: "user-outside",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should create task with auto-calculated position when valid", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce({
        position: 2000,
      });
      mockPrismaService.task.create.mockResolvedValueOnce({
        id: "task-1",
        title: "New Task",
        status: TaskStatus.TODO,
        priority: TaskPriority.MEDIUM,
        position: 3000,
        projectId: "proj-1",
      });

      const result = await service.create("user-1", "org-1", "proj-1", {
        title: "New Task",
      });

      expect(result.id).toBe("task-1");
      expect(result.position).toBe(3000);
    });
  });

  describe("getBoard", () => {
    it("should return board grouped by status with tasks ordered by position", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_VIEWER,
      });
      mockPrismaService.task.findMany.mockResolvedValueOnce([
        { id: "t1", title: "Task 1", status: TaskStatus.TODO, position: 1000 },
        {
          id: "t2",
          title: "Task 2",
          status: TaskStatus.IN_PROGRESS,
          position: 1000,
        },
      ]);

      const result = await service.getBoard("user-1", "org-1", "proj-1");

      expect(result.TODO.length).toBe(1);
      expect(result.IN_PROGRESS.length).toBe(1);
      expect(result.IN_REVIEW.length).toBe(0);
      expect(result.DONE.length).toBe(0);
    });
  });

  describe("updateStatus", () => {
    it("should throw ForbiddenException if PROJECT_VIEWER tries to update status", async () => {
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
        service.updateStatus("user-1", "org-1", "proj-1", "task-1", {
          status: TaskStatus.IN_PROGRESS,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should update status and auto-append position in target column", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.task.findFirst
        .mockResolvedValueOnce({
          id: "task-1",
          projectId: "proj-1",
          status: TaskStatus.TODO,
          position: 1000,
        })
        .mockResolvedValueOnce({
          position: 1500,
        });
      mockPrismaService.task.update.mockResolvedValueOnce({
        id: "task-1",
        status: TaskStatus.IN_PROGRESS,
        position: 2500,
      });

      const result = await service.updateStatus(
        "user-1",
        "org-1",
        "proj-1",
        "task-1",
        {
          status: TaskStatus.IN_PROGRESS,
        },
      );

      expect(result.status).toBe(TaskStatus.IN_PROGRESS);
      expect(result.position).toBe(2500);
    });
  });

  describe("assignTask", () => {
    it("should throw ForbiddenException if assignee is not a project member", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique
        .mockResolvedValueOnce({ role: ProjectRole.PROJECT_MEMBER }) // requester check
        .mockResolvedValueOnce(null); // target assignee check
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: "user-outside",
      });
      mockPrismaService.organizationMember.findUnique.mockResolvedValueOnce({
        id: "omem-1",
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce({
        id: "task-1",
        projectId: "proj-1",
      });

      await expect(
        service.assignTask("user-1", "org-1", "proj-1", "task-1", {
          assigneeId: "user-outside",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("should unassign task if assigneeId is null", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce({
        id: "task-1",
        projectId: "proj-1",
      });
      mockPrismaService.task.update.mockResolvedValueOnce({
        id: "task-1",
        assignedToId: null,
      });

      const result = await service.assignTask(
        "user-1",
        "org-1",
        "proj-1",
        "task-1",
        {
          assigneeId: null,
        },
      );

      expect(result.assignedToId).toBeNull();
    });
  });

  describe("reorderTask", () => {
    it("should update position according to DTO", async () => {
      mockTenancyService.validateAndGetTenantContext.mockResolvedValueOnce({
        organizationId: "org-1",
      });
      mockPrismaService.project.findFirst.mockResolvedValueOnce({
        id: "proj-1",
      });
      mockPrismaService.projectMember.findUnique.mockResolvedValueOnce({
        role: ProjectRole.PROJECT_MEMBER,
      });
      mockPrismaService.task.findFirst.mockResolvedValueOnce({
        id: "task-1",
        projectId: "proj-1",
        status: TaskStatus.TODO,
        position: 1000,
      });
      mockPrismaService.task.update.mockResolvedValueOnce({
        id: "task-1",
        position: 1500,
      });

      const result = await service.reorderTask(
        "user-1",
        "org-1",
        "proj-1",
        "task-1",
        {
          position: 1500,
        },
      );

      expect(result.position).toBe(1500);
    });
  });

  describe("remove", () => {
    it("should throw NotFoundException if task does not exist", async () => {
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
        service.remove("user-1", "org-1", "proj-1", "nonexistent-task"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
