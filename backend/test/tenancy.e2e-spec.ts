import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";

describe("Multi-Tenancy & Tenant Isolation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const userA = {
    email: `usera-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "User",
    lastName: "A",
  };

  const userB = {
    email: `userb-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "User",
    lastName: "B",
  };

  let tokenA: string;
  let tokenB: string;
  let userIdA: string;
  let userIdB: string;

  let orgIdA: string;
  let orgIdB: string;
  const slugA = `org-a-${Date.now()}`;
  const slugB = `org-b-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // Register User A
    const resA = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userA)
      .expect(201);
    tokenA = resA.body.accessToken;
    userIdA = resA.body.user.id;

    // Register User B
    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userB)
      .expect(201);
    tokenB = resB.body.accessToken;
    userIdB = resB.body.user.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (orgIdA) {
        await prisma.organization
          .delete({ where: { id: orgIdA } })
          .catch(() => {});
      }
      if (orgIdB) {
        await prisma.organization
          .delete({ where: { id: orgIdB } })
          .catch(() => {});
      }
      if (userIdA) {
        await prisma.refreshToken.deleteMany({ where: { userId: userIdA } });
        await prisma.user.delete({ where: { id: userIdA } }).catch(() => {});
      }
      if (userIdB) {
        await prisma.refreshToken.deleteMany({ where: { userId: userIdB } });
        await prisma.user.delete({ where: { id: userIdB } }).catch(() => {});
      }
      await prisma.$disconnect();
    }
    await app.close();
  });

  describe("Organization Creation & Binding", () => {
    it("User A should create Organization A and become OWNER", async () => {
      const response = await request(app.getHttpServer())
        .post("/organizations")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Organization A",
          slug: slugA,
          description: "Tenant A Description",
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.slug).toBe(slugA);
      expect(response.body.role).toBe("OWNER");
      orgIdA = response.body.id;
    });

    it("User B should create Organization B and become OWNER", async () => {
      const response = await request(app.getHttpServer())
        .post("/organizations")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          name: "Organization B",
          slug: slugB,
          description: "Tenant B Description",
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.slug).toBe(slugB);
      expect(response.body.role).toBe("OWNER");
      orgIdB = response.body.id;
    });

    it("should reject creation of Organization with duplicate slug (409 Conflict)", async () => {
      await request(app.getHttpServer())
        .post("/organizations")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Duplicate Org",
          slug: slugA,
        })
        .expect(409);
    });
  });

  describe("Organization List Scoping", () => {
    it("User A listing organizations should only return Organization A", async () => {
      const response = await request(app.getHttpServer())
        .get("/organizations")
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(orgIdA);
    });

    it("User B listing organizations should only return Organization B", async () => {
      const response = await request(app.getHttpServer())
        .get("/organizations")
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe(orgIdB);
    });
  });

  describe("Cross-Tenant Access Isolation Matrix", () => {
    it("User A accessing Organization A -> 200 SUCCESS", async () => {
      const response = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(response.body.id).toBe(orgIdA);
    });

    it("User B accessing Organization B -> 200 SUCCESS", async () => {
      const response = await request(app.getHttpServer())
        .get(`/organizations/${orgIdB}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);

      expect(response.body.id).toBe(orgIdB);
    });

    it("User A attempting to access Organization B -> 403 FORBIDDEN", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdB}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(403);
    });

    it("User B attempting to access Organization A -> 403 FORBIDDEN", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(403);
    });

    it("User A requesting members of Organization B -> 403 FORBIDDEN", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdB}/members`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(403);
    });
  });

  describe("Current Organization Endpoint & Header Validation", () => {
    it("User A requesting /organizations/current with X-Organization-Id: orgIdA -> 200 SUCCESS", async () => {
      const response = await request(app.getHttpServer())
        .get("/organizations/current")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Organization-Id", orgIdA)
        .expect(200);

      expect(response.body.organization.id).toBe(orgIdA);
      expect(response.body.role).toBe("OWNER");
    });

    it("User A requesting /organizations/current with X-Organization-Id: orgIdB -> 403 FORBIDDEN", async () => {
      await request(app.getHttpServer())
        .get("/organizations/current")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Organization-Id", orgIdB)
        .expect(403);
    });

    it("Requesting /organizations/current without X-Organization-Id header -> 400 Bad Request", async () => {
      await request(app.getHttpServer())
        .get("/organizations/current")
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(400);
    });

    it("Requesting /organizations/current with malformed non-UUID header -> 400 Bad Request", async () => {
      await request(app.getHttpServer())
        .get("/organizations/current")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Organization-Id", "not-a-uuid")
        .expect(400);
    });

    it("Requesting /organizations/current with valid UUID of nonexistent organization -> 404 Not Found", async () => {
      const nonexistentUuid = "00000000-0000-0000-0000-000000000000";
      await request(app.getHttpServer())
        .get("/organizations/current")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("X-Organization-Id", nonexistentUuid)
        .expect(404);
    });
  });
});
