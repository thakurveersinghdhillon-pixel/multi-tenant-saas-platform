import { INestApplication } from "@nestjs/common";
import * as request from "supertest";

export interface TestUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  accessToken: string;
}

export interface TestOrganization {
  id: string;
  name: string;
  slug: string;
}

export interface TestProject {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
}

export interface TestTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  projectId: string;
  assigneeId?: string;
}

/**
 * Register a new user for testing and return user details with access token
 */
export async function createTestUser(
  app: INestApplication,
  overrides: {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
  } = {},
): Promise<TestUser> {
  const timestamp = Date.now() + Math.floor(Math.random() * 100000);
  const email = overrides.email || `factory_user_${timestamp}@example.com`;
  const password = overrides.password || "Password123!";
  const firstName = overrides.firstName || "Test";
  const lastName = overrides.lastName || "User";

  const res = await request(app.getHttpServer())
    .post("/auth/register")
    .send({ email, password, firstName, lastName })
    .expect(201);

  return {
    id: res.body.user.id,
    email: res.body.user.email,
    firstName: res.body.user.firstName,
    lastName: res.body.user.lastName,
    accessToken: res.body.accessToken,
  };
}

/**
 * Create a new organization with authenticated owner token
 */
export async function createTestOrganization(
  app: INestApplication,
  token: string,
  overrides: { name?: string; slug?: string } = {},
): Promise<TestOrganization> {
  const timestamp = Date.now() + Math.floor(Math.random() * 100000);
  const name = overrides.name || `Factory Org ${timestamp}`;
  const slug = overrides.slug || `factory-org-${timestamp}`;

  const res = await request(app.getHttpServer())
    .post("/organizations")
    .set("Authorization", `Bearer ${token}`)
    .send({ name, slug })
    .expect(201);

  return {
    id: res.body.id,
    name: res.body.name,
    slug: res.body.slug,
  };
}

/**
 * Add member to organization
 */
export async function addOrganizationMember(
  app: INestApplication,
  ownerToken: string,
  organizationId: string,
  email: string,
  role: "ADMIN" | "MEMBER" | "VIEWER" = "MEMBER",
) {
  const res = await request(app.getHttpServer())
    .post(`/organizations/${organizationId}/members`)
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ email, role })
    .expect(201);

  return res.body;
}

/**
 * Create a new project in organization
 */
export async function createTestProject(
  app: INestApplication,
  token: string,
  organizationId: string,
  overrides: { name?: string; slug?: string; description?: string } = {},
): Promise<TestProject> {
  const timestamp = Date.now() + Math.floor(Math.random() * 100000);
  const name = overrides.name || `Factory Project ${timestamp}`;
  const slug = overrides.slug || `factory-proj-${timestamp}`;

  const res = await request(app.getHttpServer())
    .post(`/organizations/${organizationId}/projects`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      name,
      slug,
      description: overrides.description || "Factory test project",
    })
    .expect(201);

  return {
    id: res.body.id,
    name: res.body.name,
    slug: res.body.slug,
    organizationId: res.body.organizationId,
  };
}

/**
 * Add member to project
 */
export async function addProjectMember(
  app: INestApplication,
  token: string,
  organizationId: string,
  projectId: string,
  email: string,
  role:
    "PROJECT_ADMIN" | "PROJECT_MEMBER" | "PROJECT_VIEWER" = "PROJECT_MEMBER",
) {
  const res = await request(app.getHttpServer())
    .post(`/organizations/${organizationId}/projects/${projectId}/members`)
    .set("Authorization", `Bearer ${token}`)
    .send({ email, role })
    .expect(201);

  return res.body;
}

/**
 * Create task in project
 */
export async function createTestTask(
  app: INestApplication,
  token: string,
  organizationId: string,
  projectId: string,
  overrides: {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
  } = {},
): Promise<TestTask> {
  const timestamp = Date.now() + Math.floor(Math.random() * 100000);
  const title = overrides.title || `Factory Task ${timestamp}`;

  const res = await request(app.getHttpServer())
    .post(`/organizations/${organizationId}/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      title,
      description: overrides.description || "Factory task description",
      status: overrides.status || "TODO",
      priority: overrides.priority || "MEDIUM",
      ...(overrides.assigneeId && { assigneeId: overrides.assigneeId }),
    })
    .expect(201);

  return {
    id: res.body.id,
    title: res.body.title,
    status: res.body.status,
    priority: res.body.priority,
    projectId: res.body.projectId,
    assigneeId: res.body.assigneeId,
  };
}
