import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";

describe("Project Management (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Test Users
  const ownerData = {
    email: `owner-proj-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Owner",
    lastName: "User",
  };

  const adminData = {
    email: `admin-proj-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Admin",
    lastName: "User",
  };

  const memberData = {
    email: `member-proj-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Member",
    lastName: "User",
  };

  const viewerData = {
    email: `viewer-proj-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Viewer",
    lastName: "User",
  };

  const userOrgBData = {
    email: `user-orgb-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "OrgB",
    lastName: "User",
  };

  let tokenOwner: string;
  let tokenMember: string;
  let tokenViewer: string;
  let tokenOrgB: string;

  let idOwner: string;
  let idAdmin: string;
  let idMember: string;
  let idViewer: string;
  let idOrgB: string;

  let orgIdA: string;
  let orgIdB: string;

  let projIdA: string;
  let projIdB: string;
  const sharedSlug = `ragforge-platform-${Date.now()}`;

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

    // Register test users
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

    const resUserOrgB = await request(app.getHttpServer())
      .post("/auth/register")
      .send(userOrgBData)
      .expect(201);
    tokenOrgB = resUserOrgB.body.accessToken;
    idOrgB = resUserOrgB.body.user.id;

    // Create Organization A (Owner becomes OWNER)
    const resOrgA = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ name: "Project Test Org A", slug: `proj-org-a-${Date.now()}` })
      .expect(201);
    orgIdA = resOrgA.body.id;

    // Add Admin, Member, Viewer to Org A
    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/members`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ email: adminData.email, role: "ADMIN" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/members`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ email: memberData.email, role: "MEMBER" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/members`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({ email: viewerData.email, role: "VIEWER" })
      .expect(201);

    // Create Organization B (userOrgB becomes OWNER of Org B)
    const resCreateOrgB = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenOrgB}`)
      .send({ name: "Project Test Org B", slug: `proj-org-b-${Date.now()}` })
      .expect(201);
    orgIdB = resCreateOrgB.body.id;
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
      const uids = [idOwner, idAdmin, idMember, idViewer, idOrgB];
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

  describe("Project Creation & Ownership", () => {
    it("1. Owner creates Project A in Org A -> 201 Created", async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({
          name: "RAGForge Platform",
          slug: sharedSlug,
          description: "Initial development of RAGForge SaaS",
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.slug).toBe(sharedSlug);
      expect(res.body.creatorRole).toBe("PROJECT_ADMIN");
      projIdA = res.body.id;
    });

    it("2. Creator automatically becomes PROJECT_ADMIN in ProjectMember table", async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}/members`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].userId).toBe(idOwner);
      expect(res.body[0].role).toBe("PROJECT_ADMIN");
    });

    it("Duplicate project slug in same Organization -> 409 Conflict", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({
          name: "Duplicate RAGForge",
          slug: sharedSlug,
        })
        .expect(409);
    });

    it("16. Same project slug can exist in Organization B -> 201 Created", async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgIdB}/projects`)
        .set("Authorization", `Bearer ${tokenOrgB}`)
        .send({
          name: "RAGForge Platform in Org B",
          slug: sharedSlug,
        })
        .expect(201);

      expect(res.body.slug).toBe(sharedSlug);
      expect(res.body.organizationId).toBe(orgIdB);
      projIdB = res.body.id;
    });
  });

  describe("Project Retrieval & Listing", () => {
    it("3. Owner lists projects in Org A -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body.some((p: any) => p.id === projIdA)).toBe(true);
    });

    it("4. Owner retrieves Project A details -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .expect(200);

      expect(res.body.id).toBe(projIdA);
      expect(res.body.slug).toBe(sharedSlug);
    });
  });

  describe("Project Update & Member Operations", () => {
    it("5. Owner updates Project A details -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/projects/${projIdA}`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({ description: "Updated RAGForge description" })
        .expect(200);

      expect(res.body.description).toBe("Updated RAGForge description");
    });

    it("6. Owner adds Member to Project A -> 201 Created", async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/members`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({
          email: memberData.email,
          role: "PROJECT_MEMBER",
        })
        .expect(201);

      expect(res.body.userId).toBe(idMember);
      expect(res.body.role).toBe("PROJECT_MEMBER");
    });

    it("7. Member can retrieve Project A -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}`)
        .set("Authorization", `Bearer ${tokenMember}`)
        .expect(200);

      expect(res.body.id).toBe(projIdA);
    });

    it("8. Viewer attempting to update Project A -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/projects/${projIdA}`)
        .set("Authorization", `Bearer ${tokenViewer}`)
        .send({ name: "Hacked Project Name" })
        .expect(403);
    });

    it("9. Member role can be updated to PROJECT_ADMIN -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/members/${idMember}/role`,
        )
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({ role: "PROJECT_ADMIN" })
        .expect(200);

      expect(res.body.role).toBe("PROJECT_ADMIN");
    });

    it("12. Final PROJECT_ADMIN cannot be demoted -> 403 Forbidden", async () => {
      // Demote Member back to PROJECT_MEMBER
      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/members/${idMember}/role`,
        )
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({ role: "PROJECT_MEMBER" })
        .expect(200);

      // Now Owner is the sole PROJECT_ADMIN. Attempt demoting Owner.
      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/members/${idOwner}/role`,
        )
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({ role: "PROJECT_MEMBER" })
        .expect(403);
    });

    it("11. Final PROJECT_ADMIN cannot be removed -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .delete(
          `/organizations/${orgIdA}/projects/${projIdA}/members/${idOwner}`,
        )
        .set("Authorization", `Bearer ${tokenOwner}`)
        .expect(403);
    });

    it("10. Project member can be removed -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .delete(
          `/organizations/${orgIdA}/projects/${projIdA}/members/${idMember}`,
        )
        .set("Authorization", `Bearer ${tokenOwner}`)
        .expect(200);

      expect(res.body.userId).toBe(idMember);
    });

    it("18. User account remains intact after project member removal", async () => {
      const res = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${tokenMember}`)
        .expect(200);

      expect(res.body.id).toBe(idMember);
    });
  });

  describe("Cross-Tenant Security & Isolation", () => {
    it("13. User from Org B cannot access Project A -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}`)
        .set("Authorization", `Bearer ${tokenOrgB}`)
        .expect(403);
    });

    it("14. User from Org B cannot modify Project A -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/projects/${projIdA}`)
        .set("Authorization", `Bearer ${tokenOrgB}`)
        .send({ name: "Cross Tenant Hack" })
        .expect(403);
    });

    it("15. Cannot add a user from Org B to Project A if they do not belong to Org A -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/members`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .send({
          email: userOrgBData.email,
          role: "PROJECT_MEMBER",
        })
        .expect(403);
    });
  });

  describe("Project Deletion & Cleanup", () => {
    it("17. Deleting Project A does not affect Project B -> 200 OK", async () => {
      await request(app.getHttpServer())
        .delete(`/organizations/${orgIdA}/projects/${projIdA}`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .expect(200);

      // Verify Project B in Org B still exists intact
      const resB = await request(app.getHttpServer())
        .get(`/organizations/${orgIdB}/projects/${projIdB}`)
        .set("Authorization", `Bearer ${tokenOrgB}`)
        .expect(200);

      expect(resB.body.id).toBe(projIdB);
    });
  });
});
