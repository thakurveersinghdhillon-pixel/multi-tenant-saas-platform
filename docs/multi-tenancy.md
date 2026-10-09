# Multi-Tenancy & Tenant Isolation Architecture Documentation — Phase 4

## 1. Overview

The Multi-Tenant SaaS Project Management Platform enforces strict **Application-Level Multi-Tenancy** and **Tenant Isolation**. Every enterprise workspace operates as an isolated `Organization` tenant. A user can belong to multiple organizations, but data access across organizations is completely partitioned.

---

## 2. Multi-Tenant Architecture & Flow

```text
                    Request
                       │
                       ▼
               JWT Authentication (User ID)
                       │
                       ▼
               X-Organization-Id (Header)
                       │
                       ▼
             Membership Validation (TenantGuard)
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
      FAIL (Not Member)     PASS (Active Member)
             │                   │
             ▼                   ▼
       403 Forbidden     Tenant Context Established
                                 │
                                 ▼
                        Tenant-Scoped Query
                                 │
                                 ▼
                            PostgreSQL
```

---

## 3. Core Architectural Decisions

### A. JWT vs. Header-Based Organization Context
- **Decision**: Keep `sub = userId` in the JWT and specify the target organization via the `X-Organization-Id` request header.
- **Rationale**: A user can be a member of multiple organizations (`User -> OrganizationMember[]`). Embedding `organizationId` in the JWT would force token re-issuance on workspace switches. Using the `X-Organization-Id` header allows instant workspace switching per HTTP request without invalidating access tokens.

### B. Tenant Context Resolution (`TenancyService`)
`TenancyService.validateAndGetTenantContext(userId, organizationId)` performs strict central validation:
1. Verifies that `X-Organization-Id` header is present (throws `400 Bad Request` if missing).
2. Verifies that `X-Organization-Id` is a valid RFC4122 v4 UUID (throws `400 Bad Request` if malformed).
3. Queries `OrganizationMember` table for active `[organizationId, userId]` membership.
4. Differentiates `404 Not Found` (non-existent organization) vs. `403 Forbidden` (existing organization where user is NOT a member).

### C. Tenant Guard (`TenantGuard`)
- Custom NestJS guard protecting tenant endpoints.
- Runs after `JwtAuthGuard` ensures `request.user` is present.
- Extracts `X-Organization-Id` header (case-insensitive), resolves tenant context via `TenancyService`, and attaches:
  - `request.organization`
  - `request.organizationMember`
  - `request.organizationId`
  - `request.tenantRole`
- Exposes `@CurrentOrganization()` decorator for controllers and services.

### D. Atomic Organization Creation & OWNER Binding
`OrganizationsService.create` executes an atomic Prisma Transaction (`prisma.$transaction`):
1. Verifies unique slug availability.
2. Creates the `Organization` record.
3. Automatically binds the creator as an `OrganizationMember` assigned to the system `OWNER` role.
4. If membership creation fails, the entire transaction rolls back.

---

## 4. API Endpoints

| Method | Endpoint | Auth Guard | Tenant Guard | Request Body / Headers | Description |
|---|---|---|---|---|---|
| `POST` | `/organizations` | `JwtAuthGuard` | No | `{ name, slug, description }` | Create organization & receive `OWNER` role |
| `GET` | `/organizations` | `JwtAuthGuard` | No | None | List organizations user belongs to |
| `GET` | `/organizations/current` | `JwtAuthGuard` | `TenantGuard` | Header: `X-Organization-Id` | Get current workspace tenant context |
| `GET` | `/organizations/:id` | `JwtAuthGuard` | Scoped | None | Get organization details (requires membership) |
| `PATCH` | `/organizations/:id` | `JwtAuthGuard` | Scoped | `{ name, slug, description }` | Update organization (requires membership) |
| `GET` | `/organizations/:id/members` | `JwtAuthGuard` | Scoped | None | List organization members (requires membership) |

---

## 5. Security & Cross-Tenant Attack Prevention

1. **Member-Only Data Access**: If User A belongs to Org A and attempts to access Org B (`/organizations/OrgB` or `X-Organization-Id: OrgB`), the server returns `403 Forbidden` without returning data.
2. **Organization Enumeration Prevention**: Access attempts to non-member organizations return `403 Forbidden`, preventing unauthorized users from enumerating workspace metadata.
3. **Tenant-Aware Query Strategy**: All future database queries for tenant-owned resources MUST explicitly include `organizationId` in the Prisma `where` clause:
   ```typescript
   // Correct Pattern:
   prisma.project.findMany({ where: { organizationId } });
   ```
4. **Prisma Transactions**: Atomic organization creation prevents orphaned organizations without assigned owners.

---

## 6. Tenant Isolation Test Matrix

| User Context | Target Workspace | Request Header | Result | Expected Status |
|---|---|---|---|---|
| User A (Member of Org A) | Org A | `X-Organization-Id: Org A` | **PASS** | `200 OK` |
| User B (Member of Org B) | Org B | `X-Organization-Id: Org B` | **PASS** | `200 OK` |
| User A (Non-Member of Org B) | Org B | `X-Organization-Id: Org B` | **DENY** | `403 Forbidden` |
| User B (Non-Member of Org A) | Org A | `X-Organization-Id: Org A` | **DENY** | `403 Forbidden` |
| Unauthenticated User | Org A | `X-Organization-Id: Org A` | **DENY** | `401 Unauthorized` |
| Authenticated User | Any | Header Missing | **DENY** | `400 Bad Request` |
| Authenticated User | Any | Header Malformed (`not-a-uuid`) | **DENY** | `400 Bad Request` |
| Authenticated User | Non-Existent | Header `00000000-...` | **DENY** | `404 Not Found` |
