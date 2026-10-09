# Phase 5 — Role-Based Access Control (RBAC) Documentation

This document describes the design, permission matrix, execution flow, guard ordering, hierarchy rules, and verification process for Phase 5 (Role-Based Access Control) of the Multi-Tenant SaaS Project Management Platform.

---

## 1. Architecture & Execution Flow

Authorization flows through a strict 3-tier guard sequence:

```text
HTTP Request
     │
     ▼
JwtAuthGuard (Validates JWT Bearer Token -> populates req.user)
     │
     ▼
TenantGuard (Validates Organization Membership & Context -> populates req.organizationId & req.tenantRole)
     │
     ▼
PermissionsGuard (Evaluates req.user & req.organizationId against @RequirePermissions metadata in DB)
     │
     ├── ALLOWED  ──► Route Controller Handler
     └── DENIED   ──► 403 Forbidden ("Insufficient permissions. Required: <permissions>")
```

### Dynamic DB Permission Resolution
Permissions are evaluated dynamically from PostgreSQL using Prisma:
`OrganizationMember` ──► `Role` ──► `RolePermission` ──► `Permission`.

Client claims or headers are **never** trusted for permission verification.

---

## 2. RBAC Permission Matrix

The platform includes 4 system roles and 19 granular permissions:

| Permission Name | Category | Description | OWNER | ADMIN | MEMBER | VIEWER |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| `organization:read` | Organization | View organization details | ✅ | ✅ | ✅ | ✅ |
| `organization:update` | Organization | Update organization settings | ✅ | ✅ | ❌ | ❌ |
| `organization:delete` | Organization | Delete organization | ✅ | ❌ | ❌ | ❌ |
| `member:read` | Membership | View organization members | ✅ | ✅ | ✅ | ✅ |
| `member:invite` | Membership | Invite new members | ✅ | ✅ | ❌ | ❌ |
| `member:update` | Membership | Update member roles | ✅ | ✅ | ❌ | ❌ |
| `member:remove` | Membership | Remove members from organization | ✅ | ✅ | ❌ | ❌ |
| `project:create` | Projects | Create new projects | ✅ | ✅ | ✅ | ❌ |
| `project:read` | Projects | Read project details | ✅ | ✅ | ✅ | ✅ |
| `project:update` | Projects | Update projects | ✅ | ✅ | ✅ | ❌ |
| `project:delete` | Projects | Delete projects | ✅ | ✅ | ❌ | ❌ |
| `task:create` | Tasks | Create tasks | ✅ | ✅ | ✅ | ❌ |
| `task:read` | Tasks | Read task details | ✅ | ✅ | ✅ | ✅ |
| `task:update` | Tasks | Update tasks | ✅ | ✅ | ✅ | ❌ |
| `task:delete` | Tasks | Delete tasks | ✅ | ✅ | ❌ | ❌ |
| `comment:create` | Comments | Add comments to tasks | ✅ | ✅ | ✅ | ❌ |
| `comment:read` | Comments | Read task comments | ✅ | ✅ | ✅ | ✅ |
| `comment:update` | Comments | Edit task comments | ✅ | ✅ | ✅ | ❌ |
| `comment:delete` | Comments | Delete task comments | ✅ | ✅ | ✅ | ❌ |

---

## 3. Role Hierarchy & Safety Rules

Role management endpoint: `PATCH /organizations/:organizationId/members/:targetUserId/role`

### Hierarchy & Demotion Rules
1. **Admins Cannot Modify Owners**: Users with role `ADMIN` cannot demote, promote, or alter the role of an `OWNER`. Rejects with `403 Forbidden`.
2. **Admins Cannot Promote to Owner**: Users with role `ADMIN` cannot grant `OWNER` role to any member. Rejects with `403 Forbidden`.
3. **Sole Owner Protection**: An `OWNER` cannot demote themselves if they are the last remaining owner in the organization. Rejects with `403 Forbidden ("Cannot demote the sole Owner of an organization. Transfer ownership first.")`.

---

## 4. Usage in NestJS Controllers

To protect a route with permission checks, apply `JwtAuthGuard`, `TenantGuard`, `PermissionsGuard`, and `@RequirePermissions(...)`:

```typescript
@Get(':organizationId')
@UseGuards(TenantGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.ORGANIZATION_READ)
async findOne(
  @CurrentUser('id') userId: string,
  @Param('organizationId') organizationId: string,
) {
  return this.organizationsService.findOneForMember(userId, organizationId);
}
```

---

## 5. Verification & Testing

- **Unit Tests**: `backend/src/rbac/rbac.service.spec.ts` (covers `hasPermissions`, role changes, hierarchy rules, sole owner protection).
- **E2E Integration Tests**: `backend/test/rbac.e2e-spec.ts` (covers permissions matrix across all endpoints, cross-tenant isolation, guard sequence).
- **Manual Verification Script**: `scratch/test-rbac-scenarios.js` (executes 10 HTTP scenarios against live container API).
