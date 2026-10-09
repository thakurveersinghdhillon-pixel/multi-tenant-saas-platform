import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { ProjectRole, TaskPriority, TaskStatus } from "@prisma/client";

describe("Task Management & Kanban (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Test users
  const ownerData = {
    email: `owner-task-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Owner",
    lastName: "User",
  };

  const memberData = {
    email: `member-task-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Member",
    lastName: "User",
  };

  const viewerData = {
    email: `viewer-task-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Viewer",
    lastName: "User",
  };

  const orgOnlyMemberData = {
    email: `orgonly-task-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "OrgOnly",
    lastName: "User",
  };

  const crossTenantData = {
    email: `crosstenant-task-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "CrossTenant",
    lastName: "User",
  };

  let tokenOwner: string;
  let tokenMember: string;
  let tokenViewer: string;
  let tokenOrgOnlyMember: string;
  let tokenCrossTenant: string;

  let idOwner: string;
  let idMember: string;
  let idViewer: string;
  let idOrgOnlyMember: string;
  let idCrossTenant: string;

  let orgIdA: string;
  let orgIdB: string;

  let projIdA: string;
  let projIdB: string;

  let taskId1: string;
  let taskId2: string;

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

    // Register Users
    const resOwner = await request(app.getHttpServer())
      .post("/auth/register")
      .send(ownerData)
      .expect(201);
    tokenOwner = resOwner.body.accessToken;
    idOwner = resOwner.body.user.id;

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

    const resOrgOnly = await request(app.getHttpServer())
      .post("/auth/register")
      .send(orgOnlyMemberData)
      .expect(201);
    tokenOrgOnlyMember = resOrgOnly.body.accessToken;
    idOrgOnlyMember = resOrgOnly.body.user.id;

    const resCross = await request(app.getHttpServer())
      .post("/auth/register")
      .send(crossTenantData)
      .expect(201);
    tokenCrossTenant = resCross.body.accessToken;
    idCrossTenant = resCross.body.user.id;

    // Create Organization A (Owner: idOwner)
    const resOrgA = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenOwner}`)
      .send({
        name: `Org A Tasks ${Date.now()}`,
        slug: `org-a-tasks-${Date.now()}`,
      })
      .expect(201);
    orgIdA = resOrgA.body.id;

    // Create Organization B (Owner: idCrossTenant)
    const resOrgB = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenCrossTenant}`)
      .send({
        name: `Org B Tasks ${Date.now()}`,
        slug: `org-b-tasks-${Date.now()}`,
      })
      .expect(201);
    orgIdB = resOrgB.body.id;

    // Invite Member, Viewer, and OrgOnlyMember to Org A
    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/members`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: memberData.email, role: "MEMBER" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/members`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: viewerData.email, role: "MEMBER" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/members`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: orgOnlyMemberData.email, role: "MEMBER" })
      .expect(201);

    // Create Project A in Org A
    const resProjA = await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/projects`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .set("X-Tenant-Id", orgIdA)
      .send({
        name: "Project Alpha Tasks",
        slug: `proj-alpha-tasks-${Date.now()}`,
      })
      .expect(201);
    projIdA = resProjA.body.id;

    // Add Member to Project A as PROJECT_MEMBER
    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/projects/${projIdA}/members`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: memberData.email, role: ProjectRole.PROJECT_MEMBER })
      .expect(201);

    // Add Viewer to Project A as PROJECT_VIEWER
    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/projects/${projIdA}/members`)
      .set("Authorization", `Bearer ${tokenOwner}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: viewerData.email, role: ProjectRole.PROJECT_VIEWER })
      .expect(201);

    // Create Project B in Org B
    const resProjB = await request(app.getHttpServer())
      .post(`/organizations/${orgIdB}/projects`)
      .set("Authorization", `Bearer ${tokenCrossTenant}`)
      .set("X-Tenant-Id", orgIdB)
      .send({
        name: "Project Beta Tasks",
        slug: `proj-beta-tasks-${Date.now()}`,
      })
      .expect(201);
    projIdB = resProjB.body.id;
  });

  afterAll(async () => {
    // Clean up
    if (prisma) {
      await prisma.task.deleteMany({
        where: { projectId: { in: [projIdA, projIdB] } },
      });
      await prisma.projectMember.deleteMany({
        where: { projectId: { in: [projIdA, projIdB] } },
      });
      await prisma.project.deleteMany({
        where: { id: { in: [projIdA, projIdB] } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: [orgIdA, orgIdB] } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [orgIdA, orgIdB] } },
      });
      await prisma.refreshToken.deleteMany({
        where: {
          userId: {
            in: [idOwner, idMember, idViewer, idOrgOnlyMember, idCrossTenant],
          },
        },
      });
      await prisma.user.deleteMany({
        where: {
          id: {
            in: [idOwner, idMember, idViewer, idOrgOnlyMember, idCrossTenant],
          },
        },
      });
    }
    await app.close();
  });

  describe("1. Task Creation & Validation", () => {
    it("should create task successfully as Project Admin", async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .set("X-Tenant-Id", orgIdA)
        .send({
          title: "First Task",
          description: "Initial task description",
          priority: TaskPriority.HIGH,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe("First Task");
      expect(res.body.status).toBe(TaskStatus.TODO);
      expect(res.body.priority).toBe(TaskPriority.HIGH);
      expect(res.body.position).toBe(1000);
      taskId1 = res.body.id;
    });

    it("should create task with valid assignee (Project Member)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenMember}`)
        .set("X-Tenant-Id", orgIdA)
        .send({
          title: "Second Task",
          assigneeId: idMember,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.assignedToId).toBe(idMember);
      expect(res.body.position).toBe(2000);
      taskId2 = res.body.id;
    });

    it("should reject task creation by PROJECT_VIEWER with 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenViewer}`)
        .set("X-Tenant-Id", orgIdA)
        .send({
          title: "Unauthorized Task",
        })
        .expect(403);
    });

    it("should reject assigning user who is NOT a project member with 403 Forbidden (Attack Pattern 4)", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .set("X-Tenant-Id", orgIdA)
        .send({
          title: "Invalid Assignee Task",
          assigneeId: idOrgOnlyMember,
        })
        .expect(403);
    });

    it("should reject assigning cross-tenant user with 403 Forbidden (Attack Pattern 3)", async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .set("X-Tenant-Id", orgIdA)
        .send({
          title: "Cross Tenant Assignee Task",
          assigneeId: idCrossTenant,
        })
        .expect(403);
    });
  });

  describe("2. Task Retrieval & Kanban Board", () => {
    it("should allow PROJECT_VIEWER to list tasks", async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenViewer}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it("should return Kanban board formatted structure", async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}/tasks/board`)
        .set("Authorization", `Bearer ${tokenMember}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      expect(res.body.TODO).toBeDefined();
      expect(res.body.IN_PROGRESS).toBeDefined();
      expect(res.body.IN_REVIEW).toBeDefined();
      expect(res.body.DONE).toBeDefined();
      expect(res.body.TODO.length).toBeGreaterThanOrEqual(2);
    });

    it("should get single task by ID", async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskId1}`)
        .set("Authorization", `Bearer ${tokenViewer}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      expect(res.body.id).toBe(taskId1);
      expect(res.body.title).toBe("First Task");
    });

    it("should reject task retrieval for non-project member with 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenOrgOnlyMember}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(403);
    });
  });

  describe("3. Task Status & Assignee Updates", () => {
    it("should update task status as Project Member", async () => {
      const res = await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskId1}/status`,
        )
        .set("Authorization", `Bearer ${tokenMember}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ status: TaskStatus.IN_PROGRESS })
        .expect(200);

      expect(res.body.status).toBe(TaskStatus.IN_PROGRESS);
    });

    it("should update task assignee as Project Member", async () => {
      const res = await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskId1}/assignee`,
        )
        .set("Authorization", `Bearer ${tokenMember}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ assigneeId: idOwner })
        .expect(200);

      expect(res.body.assignedToId).toBe(idOwner);
    });

    it("should reject status update by PROJECT_VIEWER with 403 Forbidden (Attack Pattern 5)", async () => {
      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskId1}/status`,
        )
        .set("Authorization", `Bearer ${tokenViewer}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ status: TaskStatus.DONE })
        .expect(403);
    });
  });

  describe("4. Task Reordering", () => {
    let t3: string;

    beforeAll(async () => {
      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ title: "Order T1" });

      await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ title: "Order T2" });

      const r3 = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ title: "Order T3" });
      t3 = r3.body.id;
    });

    it("should reorder task position", async () => {
      const res = await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${t3}/reorder`,
        )
        .set("Authorization", `Bearer ${tokenMember}`)
        .set("X-Tenant-Id", orgIdA)
        .send({
          position: 1500,
        })
        .expect(200);

      expect(res.body.id).toBe(t3);
      expect(res.body.position).toBe(1500);
    });

    it("should reject reordering by PROJECT_VIEWER with 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${t3}/reorder`,
        )
        .set("Authorization", `Bearer ${tokenViewer}`)
        .set("X-Tenant-Id", orgIdA)
        .send({
          position: 1500,
        })
        .expect(403);
    });
  });

  describe("5. Task Deletion", () => {
    it("should reject deletion by PROJECT_VIEWER with 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .delete(`/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskId2}`)
        .set("Authorization", `Bearer ${tokenViewer}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(403);
    });

    it("should delete task as Project Admin", async () => {
      await request(app.getHttpServer())
        .delete(`/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskId2}`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      // Verify deletion
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskId2}`)
        .set("Authorization", `Bearer ${tokenMember}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(404);
    });
  });

  describe("6. Security & Cross-Tenant Isolation (Attack Patterns 1–6)", () => {
    it("Pattern 1: Accessing Org A task with Org B token and Org A header -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskId1}`)
        .set("Authorization", `Bearer ${tokenCrossTenant}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(403);
    });

    it("Pattern 2: Accessing Org A task via Org B route and header -> 404 Not Found", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdB}/projects/${projIdA}/tasks/${taskId1}`)
        .set("Authorization", `Bearer ${tokenCrossTenant}`)
        .set("X-Tenant-Id", orgIdB)
        .expect(404);
    });

    it("Pattern 6: Mismatched URL orgId and X-Tenant-Id header -> 400 Bad Request", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenOwner}`)
        .set("X-Tenant-Id", orgIdB)
        .expect(400);
    });
  });
});
