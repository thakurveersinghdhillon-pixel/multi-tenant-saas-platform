import { Test, TestingModule } from "@nestjs/testing";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TenantGuard } from "../tenancy/tenant.guard";

describe("NotificationsController (Unit)", () => {
  let controller: NotificationsController;
  let service: jest.Mocked<NotificationsService>;

  beforeEach(async () => {
    const mockNotificationsService = {
      findAllForUser: jest.fn(),
      getUnreadCount: jest.fn(),
      findOne: jest.fn(),
      markAsRead: jest.fn(),
      markAllAsRead: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<NotificationsController>(NotificationsController);
    service = module.get(NotificationsService);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("findAll", () => {
    it("should delegate to service with user and tenant organization", async () => {
      const query = { page: 1, limit: 10 };

      service.findAllForUser.mockResolvedValue({ data: [], meta: {} as any });

      const result = await controller.findAll("user-1", "org-1", query);

      expect(service.findAllForUser).toHaveBeenCalledWith(
        "user-1",
        "org-1",
        query,
      );
      expect(result).toBeDefined();
    });
  });

  describe("getUnreadCount", () => {
    it("should delegate to service to get unread count", async () => {
      service.getUnreadCount.mockResolvedValue({ count: 5 });

      const result = await controller.getUnreadCount("user-1", "org-1");

      expect(service.getUnreadCount).toHaveBeenCalledWith("user-1", "org-1");
      expect(result).toEqual({ count: 5 });
    });
  });

  describe("findOne", () => {
    it("should delegate to service to find single notification", async () => {
      service.findOne.mockResolvedValue({ id: "notif-1" } as any);

      const result = await controller.findOne("user-1", "org-1", "notif-1");

      expect(service.findOne).toHaveBeenCalledWith(
        "user-1",
        "org-1",
        "notif-1",
      );
      expect(result).toEqual({ id: "notif-1" });
    });
  });

  describe("markAsRead", () => {
    it("should delegate to service to mark notification read", async () => {
      service.markAsRead.mockResolvedValue({
        id: "notif-1",
        isRead: true,
      } as any);

      const result = await controller.markAsRead("user-1", "org-1", "notif-1");

      expect(service.markAsRead).toHaveBeenCalledWith(
        "user-1",
        "org-1",
        "notif-1",
      );
      expect(result.isRead).toBe(true);
    });
  });

  describe("markAllAsRead", () => {
    it("should delegate to service to mark all notifications read", async () => {
      service.markAllAsRead.mockResolvedValue({ message: "OK", count: 3 });

      const result = await controller.markAllAsRead("user-1", "org-1");

      expect(service.markAllAsRead).toHaveBeenCalledWith("user-1", "org-1");
      expect(result.count).toBe(3);
    });
  });
});
