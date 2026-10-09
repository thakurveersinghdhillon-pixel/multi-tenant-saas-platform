import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { io, Socket as ClientSocket } from "socket.io-client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { WEBSOCKET_EVENTS } from "../src/websocket/websocket.constants";
import { NOTIFICATION_TYPES } from "../src/notifications/constants/notification-types";

describe("Notifications & Real-Time Notification Delivery (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let serverPort: number;
  let wsUrl: string;

  // Test Users
  const userAData = {
    email: `notif-usera-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "NotifUser",
    lastName: "A",
  };

  const userBData = {
    email: `notif-userb-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "NotifUser",
    lastName: "B",
  };

  const userOrg2Data = {
    email: `notif-userorg2-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "NotifUser",
    lastName: "Org2",
  };

  let tokenA: string;
  let tokenB: string;
  let tokenOrg2: string;

  let userAId: string;
  let userBId: string;
  let userOrg2Id: string;

  let org1Id: string;
  let org2Id: string;

  let project1Id: string;
  let notificationId1: string;

  const clientSockets: ClientSocket[] = [];

  const createClientSocket = (token?: string): ClientSocket => {
    const socket = io(wsUrl, {
      auth: token ? { token } : undefined,
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });
    clientSockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    await app.listen(0);
    const server = app.getHttpServer();
    const address = server.address();
    serverPort = typeof address === "string" ? 0 : address.port;
    wsUrl = `http://localhost:${serverPort}`;

    prisma = app.get(PrismaService);

    // Register User A
    const resA = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userAData)
      .expect(201);
    tokenA = resA.body.accessToken;
    userAId = resA.body.user.id;

    // Register User B
    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userBData)
      .expect(201);
    tokenB = resB.body.accessToken;
    userBId = resB.body.user.id;

    // Register User Org2
    const resOrg2 = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userOrg2Data)
      .expect(201);
    tokenOrg2 = resOrg2.body.accessToken;
    userOrg2Id = resOrg2.body.user.id;

    // User A creates Org 1
    const resOrg1 = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Notif Org 1", slug: `notif-org-1-${Date.now()}` })
      .expect(201);
    org1Id = resOrg1.body.id;

    // Add User B to Org 1 as MEMBER
    await request(app.getHttpServer())
      .post(`/organizations/${org1Id}/members`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ email: userBData.email, role: "MEMBER" })
      .expect(201);

    // User Org2 creates Org 2
    const resOrg2Obj = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenOrg2}`)
      .send({ name: "Notif Org 2", slug: `notif-org-2-${Date.now()}` })
      .expect(201);
    org2Id = resOrg2Obj.body.id;

    // User A creates Project 1 in Org 1
    const resProj1 = await request(app.getHttpServer())
      .post(`/organizations/${org1Id}/projects`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Notif Project 1", slug: `notif-proj-1-${Date.now()}` })
      .expect(201);
    project1Id = resProj1.body.id;

    // Add User B to Project 1 as PROJECT_MEMBER
    await request(app.getHttpServer())
      .post(`/organizations/${org1Id}/projects/${project1Id}/members`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ email: userBData.email, role: "PROJECT_MEMBER" })
      .expect(201);
  });

  afterAll(async () => {
    clientSockets.forEach((s) => s.close());

    if (prisma) {
      await prisma.notification.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.activityLog.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.comment.deleteMany({
        where: { task: { projectId: { in: [project1Id].filter(Boolean) } } },
      });
      await prisma.task.deleteMany({
        where: { projectId: { in: [project1Id].filter(Boolean) } },
      });
      await prisma.projectMember.deleteMany({
        where: { projectId: { in: [project1Id].filter(Boolean) } },
      });
      await prisma.project.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.refreshToken.deleteMany({
        where: {
          userId: { in: [userAId, userBId, userOrg2Id].filter(Boolean) },
        },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [userAId, userBId, userOrg2Id].filter(Boolean) } },
      });
    }

    await app.close();
  });

  describe("1. Notification Creation & Assignment Trigger", () => {
    it("should create TASK_ASSIGNED notification for User B when User A assigns task to User B", async () => {
      const taskRes = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Tenant-Id", org1Id)
        .send({
          title: "Notification Trigger Task",
          description: "Task for testing notification creation",
          assigneeId: userBId,
        })
        .expect(201);

      const taskId = taskRes.body.id;

      // Query User B's notifications
      const notifRes = await request(app.getHttpServer())
        .get("/notifications")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);

      expect(notifRes.body.data.length).toBeGreaterThanOrEqual(1);
      const notification = notifRes.body.data.find(
        (n: any) => n.type === NOTIFICATION_TYPES.TASK_ASSIGNED,
      );
      expect(notification).toBeDefined();
      expect(notification.userId).toBe(userBId);
      expect(notification.actorId).toBe(userAId);
      expect(notification.organizationId).toBe(org1Id);
      expect(notification.projectId).toBe(project1Id);
      expect(notification.taskId).toBe(taskId);
      expect(notification.isRead).toBe(false);

      notificationId1 = notification.id;
    });

    it("should NOT create self-notification when User A assigns task to User A", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Tenant-Id", org1Id)
        .send({
          title: "Self Assigned Task",
          assigneeId: userAId,
        })
        .expect(201);

      const notifRes = await request(app.getHttpServer())
        .get("/notifications")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);

      const selfAssignedNotifs = notifRes.body.data.filter(
        (n: any) => n.title === "Task Assigned" && n.taskId,
      );
      expect(selfAssignedNotifs).toHaveLength(0);
    });
  });

  describe("2. Unread Count & Pagination REST APIs", () => {
    it("should return accurate unread-count for recipient", async () => {
      const res = await request(app.getHttpServer())
        .get("/notifications/unread-count")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);

      expect(res.body.count).toBeGreaterThanOrEqual(1);
    });

    it("should retrieve single notification by ID for recipient owner", async () => {
      const res = await request(app.getHttpServer())
        .get(`/notifications/${notificationId1}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);

      expect(res.body.id).toBe(notificationId1);
      expect(res.body.userId).toBe(userBId);
    });
  });

  describe("3. Mark as Read & Mark All as Read", () => {
    it("should mark single notification as read", async () => {
      const markRes = await request(app.getHttpServer())
        .patch(`/notifications/${notificationId1}/read`)
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);

      expect(markRes.body.isRead).toBe(true);
      expect(markRes.body.readAt).toBeDefined();
    });

    it("should mark all unread notifications as read", async () => {
      // User A creates 2 tasks assigned to User B
      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Tenant-Id", org1Id)
        .send({ title: "Task For Mark All 1", assigneeId: userBId })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Tenant-Id", org1Id)
        .send({ title: "Task For Mark All 2", assigneeId: userBId })
        .expect(201);

      // Verify unread count >= 2
      const countBefore = await request(app.getHttpServer())
        .get("/notifications/unread-count")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);
      expect(countBefore.body.count).toBeGreaterThanOrEqual(2);

      // Mark all read
      const markAllRes = await request(app.getHttpServer())
        .patch("/notifications/read-all")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);

      expect(markAllRes.body.count).toBeGreaterThanOrEqual(2);

      // Verify unread query returns empty list
      const unreadList = await request(app.getHttpServer())
        .get("/notifications?unread=true")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);

      expect(unreadList.body.data).toHaveLength(0);
    });
  });

  describe("4. Tenant & User Authorization Isolation", () => {
    it("should prevent User A from accessing User B notification details (404 Not Found)", async () => {
      await request(app.getHttpServer())
        .get(`/notifications/${notificationId1}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Tenant-Id", org1Id)
        .expect(404);
    });

    it("should prevent User B from accessing notifications using an unauthorized organization header (403 Forbidden)", async () => {
      await request(app.getHttpServer())
        .get("/notifications")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org2Id)
        .expect(403);
    });
  });

  describe("5. Real-Time WebSocket Notification Delivery & User Room", () => {
    it("should deliver real-time notification:new to recipient socket in user:{userId} room", (done) => {
      const socketB = createClientSocket(tokenB);

      socketB.on("connect", async () => {
        socketB.once(WEBSOCKET_EVENTS.NOTIFICATION_NEW, (event: any) => {
          expect(event).toBeDefined();
          expect(event.eventId).toBeDefined();
          expect(event.organizationId).toBe(org1Id);
          expect(event.type).toBe(WEBSOCKET_EVENTS.NOTIFICATION_NEW);
          expect(event.data).toBeDefined();
          expect(event.data.type).toBe(NOTIFICATION_TYPES.TASK_ASSIGNED);
          expect(event.data.title).toBe("Task Assigned");
          expect(event.data.message).toContain("Real-Time WS Task");
          // Sensitive actor fields sanitized
          expect(event.actor?.password).toBeUndefined();
          done();
        });

        // User A assigns a new task to User B via REST API
        await request(app.getHttpServer())
          .post(`/organizations/${org1Id}/projects/${project1Id}/tasks`)
          .set("Authorization", `Bearer ${tokenA}`)
          .set("X-Tenant-Id", org1Id)
          .send({ title: "Real-Time WS Task", assigneeId: userBId })
          .expect(201);
      });
    });
  });

  describe("6. Offline User Persistence & Reconnect Fetch", () => {
    it("should persist notification when user is offline and deliver upon REST fetch after reconnect", async () => {
      // 1. Ensure User B has no active socket connection (offline)
      clientSockets.forEach((s) => s.close());

      // 2. User A posts comment on a task assigned to User B
      const taskRes = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Tenant-Id", org1Id)
        .send({ title: "Offline Task Comment Test", assigneeId: userBId })
        .expect(201);
      const taskId = taskRes.body.id;

      await request(app.getHttpServer())
        .post(
          `/organizations/${org1Id}/projects/${project1Id}/tasks/${taskId}/comments`,
        )
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Tenant-Id", org1Id)
        .send({ content: "Comment while user B is offline" })
        .expect(201);

      // 3. User B reconnects & fetches notifications via REST API
      const res = await request(app.getHttpServer())
        .get("/notifications?unread=true")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const commentNotif = res.body.data.find(
        (n: any) => n.type === NOTIFICATION_TYPES.TASK_COMMENTED,
      );
      expect(commentNotif).toBeDefined();
      expect(commentNotif.taskId).toBe(taskId);
      expect(commentNotif.isRead).toBe(false);
    });
  });

  describe("7. Failure Resilience (No Notification on Failed Mutation)", () => {
    it("should NOT create notification if task assignment fails (e.g. invalid assignee ID)", async () => {
      const countBefore = await request(app.getHttpServer())
        .get("/notifications/unread-count")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/projects/${project1Id}/tasks`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Tenant-Id", org1Id)
        .send({
          title: "Invalid Assignee Task",
          assigneeId: "00000000-0000-0000-0000-000000000000",
        })
        .expect(400);

      const countAfter = await request(app.getHttpServer())
        .get("/notifications/unread-count")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Tenant-Id", org1Id)
        .expect(200);

      expect(countAfter.body.count).toBe(countBefore.body.count);
    });
  });
});
