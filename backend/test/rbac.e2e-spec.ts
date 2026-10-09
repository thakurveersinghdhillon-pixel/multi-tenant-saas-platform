import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";

describe("Role-Based Access Control - RBAC (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Test Users
  const ownerData = {
    email: `owner-rbac-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Owner",
    lastName: "User",
  };

  const adminData = {
    email: `admin-rbac-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Admin",
    lastName: "User",
  };

  const memberData = {
    email: `member-rbac-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Member",
    lastName: "User",
  };

  const viewerData = {
    email: `viewer-rbac-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Viewer",
    lastName: "User",
  };

  const tenantBData = {
    email: `tenantb-rbac-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "TenantB",
    lastName: "User",
  };

  let tokenOwner: string;
  let tokenAdmin: string;
  let tokenMember: string;
  let tokenViewer: string;
  let tokenTenantB: string;

  let idOwner: string;
  let idAdmin: string;
  let idMember: string;
  let idViewer: string;
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
    const resOwner = await request(app.getHttpServer())
      .post("/auth/register")
      .send(ownerData)
      .expect(201);
    tokenOwner = resOwner.body.accessToken;
    idOwner = resOwner.body.user.id;

    const resAdmin = await request(app.getHttpServer())
      .post("/auth/register")
      .send(adminData)
      .expect(201);
    tokenAdmin = resAdmin.body.accessToken;
    idAdmin = resAdmin.body.user.id;

    const resMember = await request(app.getHttpServer())
      .post("/auth/register")
      .send(memberData)
      .expect(201);
    tokenMember = resMember.body.accessToken;
    idMember = resMember.body.user.id;

    const resViewer = await request(app.getHttpServer())
      .post("/auth/register")
      .send(viewerData)
      .expect(201);
    tokenViewer = resViewer.body.accessToken;
    idViewer = resViewer.body.user.id;

    const resTenantB = await request(app.getHttpServer())
      .post("/auth/register")
      .send(tenantBData)
      .expect(201);
    tokenTenantB = resTenantB.body.accessToken;
    idTenantB = resTenantB.body.user.id;

    // 2. Create Organization A (owner becomes OWNER)
    const resOrgA = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({
        name: "RBAC Test Org A",
        slug: `rbac-org-a-${Date.now()}`,
      })
      .expect(201);
    orgIdA = resOrgA.body.id;

    // 3. Create Organization B (Tenant B)
    const resOrgB = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenTenantB}`)
      .send({
        name: "RBAC Test Org B",
        slug: `rbac-org-b-${Date.now()}`,
      })
      .expect(201);
    orgIdB = resOrgB.body.id;

    // 4. Fetch System Roles from DB
    const adminRole = await prisma.role.findFirst({
      where: { name: "ADMIN", organizationId: null },
    });
    const memberRole = await prisma.role.findFirst({
      where: { name: "MEMBER", organizationId: null },
    });
    const viewerRole = await prisma.role.findFirst({
      where: { name: "VIEWER", organizationId: null },
    });

    // 5. Add Admin, Member, Viewer to Org A
    await prisma.organizationMember.create({
      data: { organizationId: orgIdA, userId: idAdmin, roleId: adminRole!.id },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: orgIdA,
        userId: idMember,
        roleId: memberRole!.id,
      },
    });
    await prisma.organizationMember.create({
      data: {
        organizationId: orgIdA,
        userId: idViewer,
        roleId: viewerRole!.id,
      },
    });
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
      const userIds = [idOwner, idAdmin, idMember, idViewer, idTenantB];
      for (const uid of userIds) {
        if (uid) {
          await prisma.refreshToken.deleteMany({ where: { userId: uid } });
          await prisma.user.delete({ where: { id: uid } }).catch(() => {});
        }
      }
      await prisma.$disconnect();
    }
    await app.close();
  });

  describe("Organization Read Permission (organization:read)", () => {
    it("OWNER can read organization details -> 200", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .expect(200);
    });

    it("ADMIN can read organization details -> 200", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .expect(200);
    });

    it("MEMBER can read organization details -> 200", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenMember}`)
        .expect(200);
    });

    it("VIEWER can read organization details -> 200", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenViewer}`)
        .expect(200);
    });
  });

  describe("Organization Update Permission (organization:update)", () => {
    it("OWNER can update organization -> 200", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({ name: "RBAC Org A Updated by Owner" })
        .expect(200);

      expect(res.body.name).toBe("RBAC Org A Updated by Owner");
    });

    it("ADMIN can update organization -> 200", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .send({ name: "RBAC Org A Updated by Admin" })
        .expect(200);

      expect(res.body.name).toBe("RBAC Org A Updated by Admin");
    });

    it("MEMBER attempting to update organization -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenMember}`)
        .send({ name: "Hacked by Member" })
        .expect(403);
    });

    it("VIEWER attempting to update organization -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenViewer}`)
        .send({ name: "Hacked by Viewer" })
        .expect(403);
    });
  });

  describe("Member Role Update & Hierarchy Enforcement (member:update)", () => {
    it("MEMBER attempting to update member role -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/members/${idViewer}/role`)
        .set("Authorization", `Bearer ${tokenMember}`)
        .send({ role: "ADMIN" })
        .expect(403);
    });

    it("VIEWER attempting to update member role -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/members/${idMember}/role`)
        .set("Authorization", `Bearer ${tokenViewer}`)
        .send({ role: "ADMIN" })
        .expect(403);
    });

    it("ADMIN attempting to modify role of OWNER -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/members/${idOwner}/role`)
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .send({ role: "ADMIN" })
        .expect(403);
    });

    it("ADMIN attempting to promote someone to OWNER -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/members/${idMember}/role`)
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .send({ role: "OWNER" })
        .expect(403);
    });

    it("Sole OWNER attempting to demote self -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/members/${idOwner}/role`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({ role: "ADMIN" })
        .expect(403);
    });

    it("OWNER updating ADMIN to MEMBER -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/members/${idAdmin}/role`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({ role: "MEMBER" })
        .expect(200);

      expect(res.body.role).toBe("MEMBER");
    });
  });

  describe("Cross-Tenant RBAC Rejection", () => {
    it("User from Org B attempting to read Org A details -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenTenantB}`)
        .expect(403);
    });

    it("User from Org B attempting to update Org A details -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}`)
        .set("Authorization", `Bearer ${tokenTenantB}`)
        .send({ name: "Cross Tenant Hack" })
        .expect(403);
    });

    it("User from Org B attempting to update member role in Org A -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/members/${idMember}/role`)
        .set("Authorization", `Bearer ${tokenTenantB}`)
        .send({ role: "ADMIN" })
        .expect(403);
    });
  });
});
