# Phase 6 — Organization & Member Management Documentation

This document describes the design, membership lifecycle, API endpoints, ownership safety rules, tenant isolation, transactional integrity, and verification process for Phase 6 of the Multi-Tenant SaaS Project Management Platform.

---

## 1. Membership Lifecycle Overview

The platform supports a complete membership lifecycle:

```text
               Add Member (by Email)
                   POST /members
                         │
                         ▼
             Active Organization Member
            (OWNER / ADMIN / MEMBER / VIEWER)
            ┌────────────┴────────────┐
            ▼                         ▼
   Role Change (PATCH)       Remove Member (DELETE) / Leave (POST /leave)
```

1. **Member Addition (`POST /organizations/:organizationId/members`)**: Organization administrators add existing users by email. Target users receive the specified role (`OWNER`, `ADMIN`, `MEMBER`, or `VIEWER`).
2. **Member Removal (`DELETE /organizations/:organizationId/members/:targetUserId`)**: Authorized users remove members from the organization.
3. **Leave Organization (`POST /organizations/:organizationId/leave`)**: Members voluntarily leave an organization without deleting their User account or impacting memberships in other organizations.
4. **Member Details (`GET /organizations/:organizationId/members`)**: Lists all members of an organization with safe user details (`userId`, `email`, `firstName`, `lastName`, `avatarUrl`, `role`, `joinedAt`).

---

## 2. API Endpoints

| Method | Endpoint | Protection / Guards | Required Permission | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/organizations/:id/members` | `TenantGuard, PermissionsGuard` | `member:read` | List all members of the organization |
| `POST` | `/organizations/:id/members` | `TenantGuard, PermissionsGuard` | `member:create` | Add an existing user to organization by email |
| `PATCH` | `/organizations/:id/members/:targetUserId/role` | `TenantGuard, PermissionsGuard` | `member:update` | Update member role in organization |
| `DELETE` | `/organizations/:id/members/:targetUserId` | `TenantGuard, PermissionsGuard` | `member:delete` | Remove a member from the organization |
| `POST` | `/organizations/:id/leave` | `TenantGuard` | Tenant Member | Voluntarily leave the organization |

---

## 3. Ownership Safety & Role Hierarchy Rules

Backend validation enforces strict safety rules:

1. **At Least One Owner**: Every organization must maintain at least one active `OWNER`.
2. **Sole Owner Removal Protection**: The sole `OWNER` of an organization cannot be removed (`403 Forbidden`). Ownership must be transferred or another owner added first.
3. **Sole Owner Leave Protection**: The sole `OWNER` cannot leave the organization (`403 Forbidden`).
4. **Sole Owner Demotion Protection**: The sole `OWNER` cannot demote themselves (`403 Forbidden`).
5. **Admin Hierarchy Restrictions**:
   - `ADMIN` cannot add or promote someone to `OWNER` (`403 Forbidden`).
   - `ADMIN` cannot remove an `OWNER` (`403 Forbidden`).
   - `ADMIN` cannot remove another `ADMIN` (`403 Forbidden`).
6. **Cross-Tenant Protection**: Membership queries and operations are strictly scoped by `organizationId_userId` compound index in PostgreSQL. Cross-tenant access is rejected with `403 Forbidden`.

---

## 4. Transactional Integrity

All multi-step state mutations (adding members, removing members, leaving organizations) execute inside atomic Prisma transactions (`prisma.$transaction(async (tx) => { ... })`).

---

## 5. Example Requests & Responses

### Add Member
`POST /organizations/67bc3b55-696d-47da-85b3-7bf3feb75d4c/members`
```json
{
  "email": "user@example.com",
  "role": "MEMBER"
}
```

Response (`201 Created`):
```json
{
  "userId": "d748f211-547a-4ab0-8ef1-b51c890bd339",
  "email": "user@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "avatarUrl": null,
  "role": "MEMBER",
  "joinedAt": "2026-10-09T02:31:00.000Z"
}
```

### Remove Member
`DELETE /organizations/67bc3b55-696d-47da-85b3-7bf3feb75d4c/members/d748f211-547a-4ab0-8ef1-b51c890bd339`

Response (`200 OK`):
```json
{
  "message": "Member successfully removed from organization",
  "userId": "d748f211-547a-4ab0-8ef1-b51c890bd339",
  "organizationId": "67bc3b55-696d-47da-85b3-7bf3feb75d4c"
}
```

### Leave Organization
`POST /organizations/67bc3b55-696d-47da-85b3-7bf3feb75d4c/leave`

Response (`200 OK`):
```json
{
  "message": "Successfully left the organization",
  "organizationId": "67bc3b55-696d-47da-85b3-7bf3feb75d4c"
}
```

---

## 6. Testing & Verification

- **Unit Tests**: `backend/src/organizations/organizations.service.spec.ts` (covers addMember, removeMember, leaveOrganization, hierarchy rules, sole owner checks).
- **E2E Security Tests**: `backend/test/organization-members.e2e-spec.ts` (12-step realistic scenario covering User A/B/C, Org A/B, access revocation, cross-tenant isolation, leaving).
- **Live HTTP Verification**: `scratch/test-member-scenarios.js` (12 scenarios executed against live container backend).
