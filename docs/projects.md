# Phase 7 — Project Management Documentation

This document describes the design, data model, API endpoints, project-level roles, organization vs project authorization relationship, tenant isolation, ownership safety rules, and verification process for Phase 7 (Project Management) of the Multi-Tenant SaaS Project Management Platform.

---

## 1. Architecture & Model Overview

Projects represent workspaces scoped within an Organization.

```text
Organization (Tenant Boundary)
  └── Projects (Tenant-Scoped by organizationId)
        └── ProjectMembers (PROJECT_ADMIN, PROJECT_MEMBER, PROJECT_VIEWER)
```

### Key Data Constraints & Relations
- **Tenant Scope**: A `Project` belongs to exactly one `Organization` (`organizationId`). Project slugs are unique within an organization (`organizationId + slug`).
- **Creator Ownership**: When a project is created, the creator automatically becomes a `PROJECT_ADMIN` in `ProjectMember`.
- **Organization Member Requirement**: A user CANNOT be added to a `Project` unless they are already an `OrganizationMember` of the project's organization.

---

## 2. Organization Roles vs Project Roles

Organization authorization and Project authorization operate at distinct layers:

| Layer | System Roles | Scope |
| :--- | :--- | :--- |
| **Organization Level** | `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` | Determines tenant-wide permissions (`organization:update`, `member:create`, `project:create`, etc.) |
| **Project Level** | `PROJECT_ADMIN`, `PROJECT_MEMBER`, `PROJECT_VIEWER` | Determines project-specific permissions within a project |

A user can be an Organization `MEMBER` while holding the `PROJECT_ADMIN` role on a specific project they created.

---

## 3. API Endpoints

| Method | Endpoint | Protection / Guards | Required Permission | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/organizations/:id/projects` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `project:create` | Create a new project inside the organization |
| `GET` | `/organizations/:id/projects` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `project:read` | List all projects belonging to the active organization |
| `GET` | `/organizations/:id/projects/:projectId` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `project:read` | Get single project details by ID |
| `PATCH` | `/organizations/:id/projects/:projectId` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `project:update` | Update project details (name, slug, description, status) |
| `DELETE` | `/organizations/:id/projects/:projectId` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `project:delete` | Delete project and project members in transaction |
| `GET` | `/organizations/:id/projects/:projectId/members` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `project:read` | List all members of a project |
| `POST` | `/organizations/:id/projects/:projectId/members` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `project:update` | Add an organization member to the project |
| `PATCH` | `/organizations/:id/projects/:projectId/members/:targetUserId/role` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `project:update` | Update project member role |
| `DELETE` | `/organizations/:id/projects/:projectId/members/:targetUserId` | `JwtAuthGuard, TenantGuard, PermissionsGuard` | `project:update` | Remove member from project |

---

## 4. Ownership & Safety Rules

1. **Automatic Project Admin**: Upon project creation, the creator is bound as `PROJECT_ADMIN` inside an atomic Prisma transaction.
2. **Sole Project Admin Protection**:
   - The sole `PROJECT_ADMIN` cannot be demoted (`403 Forbidden`).
   - The sole `PROJECT_ADMIN` cannot be removed (`403 Forbidden`).
3. **Tenant Membership Barrier**: Users from another organization CANNOT be added to a project (`403 Forbidden`).

---

## 5. Example Requests & Responses

### Create Project
`POST /organizations/67bc3b55-696d-47da-85b3-7bf3feb75d4c/projects`
```json
{
  "name": "RAGForge SaaS Platform",
  "slug": "ragforge-saas",
  "description": "AI platform development"
}
```

Response (`201 Created`):
```json
{
  "id": "e81f1b2c-9a4d-4e2b-b8f1-8c9a1d2e3f4a",
  "organizationId": "67bc3b55-696d-47da-85b3-7bf3feb75d4c",
  "name": "RAGForge SaaS Platform",
  "slug": "ragforge-saas",
  "description": "AI platform development",
  "status": "ACTIVE",
  "createdById": "d748f211-547a-4ab0-8ef1-b51c890bd339",
  "creatorRole": "PROJECT_ADMIN",
  "createdAt": "2026-10-09T02:40:00.000Z",
  "updatedAt": "2026-10-09T02:40:00.000Z"
}
```

### Add Project Member
`POST /organizations/67bc3b55-696d-47da-85b3-7bf3feb75d4c/projects/e81f1b2c-9a4d-4e2b-b8f1-8c9a1d2e3f4a/members`
```json
{
  "email": "member@example.com",
  "role": "PROJECT_MEMBER"
}
```

Response (`201 Created`):
```json
{
  "userId": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "email": "member@example.com",
  "firstName": "John",
  "lastName": "Developer",
  "avatarUrl": null,
  "role": "PROJECT_MEMBER",
  "joinedAt": "2026-10-09T02:40:00.000Z"
}
```

---

## 6. Testing & Verification

- **Unit Tests**: `backend/src/projects/projects.service.spec.ts` (covers project creation, slug uniqueness, auto-admin binding, tenant membership requirement, sole project admin protection).
- **E2E Integration Tests**: `backend/test/projects.e2e-spec.ts` (18-scenario suite testing cross-tenant isolation, slug scoping per tenant, membership validation, and project lifecycle).
- **Live HTTP Verification**: `scratch/test-project-scenarios.js` (18 HTTP scenarios tested live against container API).
