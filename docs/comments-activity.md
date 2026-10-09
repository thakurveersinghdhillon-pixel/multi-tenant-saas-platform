# Phase 9 — Comments & Activity History Documentation

This document describes the design, data models, API endpoints, comment ownership & moderation rules, centralized activity logging architecture, event types, metadata structure, pagination, tenant isolation, and verification process for Phase 9 (Comments & Activity History) of the Multi-Tenant SaaS Project Management Platform.

---

## 1. Architecture & Model Overview

Comments and Activity Logs are scoped strictly within the multi-tenant hierarchy:

```text
Organization (Tenant Boundary)
  └── Projects (Tenant-Scoped)
        └── Tasks (Project-Scoped)
              ├── Comments (Task-Scoped, Soft-Deleted via deletedAt)
              └── ActivityLog (Project & Task-Scoped Audit History)
```

### Key Data Models & Relationships

#### `Comment` Model
```prisma
model Comment {
  id        String    @id @default(uuid()) @db.Uuid
  taskId    String    @db.Uuid
  userId    String?   @db.Uuid
  content   String
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  task Task  @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([taskId])
  @@index([deletedAt])
}
```

#### `ActivityLog` Model
```prisma
model ActivityLog {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @db.Uuid
  userId         String?  @db.Uuid
  projectId      String?  @db.Uuid
  taskId         String?  @db.Uuid
  action         String
  metadata       Json?
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User?        @relation(fields: [userId], references: [id], onDelete: SetNull)
  project      Project?     @relation(fields: [projectId], references: [id], onDelete: SetNull)
  task         Task?        @relation(fields: [taskId], references: [id], onDelete: SetNull)

  @@index([organizationId])
  @@index([userId])
  @@index([projectId])
  @@index([taskId])
  @@index([createdAt])
}
```

---

## 2. Comment Ownership & Deletion Strategy

1. **Soft Deletion Strategy**:
   - Comments are soft-deleted by setting `deletedAt = new Date()` in database operations.
   - List queries (`GET .../comments`) filter out soft-deleted comments (`deletedAt: null`).
   - Audit history and activity logs preserve comment activity entries without exposing deleted content.

2. **Ownership & Moderation Authorization**:
   - **Create**: Requires `comment:create` permission and `PROJECT_ADMIN` or `PROJECT_MEMBER` project role (`PROJECT_VIEWER` mutation rejected with `403 Forbidden`).
   - **Update**: Restricted strictly to the comment author (`existing.userId === userId`). Non-authors receive `403 Forbidden`.
   - **Delete**: Permitted for the comment author OR `PROJECT_ADMIN` OR Organization `OWNER`/`ADMIN` for moderation purposes. Other users receive `403 Forbidden`.

---

## 3. Centralized Activity History Architecture

The `ActivityService` (`backend/src/activity/activity.service.ts`) provides centralized, strongly typed activity recording and retrieval.

### Centralized Activity Event Types (`ACTIVITY_EVENTS`)

- **Project Events**: `PROJECT_CREATED`, `PROJECT_UPDATED`, `PROJECT_DELETED`
- **Project Member Events**: `PROJECT_MEMBER_ADDED`, `PROJECT_MEMBER_REMOVED`, `PROJECT_MEMBER_ROLE_CHANGED`
- **Task Events**: `TASK_CREATED`, `TASK_UPDATED`, `TASK_STATUS_CHANGED`, `TASK_PRIORITY_CHANGED`, `TASK_ASSIGNED`, `TASK_UNASSIGNED`, `TASK_REORDERED`, `TASK_DELETED`
- **Comment Events**: `COMMENT_CREATED`, `COMMENT_UPDATED`, `COMMENT_DELETED`

### Transactional Activity Logging

All mutation methods (`ProjectsService`, `TasksService`, `CommentsService`) execute data modifications and activity log creations within atomic Prisma transactions (`prisma.$transaction`).

---

## 4. API Endpoints

### Comment Endpoints

| Method | Endpoint | Protection / Guards | Required Permission | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/organizations/:orgId/projects/:projId/tasks/:taskId/comments` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `comment:create` | Create comment on task |
| `GET` | `/organizations/:orgId/projects/:projId/tasks/:taskId/comments` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `comment:read` | List active task comments ordered `createdAt ASC` |
| `PATCH` | `/organizations/:orgId/projects/:projId/tasks/:taskId/comments/:commentId` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `comment:update` | Update own comment content |
| `DELETE` | `/organizations/:orgId/projects/:projId/tasks/:taskId/comments/:commentId` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `comment:delete` | Soft delete comment (Author or Admin moderation) |

### Activity History Endpoints

| Method | Endpoint | Protection / Guards | Required Permission | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/organizations/:orgId/projects/:projId/activity` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `project:read` | Retrieve project activity history with filtering & pagination |
| `GET` | `/organizations/:orgId/projects/:projId/tasks/:taskId/activity` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `task:read` | Retrieve task-specific activity history with filtering & pagination |

---

## 5. Pagination & Filtering

- **Default Limit**: 50 records.
- **Maximum Limit**: 100 records.
- **Ordering**: Deterministic `createdAt DESC` (newest first).
- **Supported Filters**:
  - `page`: Page index (1-based).
  - `limit`: Number of items per page.
  - `eventType`: Filter by specific activity action.
  - `actorId`: Filter by user ID of actor.
  - `taskId`: Filter project activity by specific task ID.

---

## 6. Verification Results

- **Database Migration**: `20261009000001_phase9_comments_activity` created and applied.
- **Unit Tests**: 10 test suites passed (**84/84 unit tests passed**).
- **E2E Tests**: 8 test suites passed (**120/120 E2E tests passed**).
- **Live HTTP Verification**: Verified end-to-end task creation, comment creation, author update, non-author edit rejection (403), viewer creation rejection (403), status/priority/assignee activity logs, comment soft deletion, and project activity pagination.
