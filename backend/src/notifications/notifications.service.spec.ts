import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsService } from "./notifications.service";
import { PrismaService } from "../database/prisma.service";
import { RedisService } from "../redis/redis.service";
import { WebSocketService } from "../websocket/websocket.service";
import { NOTIFICATION_TYPES } from "./constants/notification-types";

describe("NotificationsService (Unit)", () => {
  let service: NotificationsService;
  let prisma: jest.Mocked<PrismaService>;
  let redisService: jest.Mocked<RedisService>;
  let webSocketService: jest.Mocked<WebSocketService>;

  const mockPrismaService: any = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockRedisService = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
  };

  const mockWebSocketService = {
    emitNotificationEvent: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: WebSocketService, useValue: mockWebSocketService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get(PrismaService);
    redisService = module.get(RedisService);
    webSocketService = module.get(WebSocketService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createNotification", () => {
    it("should skip creating self-notification if actorId === userId", async () => {
      const result = await service.createNotification({
        organizationId: "org-1",
        userId: "user-1",
        actorId: "user-1",
        type: NOTIFICATION_TYPES.TASK_ASSIGNED,
        title: "Title",
        message: "Message",
      });

      expect(result).toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it("should create notification and emit WebSocket event", async () => {
      const createdNotification = {
        id: "notif-1",
        organizationId: "org-1",
        userId: "user-2",
        actorId: "user-1",
        projectId: "proj-1",
        taskId: "task-1",
        type: NOTIFICATION_TYPES.TASK_ASSIGNED,
        title: "Task Assigned",
        message: "Assigned to task",
        isRead: false,
        createdAt: new Date(),
        actor: { id: "user-1", email: "actor@example.com" },
        project: { id: "proj-1", name: "Project 1", slug: "p1" },
        task: { id: "task-1", title: "Task 1" },
      };

      (prisma.notification.create as jest.Mock).mockResolvedValue(
        createdNotification,
      );

      const result = await service.createNotification({
        organizationId: "org-1",
        userId: "user-2",
        actorId: "user-1",
        projectId: "proj-1",
        taskId: "task-1",
        type: NOTIFICATION_TYPES.TASK_ASSIGNED,
        title: "Task Assigned",
        message: "Assigned to task",
      });

      expect(result).toEqual(createdNotification);
      expect(redisService.del).toHaveBeenCalledWith(
        "v1:tenant:org-1:user:user-2:notifications:unread-count",
      );
      expect(webSocketService.emitNotificationEvent).toHaveBeenCalledWith(
        "org-1",
        "user-2",
        expect.objectContaining({ id: "notif-1" }),
        { id: "user-1", email: "actor@example.com" },
      );
    });
  });

  describe("findAllForUser", () => {
    it("should return paginated notifications and unread count", async () => {
      const mockNotifications = [{ id: "notif-1", title: "N1" }];
      (prisma.notification.findMany as jest.Mock).mockResolvedValue(
        mockNotifications,
      );
      (prisma.notification.count as jest.Mock).mockResolvedValue(1);

      // getUnreadCount via redis
      redisService.get.mockResolvedValueOnce({ count: 5 });

      const result = await service.findAllForUser("user-1", "org-1", {
        page: 1,
        limit: 10,
      });

      expect(result.data).toEqual(mockNotifications);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
        unreadCount: 5,
      });
    });
  });

  describe("getUnreadCount", () => {
    it("should return cached count if available in Redis", async () => {
      redisService.get.mockResolvedValueOnce({ count: 3 });

      const result = await service.getUnreadCount("user-1", "org-1");

      expect(result).toEqual({ count: 3 });
      expect(prisma.notification.count).not.toHaveBeenCalled();
    });

    it("should query DB and cache result if Redis cache misses", async () => {
      redisService.get.mockResolvedValueOnce(null);
      (prisma.notification.count as jest.Mock).mockResolvedValue(4);

      const result = await service.getUnreadCount("user-1", "org-1");

      expect(result).toEqual({ count: 4 });
      expect(redisService.set).toHaveBeenCalledWith(
        "v1:tenant:org-1:user:user-1:notifications:unread-count",
        { count: 4 },
        30,
      );
    });
  });

  describe("markAsRead", () => {
    it("should mark notification as read and invalidate unread count cache", async () => {
      const notification = {
        id: "notif-1",
        userId: "user-1",
        organizationId: "org-1",
        isRead: false,
      };

      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(
        notification,
      );
      (prisma.notification.update as jest.Mock).mockResolvedValue({
        ...notification,
        isRead: true,
        readAt: new Date(),
      });

      const result = await service.markAsRead("user-1", "org-1", "notif-1");

      expect(result.isRead).toBe(true);
      expect(redisService.del).toHaveBeenCalledWith(
        "v1:tenant:org-1:user:user-1:notifications:unread-count",
      );
    });
  });

  describe("markAllAsRead", () => {
    it("should mark all unread notifications as read for current user and tenant", async () => {
      (prisma.notification.updateMany as jest.Mock).mockResolvedValue({
        count: 3,
      });

      const result = await service.markAllAsRead("user-1", "org-1");

      expect(result).toEqual({
        message: "All notifications marked as read",
        count: 3,
      });
      expect(redisService.del).toHaveBeenCalledWith(
        "v1:tenant:org-1:user:user-1:notifications:unread-count",
      );
    });
  });
});
