import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { CacheKeys } from "../src/redis/cache-keys";

describe("Redis Caching & Performance (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redisService: RedisService;

  const timestamp = Date.now();
  const userAData = {
    email: `cache-user-a-${timestamp}@example.com`,
    password: "Password123!",
    firstName: "Cache",
    lastName: "UserA",
  };

  const userBData = {
    email: `cache-user-b-${timestamp}@example.com`,
    password: "Password123!",
    firstName: "Cache",
    lastName: "UserB",
  };

  let tokenA: string;
  let tokenB: string;
  let orgIdA: string;
  let orgIdB: string;
  let projectIdA: string;
  let taskIdA: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    redisService = app.get<RedisService>(RedisService);

    // Register User A & Org A
    const resA = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userAData)
      .expect(201);
    tokenA = resA.body.accessToken;

    const orgResA = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: `Org A ${timestamp}`, slug: `org-a-${timestamp}` })
      .expect(201);
    orgIdA = orgResA.body.id;

    // Register User B & Org B
    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userBData)
      .expect(201);
    tokenB = resB.body.accessToken;

    const orgResB = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ name: `Org B ${timestamp}`, slug: `org-b-${timestamp}` })
      .expect(201);
    orgIdB = orgResB.body.id;
  });

  afterAll(async () => {
    if (orgIdA) {
      await prisma.activityLog.deleteMany({
        where: { organizationId: orgIdA },
      });
      await prisma.task.deleteMany({
        where: { project: { organizationId: orgIdA } },
      });
      await prisma.projectMember.deleteMany({
        where: { project: { organizationId: orgIdA } },
      });
      await prisma.project.deleteMany({ where: { organizationId: orgIdA } });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: orgIdA },
      });
      await prisma.organization.delete({ where: { id: orgIdA } });
    }
    if (orgIdB) {
      await prisma.activityLog.deleteMany({
        where: { organizationId: orgIdB },
      });
      await prisma.task.deleteMany({
        where: { project: { organizationId: orgIdB } },
      });
      await prisma.projectMember.deleteMany({
        where: { project: { organizationId: orgIdB } },
      });
      await prisma.project.deleteMany({ where: { organizationId: orgIdB } });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: orgIdB },
      });
      await prisma.organization.delete({ where: { id: orgIdB } });
    }
    await prisma.user.deleteMany({
      where: { email: { in: [userAData.email, userBData.email] } },
    });

    await app.close();
  });

  describe("Project & Task Caching Workflow", () => {
    it("1. Should create a project in Org A and invalidate org project list cache", async () => {
      const createRes = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Cached Project A",
          slug: `cached-proj-a-${timestamp}`,
          description: "Project for testing cache",
        })
        .expect(201);

      projectIdA = createRes.body.id;
      expect(projectIdA).toBeDefined();

      const cachedDetail = await redisService.get(
        CacheKeys.projectDetail(orgIdA, projectIdA),
      );
      expect(cachedDetail).toBeNull();
    });

    it("2. Should cache project list on GET (Cache MISS then HIT)", async () => {
      const listKey = CacheKeys.projectList(orgIdA);

      await redisService.del(listKey);
      expect(await redisService.get(listKey)).toBeNull();

      const res1 = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res1.body.length).toBeGreaterThanOrEqual(1);

      const cachedData = await redisService.get<any[]>(listKey);
      expect(cachedData).not.toBeNull();
      expect(cachedData.length).toEqual(res1.body.length);

      const res2 = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res2.body).toEqual(res1.body);
    });

    it("3. Should cache project detail on GET (Cache MISS then HIT)", async () => {
      const detailKey = CacheKeys.projectDetail(orgIdA, projectIdA);

      const res1 = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projectIdA}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res1.body.id).toBe(projectIdA);

      const cached1 = await redisService.get<any>(detailKey);
      expect(cached1).not.toBeNull();
      expect(cached1.id).toBe(projectIdA);

      const res2 = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projectIdA}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res2.body.name).toBe("Cached Project A");
    });

    it("4. Should create a task and populate/invalidate task caches", async () => {
      const createRes = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projectIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          title: "Cached Task 1",
          description: "Testing task caching",
          priority: "HIGH",
        })
        .expect(201);

      taskIdA = createRes.body.id;
      expect(taskIdA).toBeDefined();

      const taskListKey = CacheKeys.taskList(orgIdA, projectIdA);
      const res1 = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projectIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res1.body.length).toBe(1);
      const cachedTasks = await redisService.get<any[]>(taskListKey);
      expect(cachedTasks).not.toBeNull();

      const boardKey = CacheKeys.taskBoard(orgIdA, projectIdA);
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projectIdA}/tasks/board`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      const cachedBoard = await redisService.get<any>(boardKey);
      expect(cachedBoard).not.toBeNull();
      expect(cachedBoard.TODO.length).toBe(1);
    });

    it("5. Should invalidate task and board caches upon updating task", async () => {
      const boardKey = CacheKeys.taskBoard(orgIdA, projectIdA);
      const taskDetailKey = CacheKeys.taskDetail(orgIdA, projectIdA, taskIdA);

      expect(await redisService.get(boardKey)).not.toBeNull();

      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projectIdA}/tasks/${taskIdA}/status`,
        )
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ status: "IN_PROGRESS" })
        .expect(200);

      expect(await redisService.get(boardKey)).toBeNull();
      expect(await redisService.get(taskDetailKey)).toBeNull();

      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projectIdA}/tasks/${taskIdA}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.status).toBe("IN_PROGRESS");
    });

    it("6. Should enforce strict tenant cache isolation between Org A and Org B", async () => {
      const projResB = await request(app.getHttpServer())
        .post(`/organizations/${orgIdB}/projects`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          name: "Org B Project",
          slug: `orgb-proj-${timestamp}`,
        })
        .expect(201);

      const projectIdB = projResB.body.id;

      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/organizations/${orgIdB}/projects`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);

      const keyA = CacheKeys.projectList(orgIdA);
      const keyB = CacheKeys.projectList(orgIdB);

      expect(keyA).not.toEqual(keyB);

      const cachedA = await redisService.get<any[]>(keyA);
      const cachedB = await redisService.get<any[]>(keyB);

      expect(cachedA).not.toBeNull();
      expect(cachedB).not.toBeNull();
      expect(cachedA.some((p) => p.id === projectIdA)).toBe(true);
      expect(cachedA.some((p) => p.id === projectIdB)).toBe(false);

      expect(cachedB.some((p) => p.id === projectIdB)).toBe(true);
      expect(cachedB.some((p) => p.id === projectIdA)).toBe(false);
    });
  });
});
