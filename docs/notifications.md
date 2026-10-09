# Phase 12 — Notifications & Real-Time Delivery

## Overview

Phase 12 introduces a production-grade, multi-tenant notification system with real-time delivery via WebSockets. It enables user-specific notifications for key platform events (task assignments, status updates, comments, project member lifecycle, role changes) while ensuring strict tenant isolation and avoiding self-notifications.

---

## 1. Database Architecture & Data Model

The `Notification` model in PostgreSQL (`backend/prisma/schema.prisma`) is defined as follows:

```prisma
model Notification {
  id             String           @id @default(uuid())
  organizationId String
  userId         String
  actorId        String?
  projectId      String?
  taskId         String?
  type           NotificationType
  title          String
  message        String
  isRead         Boolean          @default(false)
  createdAt      DateTime         @default(now())
  readAt         DateTime?
  metadata       Json?

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation("RecipientNotifications", fields: [userId], references: [id], onDelete: Cascade)
  actor        User?        @relation("ActorNotifications", fields: [actorId], references: [id], onDelete: SetNull)
  project      Project?     @relation(fields: [projectId], references: [id], onDelete: SetNull)
  task         Task?        @relation(fields: [taskId], references: [id], onDelete: SetNull)

  @@index([organizationId, userId, isRead])
  @@index([organizationId, userId, createdAt])
  @@map("notifications")
}

enum NotificationType {
  TASK_ASSIGNED
  TASK_UNASSIGNED
  TASK_STATUS_CHANGED
  TASK_COMMENTED
  PROJECT_MEMBER_ADDED
  PROJECT_MEMBER_REMOVED
  PROJECT_MEMBER_ROLE_CHANGED
}
```

### Mandatory Tenant Boundary
- `organizationId` is non-nullable to guarantee cross-tenant isolation.
- Queries are strictly filtered by both `organizationId` (from `x-organization-id` header context) and `userId` (from JWT authentication payload).

---

## 2. Notification Triggers & Business Rules

Notifications are created automatically when business actions complete:

1. **`TASK_ASSIGNED`**: Triggered when a task is created or updated with an `assigneeId`. Recipient: assignee.
2. **`TASK_UNASSIGNED`**: Triggered when an assignee is removed from a task. Recipient: former assignee.
3. **`TASK_STATUS_CHANGED`**: Triggered when task status changes. Recipient: assigned user.
4. **`TASK_COMMENTED`**: Triggered when a new comment is added to a task. Recipient: assigned user.
5. **`PROJECT_MEMBER_ADDED`**: Triggered when a user is added to a project. Recipient: added user.
6. **`PROJECT_MEMBER_REMOVED`**: Triggered when a member is removed from a project. Recipient: removed user.
7. **`PROJECT_MEMBER_ROLE_CHANGED`**: Triggered when a project member's role is updated. Recipient: target member.

### Self-Notification Suppression
- If `actorId === recipientId` (e.g. user updates their own task status or comments on their own task), notification creation is bypassed (`createNotification` returns `null`).

---

## 3. Real-Time Delivery (WebSockets)

- **User Room Structure**: Upon connection and authentication, each socket automatically joins its isolated user room: `user:{userId}`.
- **Event Emission**: `WebSocketService.emitNotificationEvent(userId, notification)` broadcasts `notification:new` to room `user:{userId}` post-database commit.
- **Offline Persistence**: If a user is offline when a notification is generated, it remains stored in PostgreSQL as `isRead: false` and is delivered upon fetching notifications REST API post-reconnect.

---

## 4. Redis Caching & Invalidation

- **Cache Key Pattern**: `v1:tenant:{orgId}:user:{userId}:notifications:unread-count`
- **Behavior**:
  - `GET /notifications/unread-count` caches the count with a 60-second TTL.
  - Creation of a new notification or marking notifications as read immediately invalidates the cache key.

---

## 5. REST API Specifications

All endpoints require JWT Bearer Authentication (`JwtAuthGuard`) and Organization Context (`TenantGuard`, `x-organization-id` header).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/notifications` | List user's notifications (supports `page`, `limit`, `unread=true`) |
| `GET` | `/notifications/unread-count` | Get count of unread notifications (cached in Redis) |
| `GET` | `/notifications/:notificationId` | Fetch single notification details |
| `PATCH` | `/notifications/:notificationId/read` | Mark single notification as read |
| `PATCH` | `/notifications/read-all` | Mark all unread notifications as read |

---

## 6. Security & Tenant Isolation

1. **Authorization**: Access to notification resources requires membership in the target organization context.
2. **Recipient Scoping**: Users can only query or mutate their own notifications (`userId === req.user.id`).
3. **Cross-Tenant Guard**: Attempting to access notifications from an unauthorized organization context returns `403 Forbidden`.
