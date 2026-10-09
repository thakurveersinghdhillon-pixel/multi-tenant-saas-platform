import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";

describe("Organization & Member Management (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Test Users
  const userAData = {
    email: `usera-orgmem-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "User",
    lastName: "A",
  };

  const userBData = {
    email: `userb-orgmem-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "User",
    lastName: "B",
  };

  const userCData = {
    email: `userc-orgmem-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "User",
    lastName: "C",
  };

  const tenantBUserData = {
    email: `tenantb-user-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Tenant",
    lastName: "BUser",
  };

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let tokenTenantB: string;

  let idA: string;
  let idB: string;
  let idC: string;
  let idTenantB: string;

  let orgIdA: string;
  let orgIdB: string;

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

    // 1. Register users
    const resA = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userAData)
      .expect(201);
    tokenA = resA.body.accessToken;
    idA = resA.body.user.id;

    const resB = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userBData)
      .expect(201);
    tokenB = resB.body.accessToken;
    idB = resB.body.user.id;

    const resC = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userCData)
      .expect(201);
    tokenC = resC.body.accessToken;
    idC = resC.body.user.id;

    const resTenantB = await request(app.getHttpServer())
      .post("/auth/register")
      .send(tenantBUserData)
      .expect(201);
    tokenTenantB = resTenantB.body.accessToken;
    idTenantB = resTenantB.body.user.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (orgIdA) {
        await prisma.organizationMember.deleteMany({
          where: { organizationId: orgIdA },
        });
        await prisma.organization
          .delete({ where: { id: orgIdA } })
          .catch(() => {});
      }
      if (orgIdB) {
        await prisma.organizationMember.deleteMany({
          where: { organizationId: orgIdB },
        });
        await prisma.organization
          .delete({ where: { id: orgIdB } })
          .catch(() => {});
      }
      const uids = [idA, idB, idC, idTenantB];
      for (const uid of uids) {
        if (uid) {
          await prisma.refreshToken.deleteMany({ where: { userId: uid } });
          await prisma.user.delete({ where: { id: uid } }).catch(() => {});
        }
      }
      await prisma.$disconnect();
    }
    await app.close();
  });

  describe("Organization Creation & Initial Binding", () => {
    it("1. User A creates Organization A and becomes OWNER", async () => {
      const res = await request(app.getHttpServer())
        .post("/organizations")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          name: "Organization A",
          slug: `org-a-mem-${Date.now()}`,
        })
        .expect(201);

      orgIdA = res.body.id;
      expect(res.body.role).toBe("OWNER");
    });

    it("User TenantB creates Organization B", async () => {
      const res = await request(app.getHttpServer())
        .post("/organizations")
        .set("Authorization", `Bearer ${tokenTenantB}`)
        .send({
          name: "Organization B",
          slug: `org-b-mem-${Date.now()}`,
        })
        .expect(201);

      orgIdB = res.body.id;
    });
  });

  describe("Member Addition & Access Rights", () => {
    it("2. User A adds User B as MEMBER by email -> 201 Created", async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/members`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          email: userBData.email,
          role: "MEMBER",
        })
        .expect(201);

      expect(res.body.userId).toBe(idB);
      expect(res.body.role).toBe("MEMBER");
      expect(res.body.email).toBe(userBData.email);
    });

    it("Adding duplicate member should fail -> 409 Conflict", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/members`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          email: userBData.email,
          role: "MEMBER",
        })
        .expect(409);
    });

    it("Adding nonexistent user by email should fail -> 404 Not Found", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/members`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          email: "nonexistent-user-xyz-12345@example.com",
          role: "MEMBER",
        })
        .expect(404);
    });

    it("3. User B can access Organization A details according to MEMBER permissions -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.id).toBe(orgIdA);
    });

    it("4. User B (MEMBER) cannot add members -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/members`)
        .set("Authorization", `Bearer ${tokenB}`)
        .send({
          email: userCData.email,
          role: "MEMBER",
        })
        .expect(403);
    });

    it("5. User A adds User C as VIEWER by email -> 201 Created", async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/members`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          email: userCData.email,
          role: "VIEWER",
        })
        .expect(201);

      expect(res.body.userId).toBe(idC);
      expect(res.body.role).toBe("VIEWER");
    });

    it("6. User C (VIEWER) can read org details but cannot update org -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenC}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenC}`)
        .send({ name: "Hacked by Viewer" })
        .expect(403);
    });
  });

  describe("Member Removal & Access Revocation", () => {
    it("7. User A removes User B from Organization A -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/organizations/${orgIdA}/members/${idB}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.userId).toBe(idB);
      expect(res.body.message).toContain("successfully removed");
    });

    it("8. User B attempts accessing Organization A after removal -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenB}`)
        .expect(403);
    });
  });

  describe("Tenant Isolation & Cross-Tenant Security", () => {
    it("9. User A remains isolated from Organization B -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdB}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(403);
    });

    it("10. User A cannot remove members from Organization B -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .delete(`/organizations/${orgIdB}/members/${idTenantB}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(403);
    });

    it("User A cannot add members to Organization B -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdB}/members`)
        .set("Authorization", `Bearer ${tokenA}`)
        .send({
          email: userBData.email,
          role: "MEMBER",
        })
        .expect(403);
    });
  });

  describe("Ownership Protection Rules & Leaving Organization", () => {
    it("11. User A (sole OWNER) attempts removing self -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .delete(`/organizations/${orgIdA}/members/${idA}`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(403);
    });

    it("11b. User A (sole OWNER) attempts leaving Organization A -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/leave`)
        .set("Authorization", `Bearer ${tokenA}`)
        .expect(403);
    });

    it("12. User C (VIEWER) leaves Organization A -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/leave`)
        .set("Authorization", `Bearer ${tokenC}`)
        .expect(200);

      expect(res.body.message).toContain("Successfully left");
    });

    it("User C leaving Organization A does not delete User C account or affect other memberships", async () => {
      const profile = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${tokenC}`)
        .expect(200);

      expect(profile.body.id).toBe(idC);
    });
  });
});
