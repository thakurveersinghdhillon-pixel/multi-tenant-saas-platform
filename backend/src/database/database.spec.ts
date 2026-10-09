import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "./prisma.service";
import { PrismaModule } from "./prisma.module";
import { ProjectStatus, TaskStatus, TaskPriority } from "@prisma/client";

describe("Database Architecture & Constraints (Integration)", () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();

    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  it("should verify Prisma connection successfully", async () => {
    const result = await prisma.$queryRaw`SELECT 1 as connected`;
    expect(result).toBeDefined();
  });

  describe("Entities and Relational Integrity", () => {
    const testEmail = `test-user-${Date.now()}@example.com`;
    const testOrgSlug = `test-org-${Date.now()}`;
    let userId: string;
    let orgId: string;
    let roleId: string;
    let projectId: string;
    let taskId: string;

    it("should create a User successfully", async () => {
      const user = await prisma.user.create({
        data: {
          email: testEmail,
          passwordHash: "hashed_password_string",
          firstName: "Test",
          lastName: "User",
        },
      });
      expect(user.id).toBeDefined();
      expect(user.email).toBe(testEmail);
      userId = user.id;
    });

    it("should create an Organization successfully", async () => {
      const org = await prisma.organization.create({
        data: {
          name: "Test Organization",
          slug: testOrgSlug,
        },
      });
      expect(org.id).toBeDefined();
      expect(org.slug).toBe(testOrgSlug);
      orgId = org.id;
    });

    it("should create a Role and OrganizationMember relationship", async () => {
      const role = await prisma.role.create({
        data: {
          name: "TEST_ROLE",
          organizationId: orgId,
        },
      });
      roleId = role.id;

      const member = await prisma.organizationMember.create({
        data: {
          organizationId: orgId,
          userId: userId,
          roleId: roleId,
        },
      });

      expect(member.id).toBeDefined();
      expect(member.organizationId).toBe(orgId);
      expect(member.userId).toBe(userId);
    });

    it("should reject duplicate Organization membership for the same user", async () => {
      await expect(
        prisma.organizationMember.create({
          data: {
            organizationId: orgId,
            userId: userId,
            roleId: roleId,
          },
        }),
      ).rejects.toThrow();
    });

    it("should create a Project belonging to the Organization", async () => {
      const project = await prisma.project.create({
        data: {
          organizationId: orgId,
          name: "Test Project",
          slug: "test-project",
          status: ProjectStatus.ACTIVE,
          createdById: userId,
        },
      });
      expect(project.id).toBeDefined();
      expect(project.organizationId).toBe(orgId);
      projectId = project.id;
    });

    it("should create a ProjectMember and reject duplicate membership", async () => {
      const projectMember = await prisma.projectMember.create({
        data: {
          projectId: projectId,
          userId: userId,
        },
      });
      expect(projectMember.id).toBeDefined();

      await expect(
        prisma.projectMember.create({
          data: {
            projectId: projectId,
            userId: userId,
          },
        }),
      ).rejects.toThrow();
    });

    it("should create a Task belonging to the Project", async () => {
      const task = await prisma.task.create({
        data: {
          projectId: projectId,
          createdById: userId,
          assignedToId: userId,
          title: "Test Task",
          status: TaskStatus.TODO,
          priority: TaskPriority.HIGH,
        },
      });
      expect(task.id).toBeDefined();
      expect(task.projectId).toBe(projectId);
      taskId = task.id;
    });

    it("should create a Comment belonging to the Task", async () => {
      const comment = await prisma.comment.create({
        data: {
          taskId: taskId,
          userId: userId,
          content: "This is a test comment",
        },
      });
      expect(comment.id).toBeDefined();
      expect(comment.taskId).toBe(taskId);
    });

    // Cleanup created test records
    afterAll(async () => {
      if (orgId) {
        await prisma.organization
          .delete({ where: { id: orgId } })
          .catch(() => {});
      }
      if (userId) {
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }
    });
  });
});
