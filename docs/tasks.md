# Phase 8 — Task Management & Kanban Documentation

This document describes the design, data model, API endpoints, Kanban ordering strategy, tenant/project isolation, assignee safety rules, role-based access control, and verification process for Phase 8 (Task Management & Kanban) of the Multi-Tenant SaaS Project Management Platform.

---

## 1. Architecture & Model Overview

Tasks are scoped strictly within a **Project**, which itself is scoped within an **Organization (Tenant Boundary)**.

```text
Organization (Tenant Boundary)
  └── Projects (Tenant-Scoped by organizationId)
        └── Tasks (Project-Scoped by projectId & Tenant-Scoped by organizationId)
              ├── Status: TODO | IN_PROGRESS | IN_REVIEW | DONE
              ├── Priority: LOW | MEDIUM | HIGH | URGENT
              ├── Position: Float (@default(1000), ordered ASC per column)
              ├── Assignee: User (Must be an OrganizationMember AND a ProjectMember)
              └── Creator: User (ProjectMember with creation permissions)
```

### Key Data Constraints & Relations
- **Tenant & Project Isolation**: Every task belongs to a `Project` (`projectId`) within an `Organization` (`organizationId`). Access requires valid authentication, tenant membership, and project membership.
- **Position & Reordering**: Tasks maintain a `position` field of type `Float`. Tasks within Kanban board columns are ordered by `position ASC`. Auto-positioning places new or moved tasks at `maxPosition + 1000`.
- **Assignee Safety**: Assignees MUST be verified as active members of BOTH the parent Organization AND the specific Project. Assigning non-project members or cross-tenant users is strictly rejected (`403 Forbidden`).
- **Project Role Scoping**: `PROJECT_VIEWER` role is strictly read-only. Attempts by viewers to create, modify, reorder, assign, or delete tasks throw `403 Forbidden`.

---

## 2. API Endpoints

| Method | Endpoint | Protection / Guards | Required Permission | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/organizations/:orgId/projects/:projId/tasks` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `task:create` | Create a new task within the project |
| `GET` | `/organizations/:orgId/projects/:projId/tasks` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `task:read` | List tasks for a project with optional filters (`status`, `priority`, `assigneeId`) |
| `GET` | `/organizations/:orgId/projects/:projId/tasks/board` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `task:read` | Get Kanban board structure grouped by status (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`) ordered by position |
| `GET` | `/organizations/:orgId/projects/:projId/tasks/:taskId` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `task:read` | Get single task details by ID |
| `PATCH` | `/organizations/:orgId/projects/:projId/tasks/:taskId` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `task:update` | Update task details (title, description, status, priority, due date) |
| `PATCH` | `/organizations/:orgId/projects/:projId/tasks/:taskId/status` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `task:update` | Update task status column transition and auto-append position |
| `PATCH` | `/organizations/:orgId/projects/:projId/tasks/:taskId/assignee` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `task:assign` | Assign task to a valid project member or unassign (`assigneeId: null`) |
| `PATCH` | `/organizations/:orgId/projects/:projId/tasks/:taskId/reorder` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `task:reorder` | Reorder task within Kanban column by position |
| `DELETE` | `/organizations/:orgId/projects/:projId/tasks/:taskId` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `task:delete` | Delete task by ID |

---

## 3. Kanban Ordering & Positioning Strategy

1. **Numeric Position Allocation**:
   - Initial default position: `1000.0`.
   - Creation auto-positioning: Appends task to the end of the column (`maxPosition + 1000.0`).
2. **Column Status Transition**:
   - Moving a task across status columns updates both `status` and `position` to `maxTargetPosition + 1000.0`.
3. **Explicit Position Updating**:
   - Clients send target `{ position: number }` to `/tasks/:taskId/reorder`.

---

## 4. Security & Cross-Tenant Protection (Attack Patterns 1–6)

- **Pattern 1: Cross-Tenant Org Access**: Requesting an Org A task using an Org B JWT token and Org A header returns `403 Forbidden`.
- **Pattern 2: Cross-Tenant Route Access**: Accessing an Org A task via an Org B URL route and Org B header returns `404 Not Found`.
- **Pattern 3: Cross-Tenant Assignee**: Attempting to assign an Org B user to an Org A task returns `403 Forbidden`.
- **Pattern 4: Non-Project Assignee**: Assigning an Org A member who is NOT a member of Project A returns `403 Forbidden`.
- **Pattern 5: Read-Only Viewer Mutation**: `PROJECT_VIEWER` attempting to create, update, reorder, assign, or delete tasks returns `403 Forbidden`.
- **Pattern 6: Tenant Mismatch**: Mismatched `X-Tenant-Id` header and URL `:orgId` parameter returns `400 Bad Request`.

---

## 5. Verification Results

- **Database Migration**: `20261009000000_phase8_task_position` applied.
- **Unit Tests**: 8 test suites passed (69/69 tests passed).
- **E2E Tests**: 7 test suites passed (104/104 tests passed).
- **Live HTTP Verification**: Verified end-to-end task creation, status transition, assignment, board retrieval, reordering, viewer rejection, and deletion.
