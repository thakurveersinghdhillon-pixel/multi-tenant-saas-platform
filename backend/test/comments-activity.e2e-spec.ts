import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { ProjectRole, TaskPriority, TaskStatus } from "@prisma/client";
import { ACTIVITY_EVENTS } from "../src/activity/constants/activity-events";

describe("Comments & Activity History (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Test users
  const adminData = {
    email: `admin-ca-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Project",
    lastName: "Admin",
  };

  const memberAData = {
    email: `membera-ca-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Member",
    lastName: "A",
  };

  const memberBData = {
    email: `memberb-ca-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Member",
    lastName: "B",
  };

  const viewerData = {
    email: `viewer-ca-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "Project",
    lastName: "Viewer",
  };

  const orgBUserData = {
    email: `orgb-ca-${Date.now()}@example.com`,
    password: "Password123!",
    firstName: "OrgB",
    lastName: "User",
  };

  let tokenAdmin: string;
  let tokenMemberA: string;
  let tokenMemberB: string;
  let tokenViewer: string;
  let tokenOrgB: string;

  let idAdmin: string;
  let idMemberA: string;
  let idMemberB: string;
  let idViewer: string;
  let idOrgB: string;

  let orgIdA: string;
  let orgIdB: string;

  let projIdA: string;
  let taskIdA: string;
  let commentId1: string;

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
    const resAdmin = await request(app.getHttpServer())
      .post("/auth/register")
      .send(adminData)
      .expect(201);
    tokenAdmin = resAdmin.body.accessToken;
    idAdmin = resAdmin.body.user.id;

    const resMemberA = await request(app.getHttpServer())
      .post("/auth/register")
      .send(memberAData)
      .expect(201);
    tokenMemberA = resMemberA.body.accessToken;
    idMemberA = resMemberA.body.user.id;

    const resMemberB = await request(app.getHttpServer())
      .post("/auth/register")
      .send(memberBData)
      .expect(201);
    tokenMemberB = resMemberB.body.accessToken;
    idMemberB = resMemberB.body.user.id;

    const resViewer = await request(app.getHttpServer())
      .post("/auth/register")
      .send(viewerData)
      .expect(201);
    tokenViewer = resViewer.body.accessToken;
    idViewer = resViewer.body.user.id;

    const resUserOrgB = await request(app.getHttpServer())
      .post("/auth/register")
      .send(orgBUserData)
      .expect(201);
    tokenOrgB = resUserOrgB.body.accessToken;
    idOrgB = resUserOrgB.body.user.id;

    // Create Organization A (Owner: idAdmin)
    const resOrgA = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ name: `Org A CA ${Date.now()}`, slug: `org-a-ca-${Date.now()}` })
      .expect(201);
    orgIdA = resOrgA.body.id;

    // Create Organization B (Owner: idOrgB)
    const resOrgB = await request(app.getHttpServer())
      .post("/organizations")
      .set("Authorization", `Bearer ${tokenOrgB}`)
      .send({ name: `Org B CA ${Date.now()}`, slug: `org-b-ca-${Date.now()}` })
      .expect(201);
    orgIdB = resOrgB.body.id;

    // Invite Member A, Member B, Viewer to Org A
    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/members`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: memberAData.email, role: "MEMBER" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/members`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: memberBData.email, role: "MEMBER" })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/members`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: viewerData.email, role: "MEMBER" })
      .expect(201);

    // Create Project A in Org A
    const resProjA = await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/projects`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ name: "Project Alpha CA", slug: `proj-alpha-ca-${Date.now()}` })
      .expect(201);
    projIdA = resProjA.body.id;

    // Add Members to Project A
    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/projects/${projIdA}/members`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: memberAData.email, role: ProjectRole.PROJECT_MEMBER })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/projects/${projIdA}/members`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: memberBData.email, role: ProjectRole.PROJECT_MEMBER })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgIdA}/projects/${projIdA}/members`)
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .set("X-Tenant-Id", orgIdA)
      .send({ email: viewerData.email, role: ProjectRole.PROJECT_VIEWER })
      .expect(201);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.comment.deleteMany({
        where: { task: { projectId: projIdA } },
      });
      await prisma.activityLog.deleteMany({
        where: { organizationId: { in: [orgIdA, orgIdB] } },
      });
      await prisma.task.deleteMany({
        where: { projectId: projIdA },
      });
      await prisma.projectMember.deleteMany({
        where: { projectId: projIdA },
      });
      await prisma.project.deleteMany({
        where: { id: projIdA },
      });
      await prisma.organizationMember.deleteMany({
        where: { organizationId: { in: [orgIdA, orgIdB] } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: [orgIdA, orgIdB] } },
      });
      await prisma.refreshToken.deleteMany({
        where: {
          userId: { in: [idAdmin, idMemberA, idMemberB, idViewer, idOrgB] },
        },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [idAdmin, idMemberA, idMemberB, idViewer, idOrgB] },
        },
      });
    }
    await app.close();
  });

  describe("1. Task Creation & Task Activity", () => {
    it("Step 1 & 2: Project Admin creates Task A & TASK_CREATED activity appears", async () => {
      const taskRes = await request(app.getHttpServer())
        .post(`/organizations/${orgIdA}/projects/${projIdA}/tasks`)
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .send({
          title: "Task A - Initial Work",
          priority: TaskPriority.MEDIUM,
        })
        .expect(201);

      taskIdA = taskRes.body.id;

      // Check Task Activity
      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/activity`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      expect(actRes.body.data.length).toBeGreaterThanOrEqual(1);
      expect(actRes.body.data[0].action).toBe(ACTIVITY_EVENTS.TASK_CREATED);
    });
  });

  describe("2. Comments Lifecycle & Activity", () => {
    it("Step 3 & 4: Member A creates comment & COMMENT_CREATED activity appears", async () => {
      const cRes = await request(app.getHttpServer())
        .post(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/comments`,
        )
        .set("Authorization", `Bearer ${tokenMemberA}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ content: "Member A initial comment" })
        .expect(201);

      commentId1 = cRes.body.id;
      expect(cRes.body.content).toBe("Member A initial comment");

      // Verify activity
      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/activity`,
        )
        .set("Authorization", `Bearer ${tokenMemberA}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      const createdEvent = actRes.body.data.find(
        (e: any) => e.action === ACTIVITY_EVENTS.COMMENT_CREATED,
      );
      expect(createdEvent).toBeDefined();
    });

    it("Step 5 & 6: Member A edits own comment & COMMENT_UPDATED activity appears", async () => {
      const uRes = await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/comments/${commentId1}`,
        )
        .set("Authorization", `Bearer ${tokenMemberA}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ content: "Member A edited comment content" })
        .expect(200);

      expect(uRes.body.content).toBe("Member A edited comment content");

      // Verify activity
      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/activity`,
        )
        .set("Authorization", `Bearer ${tokenMemberA}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      const updatedEvent = actRes.body.data.find(
        (e: any) => e.action === ACTIVITY_EVENTS.COMMENT_UPDATED,
      );
      expect(updatedEvent).toBeDefined();
    });

    it("Step 7: Member B cannot edit Member A comment -> 403 Forbidden (Attack Pattern 2)", async () => {
      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/comments/${commentId1}`,
        )
        .set("Authorization", `Bearer ${tokenMemberB}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ content: "Unauthorized edit by Member B" })
        .expect(403);
    });

    it("Step 8: Viewer can read comments -> 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/comments`,
        )
        .set("Authorization", `Bearer ${tokenViewer}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it("Step 9: Viewer cannot create comment -> 403 Forbidden (Attack Pattern 3)", async () => {
      await request(app.getHttpServer())
        .post(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/comments`,
        )
        .set("Authorization", `Bearer ${tokenViewer}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ content: "Viewer comment attempt" })
        .expect(403);
    });
  });

  describe("3. Task Mutations & Detailed Activity Tracking", () => {
    it("Step 10 & 11: Admin changes status & TASK_STATUS_CHANGED activity appears", async () => {
      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/status`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ status: TaskStatus.IN_PROGRESS })
        .expect(200);

      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/activity`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      const statusEvent = actRes.body.data.find(
        (e: any) => e.action === ACTIVITY_EVENTS.TASK_STATUS_CHANGED,
      );
      expect(statusEvent).toBeDefined();
      expect(statusEvent.metadata.oldStatus).toBe(TaskStatus.TODO);
      expect(statusEvent.metadata.newStatus).toBe(TaskStatus.IN_PROGRESS);
    });

    it("Step 12 & 13: Admin changes priority & TASK_PRIORITY_CHANGED activity appears", async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}`)
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ priority: TaskPriority.HIGH })
        .expect(200);

      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/activity`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      const priorityEvent = actRes.body.data.find(
        (e: any) => e.action === ACTIVITY_EVENTS.TASK_PRIORITY_CHANGED,
      );
      expect(priorityEvent).toBeDefined();
    });

    it("Step 14 & 15: Admin assigns task & TASK_ASSIGNED activity appears", async () => {
      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/assignee`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ assigneeId: idMemberA })
        .expect(200);

      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/activity`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      const assignEvent = actRes.body.data.find(
        (e: any) => e.action === ACTIVITY_EVENTS.TASK_ASSIGNED,
      );
      expect(assignEvent).toBeDefined();
      expect(assignEvent.metadata.newAssigneeId).toBe(idMemberA);
    });

    it("Step 16 & 17: Admin unassigns task & TASK_UNASSIGNED activity appears", async () => {
      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/assignee`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ assigneeId: null })
        .expect(200);

      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/activity`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      const unassignEvent = actRes.body.data.find(
        (e: any) => e.action === ACTIVITY_EVENTS.TASK_UNASSIGNED,
      );
      expect(unassignEvent).toBeDefined();
    });

    it("Step 18 & 19: Admin reorders task & TASK_REORDERED activity appears", async () => {
      await request(app.getHttpServer())
        .patch(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/reorder`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .send({ position: 2500 })
        .expect(200);

      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/activity`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      const reorderEvent = actRes.body.data.find(
        (e: any) => e.action === ACTIVITY_EVENTS.TASK_REORDERED,
      );
      expect(reorderEvent).toBeDefined();
    });

    it("Step 20: Member A deletes comment & COMMENT_DELETED activity appears", async () => {
      await request(app.getHttpServer())
        .delete(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/comments/${commentId1}`,
        )
        .set("Authorization", `Bearer ${tokenMemberA}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/activity`,
        )
        .set("Authorization", `Bearer ${tokenMemberA}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      const deleteEvent = actRes.body.data.find(
        (e: any) => e.action === ACTIVITY_EVENTS.COMMENT_DELETED,
      );
      expect(deleteEvent).toBeDefined();
    });
  });

  describe("4. Cross-Tenant Security & Isolation", () => {
    it("Step 21: User from Org B cannot read Project A activity -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgIdA}/projects/${projIdA}/activity`)
        .set("Authorization", `Bearer ${tokenOrgB}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(403);
    });

    it("Step 22: User from Org B cannot read Project A task comments -> 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/comments`,
        )
        .set("Authorization", `Bearer ${tokenOrgB}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(403);
    });

    it("Step 23: Task-specific activity contains only that task events", async () => {
      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/tasks/${taskIdA}/activity`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      for (const log of actRes.body.data) {
        expect(log.taskId).toBe(taskIdA);
      }
    });

    it("Step 24 & 25: Project activity pagination and filtering", async () => {
      const actRes = await request(app.getHttpServer())
        .get(
          `/organizations/${orgIdA}/projects/${projIdA}/activity?page=1&limit=5`,
        )
        .set("Authorization", `Bearer ${tokenAdmin}`)
        .set("X-Tenant-Id", orgIdA)
        .expect(200);

      expect(actRes.body.pagination).toBeDefined();
      expect(actRes.body.pagination.page).toBe(1);
      expect(actRes.body.pagination.limit).toBe(5);
      expect(actRes.body.data.length).toBeLessThanOrEqual(5);
    });
  });
});
