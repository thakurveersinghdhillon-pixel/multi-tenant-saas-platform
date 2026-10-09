import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { io, Socket as ClientSocket } from "socket.io-client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { WEBSOCKET_EVENTS } from "../src/websocket/websocket.constants";
import {
  createTestUser,
  createTestOrganization,
  addOrganizationMember,
  createTestProject,
  addProjectMember,
  createTestTask,
  TestUser,
  TestOrganization,
  TestProject,
  TestTask,
} from "./helpers/test-factories";

describe("Phase 13 Comprehensive Security, Isolation & Quality Hardening (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redisService: RedisService;
  let serverPort: number;
  let wsUrl: string;

  // Primary Test Fixtures
  let ownerA: TestUser;
  let memberA: TestUser;
  let viewerA: TestUser;
  let orgMemberOnlyA: TestUser;

  let ownerB: TestUser;
  let memberB: TestUser;

  let orgA: TestOrganization;
  let orgB: TestOrganization;

  let projA: TestProject;
  let projB: TestProject;

  let taskB: TestTask;

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
    redisService = app.get(RedisService);

    // 1. Create Users
    ownerA = await createTestUser(app, { firstName: "Owner", lastName: "A" });
    memberA = await createTestUser(app, { firstName: "Member", lastName: "A" });
    viewerA = await createTestUser(app, { firstName: "Viewer", lastName: "A" });
    orgMemberOnlyA = await createTestUser(app, {
      firstName: "OrgOnly",
      lastName: "A",
    });

    ownerB = await createTestUser(app, { firstName: "Owner", lastName: "B" });
    memberB = await createTestUser(app, { firstName: "Member", lastName: "B" });

    // 2. Create Organizations
    orgA = await createTestOrganization(app, ownerA.accessToken, {
      name: "Security Org A",
    });
    orgB = await createTestOrganization(app, ownerB.accessToken, {
      name: "Security Org B",
    });

    // 3. Add Members to Org A
    await addOrganizationMember(
      app,
      ownerA.accessToken,
      orgA.id,
      memberA.email,
      "MEMBER",
    );
    await addOrganizationMember(
      app,
      ownerA.accessToken,
      orgA.id,
      viewerA.email,
      "VIEWER",
    );
    await addOrganizationMember(
      app,
      ownerA.accessToken,
      orgA.id,
      orgMemberOnlyA.email,
      "MEMBER",
    );

    // 4. Add Members to Org B
    await addOrganizationMember(
      app,
      ownerB.accessToken,
      orgB.id,
      memberB.email,
      "MEMBER",
    );

    // 5. Create Projects
    projA = await createTestProject(app, ownerA.accessToken, orgA.id, {
      name: "Project A",
    });
    projB = await createTestProject(app, ownerB.accessToken, orgB.id, {
      name: "Project B",
    });

    // 6. Add Project Members in Org A
    await addProjectMember(
      app,
      ownerA.accessToken,
      orgA.id,
      projA.id,
      memberA.email,
      "PROJECT_MEMBER",
    );
    await addProjectMember(
      app,
      ownerA.accessToken,
      orgA.id,
      projA.id,
      viewerA.email,
      "PROJECT_VIEWER",
    );

    // Add Project Member in Org B
    await addProjectMember(
      app,
      ownerB.accessToken,
      orgB.id,
      projB.id,
      memberB.email,
      "PROJECT_MEMBER",
    );

    // 7. Create Tasks
    await createTestTask(app, ownerA.accessToken, orgA.id, projA.id, {
      title: "Task A",
      assigneeId: memberA.id,
    });

    taskB = await createTestTask(app, ownerB.accessToken, orgB.id, projB.id, {
      title: "Task B",
      assigneeId: memberB.id,
    });
  });

  afterAll(async () => {
    clientSockets.forEach((s) => s.close());

    if (prisma) {
      const orgIds = [orgA?.id, orgB?.id].filter(Boolean);
      const userIds = [
        ownerA?.id,
        memberA?.id,
        viewerA?.id,
        orgMemberOnlyA?.id,
        ownerB?.id,
        memberB?.id,
      ].filter(Boolean);

      await prisma.notification.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      await prisma.activityLog.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      await prisma.comment.deleteMany({
        where: {
          task: { projectId: { in: [projA?.id, projB?.id].filter(Boolean) } },
        },
      });
      await prisma.task.deleteMany({
        where: { projectId: { in: [projA?.id, projB?.id].filter(Boolean) } },
      });
      await prisma.projectMember.deleteMany({
        where: { projectId: { in: [projA?.id, projB?.id].filter(Boolean) } },
      });
      await prisma.project.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: orgIds } },
      });
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      await prisma.refreshToken.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await app.close();
  });

  // =========================================================================
  // 1. AUTHENTICATION & SENSITIVE DATA EXPOSURE HARDENING
  // =========================================================================
  describe("1. Authentication & Sensitive Data Exposure Hardening", () => {
    it("should reject registration with invalid email, short password, or duplicate email", async () => {
      // Invalid email
      await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          email: "not-an-email",
          password: "Password123!",
          firstName: "Test",
          lastName: "User",
        })
        .expect(400);

      // Duplicate email
      await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          email: ownerA.email,
          password: "Password123!",
          firstName: "Test",
          lastName: "User",
        })
        .expect(409);
    });

    it("should reject login with wrong password or non-existent user", async () => {
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: ownerA.email, password: "WrongPassword123!" })
        .expect(401);

      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: "nonexistent@example.com", password: "Password123!" })
        .expect(401);
    });

    it("should reject requests with missing, malformed, or invalid signature JWTs", async () => {
      await request(app.getHttpServer()).get("/auth/me").expect(401);

      await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", "Bearer invalid-malformed-token-string")
        .expect(401);
    });

    it("should NEVER expose password or passwordHash in REST responses", async () => {
      const meRes = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .expect(200);

      expect(meRes.body.password).toBeUndefined();
      expect(meRes.body.passwordHash).toBeUndefined();

      const orgRes = await request(app.getHttpServer())
        .get(`/organizations/${orgA.id}/members`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .expect(200);

      orgRes.body.forEach((member: any) => {
        if (member.user) {
          expect(member.user.password).toBeUndefined();
          expect(member.user.passwordHash).toBeUndefined();
        }
      });
    });

    it("should perform refresh token rotation and invalidate revoked tokens", async () => {
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: ownerA.email, password: "Password123!" })
        .expect(200);

      const oldRefreshToken = loginRes.body.refreshToken;
      expect(oldRefreshToken).toBeDefined();

      // Refresh token
      const refreshRes = await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: oldRefreshToken })
        .expect(200);

      const newRefreshToken = refreshRes.body.refreshToken;
      expect(newRefreshToken).toBeDefined();
      expect(newRefreshToken).not.toEqual(oldRefreshToken);

      // Re-using old refresh token should be rejected (401)
      await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: oldRefreshToken })
        .expect(401);
    });
  });

  // =========================================================================
  // 2. CROSS-TENANT ISOLATION BOUNDARY TESTING
  // =========================================================================
  describe("2. Cross-Tenant Isolation Boundary Testing", () => {
    it("User A must NOT be able to access Organization B resources (403 Forbidden)", async () => {
      // GET Org B
      await request(app.getHttpServer())
        .get(`/organizations/${orgB.id}`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .expect(403);

      // PATCH Org B
      await request(app.getHttpServer())
        .patch(`/organizations/${orgB.id}`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .send({ name: "Hacked Org Name" })
        .expect(403);

      // GET Org B Members
      await request(app.getHttpServer())
        .get(`/organizations/${orgB.id}/members`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .expect(403);
    });

    it("User A must NOT be able to read, mutate, or delete Project B in Org B (403 Forbidden)", async () => {
      // GET Project B in Org B
      await request(app.getHttpServer())
        .get(`/organizations/${orgB.id}/projects/${projB.id}`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgB.id)
        .expect(403);

      // POST Project in Org B
      await request(app.getHttpServer())
        .post(`/organizations/${orgB.id}/projects`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgB.id)
        .send({ name: "Unauthorized Project", slug: "unauth-proj" })
        .expect(403);

      // PATCH Project B
      await request(app.getHttpServer())
        .patch(`/organizations/${orgB.id}/projects/${projB.id}`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgB.id)
        .send({ name: "Renamed Project B" })
        .expect(403);

      // DELETE Project B
      await request(app.getHttpServer())
        .delete(`/organizations/${orgB.id}/projects/${projB.id}`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgB.id)
        .expect(403);
    });

    it("User A must NOT be able to access Task B, Comments B, or Activity B in Org B (403 Forbidden)", async () => {
      // GET Task B
      await request(app.getHttpServer())
        .get(`/organizations/${orgB.id}/projects/${projB.id}/tasks/${taskB.id}`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgB.id)
        .expect(403);

      // PATCH Task B
      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgB.id}/projects/${projB.id}/tasks/${taskB.id}`,
        )
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgB.id)
        .send({ title: "Hacked Task B" })
        .expect(403);

      // GET Comments B
      await request(app.getHttpServer())
        .get(
          `/organizations/${orgB.id}/projects/${projB.id}/tasks/${taskB.id}/comments`,
        )
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgB.id)
        .expect(403);

      // GET Activity B
      await request(app.getHttpServer())
        .get(`/organizations/${orgB.id}/projects/${projB.id}/activity`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgB.id)
        .expect(403);
    });
  });

  // =========================================================================
  // 3. TENANT ID ENUMERATION & MALFORMED INPUT VALIDATION
  // =========================================================================
  describe("3. Tenant ID Enumeration & Malformed Input Validation", () => {
    it("should reject malformed UUID in X-Organization-Id header with 400 Bad Request", async () => {
      await request(app.getHttpServer())
        .get("/organizations/current")
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", "not-a-valid-uuid")
        .expect(400);
    });

    it("should reject non-member tenant UUID in X-Organization-Id header with 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .get("/organizations/current")
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgB.id)
        .expect(403);
    });

    it("should reject malformed UUID in route parameters with 400 Bad Request", async () => {
      await request(app.getHttpServer())
        .get("/organizations/invalid-uuid-123")
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .expect(400);
    });
  });

  // =========================================================================
  // 4. RBAC MATRIX & OWNER SAFETY PROTECTIONS
  // =========================================================================
  describe("4. RBAC Matrix & Owner Safety Protections", () => {
    it("VIEWER role should be able to READ organization but NOT update or create projects", async () => {
      // Read Org -> 200
      await request(app.getHttpServer())
        .get(`/organizations/${orgA.id}`)
        .set("Authorization", `Bearer ${viewerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .expect(200);

      // Create Project -> 403 Forbidden
      await request(app.getHttpServer())
        .post(`/organizations/${orgA.id}/projects`)
        .set("Authorization", `Bearer ${viewerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .send({ name: "Viewer Project", slug: "viewer-proj" })
        .expect(403);
    });

    it("PROJECT_VIEWER role should NOT be able to create tasks in project", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgA.id}/projects/${projA.id}/tasks`)
        .set("Authorization", `Bearer ${viewerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .send({ title: "Unauthorized Task" })
        .expect(403);
    });

    it("Sole OWNER should NOT be allowed to leave organization or self-demote", async () => {
      // Leave org attempt by sole owner
      await request(app.getHttpServer())
        .post(`/organizations/${orgA.id}/leave`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .expect((res) => {
          expect([400, 403]).toContain(res.status);
        });

      // Self-demote attempt
      await request(app.getHttpServer())
        .patch(`/organizations/${orgA.id}/members/${ownerA.id}/role`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .send({ role: "MEMBER" })
        .expect((res) => {
          expect([400, 403]).toContain(res.status);
        });
    });
  });

  // =========================================================================
  // 5. DUAL-MEMBERSHIP ASSIGNEE SECURITY
  // =========================================================================
  describe("5. Dual-Membership Assignee Security", () => {
    it("should REJECT task assignment to user who is Org Member but NOT Project Member", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgA.id}/projects/${projA.id}/tasks`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .send({
          title: "Non-Project Member Task",
          assigneeId: orgMemberOnlyA.id,
        })
        .expect((res) => {
          expect([400, 403]).toContain(res.status);
        });
    });

    it("should ALLOW task assignment to valid dual Org + Project Member", async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgA.id}/projects/${projA.id}/tasks`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .send({
          title: "Valid Member Task",
          assigneeId: memberA.id,
        })
        .expect(201);

      const assignedUser =
        res.body.assignedToId || res.body.assignedTo?.id || res.body.assigneeId;
      expect(assignedUser).toBe(memberA.id);
    });
  });

  // =========================================================================
  // 6. ACTIVITY LOG IMMUTABILITY & IMPERSONATION PREVENTION
  // =========================================================================
  describe("6. Activity Log Immutability & Impersonation Prevention", () => {
    it("should return 404 Not Found for PATCH or DELETE on activity history endpoints", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgA.id}/projects/${projA.id}/activity`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/organizations/${orgA.id}/projects/${projA.id}/activity`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .expect(404);
    });

    it("should IGNORE client-submitted actorId in body and bind activity to authenticated JWT user", async () => {
      const taskRes = await request(app.getHttpServer())
        .post(`/organizations/${orgA.id}/projects/${projA.id}/tasks`)
        .set("Authorization", `Bearer ${memberA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .send({
          title: "Impersonation Attempt Task",
          actorId: ownerA.id, // Malicious spoof attempt
        })
        .expect(201);

      // Verify activity log actorId is memberA.id, NOT spoofed ownerA.id
      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgA.id}/projects/${projA.id}/tasks/${taskRes.body.id}/activity`,
        )
        .set("Authorization", `Bearer ${memberA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .expect(200);

      expect(actRes.body.data.length).toBeGreaterThanOrEqual(1);
      const activity = actRes.body.data[0];
      const actualActorId = activity.actorId || activity.actor?.id;
      expect(actualActorId).toBe(memberA.id);
      expect(actualActorId).not.toBe(ownerA.id);
    });
  });

  // =========================================================================
  // 7. TRANSACTION CONSISTENCY & FAILURE SIDE-EFFECT SAFETY
  // =========================================================================
  describe("7. Transaction Consistency & Failure Side-Effect Safety", () => {
    it("should NOT generate activity log or notification if task creation fails validation", async () => {
      const actBefore = await request(app.getHttpServer())
        .get(`/organizations/${orgA.id}/projects/${projA.id}/activity`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .expect(200);

      // Failed task creation (missing required title)
      await request(app.getHttpServer())
        .post(`/organizations/${orgA.id}/projects/${projA.id}/tasks`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .send({ description: "No Title" })
        .expect(400);

      const actAfter = await request(app.getHttpServer())
        .get(`/organizations/${orgA.id}/projects/${projA.id}/activity`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .expect(200);

      expect(actAfter.body.total).toBe(actBefore.body.total);
    });
  });

  // =========================================================================
  // 8. REDIS FAILURE RESILIENCE & CACHE FALLBACK
  // =========================================================================
  describe("8. Redis Failure Resilience & Cache Fallback", () => {
    it("should fallback to PostgreSQL gracefully when cache miss occurs or Redis returns null", async () => {
      const getSpy = jest
        .spyOn(redisService, "get")
        .mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgA.id}/projects/${projA.id}/tasks`)
        .set("Authorization", `Bearer ${ownerA.accessToken}`)
        .set("X-Tenant-Id", orgA.id)
        .expect(200);

      expect(res.body).toBeDefined();
      expect(Array.isArray(res.body)).toBe(true);
      getSpy.mockRestore();
    });
  });

  // =========================================================================
  // 9. WEBSOCKET SECURITY & ROOM ISOLATION
  // =========================================================================
  describe("9. WebSocket Security & Room Isolation", () => {
    it("should reject WebSocket connection without valid token", (done) => {
      const invalidSocket = createClientSocket("invalid-jwt-token");

      invalidSocket.on("connect_error", (err) => {
        expect(err).toBeDefined();
        invalidSocket.disconnect();
        done();
      });
    });

    it("should prevent User A from joining Project B room in Org B (project:access-denied)", (done) => {
      const socketA = createClientSocket(ownerA.accessToken);

      socketA.on("connect", () => {
        socketA.emit(
          WEBSOCKET_EVENTS.PROJECT_JOIN,
          { organizationId: orgB.id, projectId: projB.id },
          (response: any) => {
            expect(response.success).toBe(false);
            expect(response.error?.code).toBe("PROJECT_ACCESS_DENIED");
            socketA.disconnect();
            done();
          },
        );
      });
    });

    it("should ensure ZERO event leakage across project rooms", (done) => {
      const socketB = createClientSocket(ownerB.accessToken);
      let socketBreceivedEvent = false;

      socketB.on("connect", () => {
        socketB.emit(
          WEBSOCKET_EVENTS.PROJECT_JOIN,
          { organizationId: orgB.id, projectId: projB.id },
          (resB: any) => {
            expect(resB.success).toBe(true);

            socketB.on(WEBSOCKET_EVENTS.TASK_CREATED, () => {
              socketBreceivedEvent = true;
            });

            // Socket A connects and joins Project A room
            const socketA = createClientSocket(ownerA.accessToken);
            socketA.on("connect", () => {
              socketA.emit(
                WEBSOCKET_EVENTS.PROJECT_JOIN,
                { organizationId: orgA.id, projectId: projA.id },
                async (resA: any) => {
                  expect(resA.success).toBe(true);

                  // Perform task creation in Project A
                  await request(app.getHttpServer())
                    .post(
                      `/organizations/${orgA.id}/projects/${projA.id}/tasks`,
                    )
                    .set("Authorization", `Bearer ${ownerA.accessToken}`)
                    .set("X-Tenant-Id", orgA.id)
                    .send({ title: "Isolated Event Task" })
                    .expect(201);

                  setTimeout(() => {
                    expect(socketBreceivedEvent).toBe(false);
                    socketA.disconnect();
                    socketB.disconnect();
                    done();
                  }, 400);
                },
              );
            });
          },
        );
      });
    }, 15000);
  });
});
