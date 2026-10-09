export const PERMISSIONS = {
  // Organization
  ORGANIZATION_READ: "organization:read",
  ORGANIZATION_UPDATE: "organization:update",
  ORGANIZATION_DELETE: "organization:delete",

  // Member
  MEMBER_READ: "member:read",
  MEMBER_CREATE: "member:create",
  MEMBER_INVITE: "member:invite",
  MEMBER_UPDATE: "member:update",
  MEMBER_REMOVE: "member:remove",
  MEMBER_DELETE: "member:delete",

  // Project
  PROJECT_CREATE: "project:create",
  PROJECT_READ: "project:read",
  PROJECT_UPDATE: "project:update",
  PROJECT_DELETE: "project:delete",

  // Project Member
  PROJECT_MEMBER_READ: "project_member:read",
  PROJECT_MEMBER_CREATE: "project_member:create",
  PROJECT_MEMBER_UPDATE: "project_member:update",
  PROJECT_MEMBER_DELETE: "project_member:delete",

  // Task
  TASK_CREATE: "task:create",
  TASK_READ: "task:read",
  TASK_UPDATE: "task:update",
  TASK_DELETE: "task:delete",
  TASK_ASSIGN: "task:assign",
  TASK_REORDER: "task:reorder",

  // Comment
  COMMENT_CREATE: "comment:create",
  COMMENT_READ: "comment:read",
  COMMENT_UPDATE: "comment:update",
  COMMENT_DELETE: "comment:delete",
} as const;

export type PermissionName =
  (typeof PERMISSIONS)[keyof typeof PERMISSIONS] | string;
