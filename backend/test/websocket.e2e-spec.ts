import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { io, Socket as ClientSocket } from "socket.io-client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import {
  WEBSOCKET_EVENTS,
  WEBSOCKET_ERROR_CODES,
} from "../src/websocket/websocket.constants";

describe("WebSockets & Real-Time Collaboration (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let serverPort: number;
  let wsUrl: string;

  // Test users & tokens
  const userAData = {
    email: `ws-usera-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "WSUser",
    lastName: "A",
  };

  const userBData = {
    email: `ws-userb-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "WSUser",
    lastName: "B",
  };

  const userOrg2Data = {
    email: `ws-org2-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "WSUser",
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
  let project2Id: string;

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
      .send({ name: "WS Test Org 1", slug: `ws-test-org-1-${Date.now()}` })
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
      .send({ name: "WS Test Org 2", slug: `ws-test-org-2-${Date.now()}` })
      .expect(201);
    org2Id = resOrg2Obj.body.id;

    // User A creates Project 1 in Org 1
    const resProj1 = await request(app.getHttpServer())
      .post(`/organizations/${org1Id}/projects`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "WS Project 1", slug: `wsp1-${Date.now()}` })
      .expect(201);
    project1Id = resProj1.body.id;

    // Add User B to Project 1 as PROJECT_MEMBER
    await request(app.getHttpServer())
      .post(`/organizations/${org1Id}/projects/${project1Id}/members`)
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ email: userBData.email, role: "PROJECT_MEMBER" })
      .expect(201);

    // User Org2 creates Project 2 in Org 2
    const resProj2 = await request(app.getHttpServer())
      .post(`/organizations/${org2Id}/projects`)
      .set("Authorization", `Bearer ${tokenOrg2}`)
      .send({ name: "WS Project 2", slug: `wsp2-${Date.now()}` })
      .expect(201);
    project2Id = resProj2.body.id;
  });

  afterAll(async () => {
    clientSockets.forEach((s) => s.close());

    // Cleanup database
    if (org1Id || org2Id) {
      await prisma.activityLog.deleteMany({
        where: { organizationId: { in: [org1Id, org2Id].filter(Boolean) } },
      });
      await prisma.comment.deleteMany({
        where: {
          task: { projectId: { in: [project1Id, project2Id].filter(Boolean) } },
        },
      });
      await prisma.task.deleteMany({
        where: { projectId: { in: [project1Id, project2Id].filter(Boolean) } },
      });
      await prisma.projectMember.deleteMany({
        where: { projectId: { in: [project1Id, project2Id].filter(Boolean) } },
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

  describe("Connection Authentication", () => {
    it("should reject connection without token", (done) => {
      const socket = createClientSocket();

      socket.on("connect_error", () => {
        done();
      });

      socket.on("connect", () => {
        done(new Error("Socket should not have connected without token"));
      });
    });

    it("should reject connection with invalid token", (done) => {
      const socket = createClientSocket("invalid-jwt-token");

      socket.on("connect_error", () => {
        done();
      });

      socket.on("connect", () => {
        done(new Error("Socket should not have connected with invalid token"));
      });
    });

    it("should successfully connect with valid JWT token", (done) => {
      const socket = createClientSocket(tokenA);

      socket.on("connect", () => {
        expect(socket.connected).toBe(true);
        done();
      });
    });
  });

  describe("Tenant Isolation & Room Access", () => {
    it("should reject room join if user belongs to another organization (cross-tenant attack)", (done) => {
      const socket = createClientSocket(tokenOrg2);

      socket.on("connect", () => {
        socket.emit(
          WEBSOCKET_EVENTS.PROJECT_JOIN,
          { organizationId: org1Id, projectId: project1Id },
          (response: any) => {
            expect(response.success).toBe(false);
            expect(response.error.code).toBe(
              WEBSOCKET_ERROR_CODES.PROJECT_ACCESS_DENIED,
            );
            done();
          },
        );
      });
    });

    it("should reject room join if user is in organization but not in project", async () => {
      // Create Project 3 in Org 1 where User B is NOT a member
      const resProj3 = await request(app.getHttpServer())
        .post(`/organizations/${org1Id}/projects`)
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Tenant-Id", org1Id)
        .send({ name: "WS Project 3", slug: `wsp3-${Date.now()}` })
        .expect(201);
      const project3Id = resProj3.body.id;

      return new Promise<void>((resolve) => {
        const socket = createClientSocket(tokenB);

        socket.on("connect", () => {
          socket.emit(
            WEBSOCKET_EVENTS.PROJECT_JOIN,
            { organizationId: org1Id, projectId: project3Id },
            (response: any) => {
              expect(response.success).toBe(false);
              expect(response.error.code).toBe(
                WEBSOCKET_ERROR_CODES.PROJECT_ACCESS_DENIED,
              );

              // Clean up project 3
              prisma.projectMember
                .deleteMany({ where: { projectId: project3Id } })
                .then(() =>
                  prisma.project.delete({ where: { id: project3Id } }),
                )
                .then(() => resolve());
            },
          );
        });
      });
    });

    it("should allow room join for valid organization and project member", (done) => {
      const socket = createClientSocket(tokenB);

      socket.on("connect", () => {
        socket.emit(
          WEBSOCKET_EVENTS.PROJECT_JOIN,
          { organizationId: org1Id, projectId: project1Id },
          (response: any) => {
            expect(response.success).toBe(true);
            expect(response.room).toBe(
              `organization:${org1Id}:project:${project1Id}`,
            );
            done();
          },
        );
      });
    });
  });

  describe("Real-Time REST Mutation Broadcasts", () => {
    it("should broadcast task:created to project room when task is created via REST API", (done) => {
      const socketListener = createClientSocket(tokenB);

      socketListener.on("connect", () => {
        socketListener.emit(
          WEBSOCKET_EVENTS.PROJECT_JOIN,
          { organizationId: org1Id, projectId: project1Id },
          async (joinRes: any) => {
            expect(joinRes.success).toBe(true);

            socketListener.once(WEBSOCKET_EVENTS.TASK_CREATED, (event: any) => {
              expect(event).toBeDefined();
              expect(event.eventId).toBeDefined();
              expect(event.timestamp).toBeDefined();
              expect(event.type).toBe(WEBSOCKET_EVENTS.TASK_CREATED);
              expect(event.organizationId).toBe(org1Id);
              expect(event.projectId).toBe(project1Id);
              expect(event.data).toBeDefined();
              expect(event.data.title).toBe("WS Broadcast Test Task");
              // Ensure password / sensitive data is sanitized
              expect(event.data.creator?.password).toBeUndefined();
              done();
            });

            // Trigger REST API call from User A
            await request(app.getHttpServer())
              .post(`/organizations/${org1Id}/projects/${project1Id}/tasks`)
              .set("Authorization", `Bearer ${tokenA}`)
              .set("X-Tenant-Id", org1Id)
              .send({
                title: "WS Broadcast Test Task",
                description: "Testing WebSocket real-time delivery",
              })
              .expect(201);
          },
        );
      });
    });

    it("should broadcast comment:created to project room when comment is added via REST API", (done) => {
      let createdTaskId: string;

      const socketListener = createClientSocket(tokenB);

      socketListener.on("connect", async () => {
        // First create a task
        const taskRes = await request(app.getHttpServer())
          .post(`/organizations/${org1Id}/projects/${project1Id}/tasks`)
          .set("Authorization", `Bearer ${tokenA}`)
          .set("X-Tenant-Id", org1Id)
          .send({ title: "Task For Comment WS Test" })
          .expect(201);
        createdTaskId = taskRes.body.id;

        socketListener.emit(
          WEBSOCKET_EVENTS.PROJECT_JOIN,
          { organizationId: org1Id, projectId: project1Id },
          async () => {
            socketListener.once(
              WEBSOCKET_EVENTS.COMMENT_CREATED,
              (event: any) => {
                expect(event).toBeDefined();
                expect(event.type).toBe(WEBSOCKET_EVENTS.COMMENT_CREATED);
                expect(event.organizationId).toBe(org1Id);
                expect(event.projectId).toBe(project1Id);
                expect(event.taskId).toBe(createdTaskId);
                expect(event.data.content).toBe("Real-time WS comment");
                done();
              },
            );

            // Post comment via REST API
            await request(app.getHttpServer())
              .post(
                `/organizations/${org1Id}/projects/${project1Id}/tasks/${createdTaskId}/comments`,
              )
              .set("Authorization", `Bearer ${tokenA}`)
              .set("X-Tenant-Id", org1Id)
              .send({ content: "Real-time WS comment" })
              .expect(201);
          },
        );
      });
    });
  });
});
