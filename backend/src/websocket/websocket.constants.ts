export const WEBSOCKET_ROOMS = {
  organization: (orgId: string) => `organization:${orgId}`,
  project: (orgId: string, projectId: string) =>
    `organization:${orgId}:project:${projectId}`,
  user: (userId: string) => `user:${userId}`,
} as const;

export const WEBSOCKET_EVENTS = {
  // Inbound Client Events
  PROJECT_JOIN: "project:join",
  PROJECT_LEAVE: "project:leave",

  // Outbound Real-time Broadcast Events
  PROJECT_CREATED: "project:created",
  PROJECT_UPDATED: "project:updated",
  PROJECT_DELETED: "project:deleted",

  TASK_CREATED: "task:created",
  TASK_UPDATED: "task:updated",
  TASK_STATUS_CHANGED: "task:status-changed",
  TASK_PRIORITY_CHANGED: "task:priority-changed",
  TASK_ASSIGNED: "task:assigned",
  TASK_UNASSIGNED: "task:unassigned",
  TASK_REORDERED: "task:reordered",
  TASK_DELETED: "task:deleted",

  COMMENT_CREATED: "comment:created",
  COMMENT_UPDATED: "comment:updated",
  COMMENT_DELETED: "comment:deleted",

  ACTIVITY_CREATED: "activity:created",
  NOTIFICATION_NEW: "notification:new",
} as const;

export const WEBSOCKET_ERROR_CODES = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  INVALID_ORGANIZATION: "INVALID_ORGANIZATION",
  ORGANIZATION_ACCESS_DENIED: "ORGANIZATION_ACCESS_DENIED",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  PROJECT_ACCESS_DENIED: "PROJECT_ACCESS_DENIED",
  INVALID_REQUEST: "INVALID_REQUEST",
} as const;
