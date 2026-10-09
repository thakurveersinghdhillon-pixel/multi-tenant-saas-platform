# Phase 11 — WebSockets & Real-Time Collaboration

## Overview

The WebSockets architecture in the Multi-Tenant SaaS Project Management Platform provides secure, tenant-isolated, real-time collaboration. It broadcasts events to connected clients whenever projects, tasks, Kanban boards, comments, or activity logs are created, updated, or deleted via REST API endpoints.

---

## 1. Gateway & Authentication

### Gateway: `AppWebSocketGateway`
- **Transport**: Socket.IO (`@nestjs/platform-socket.io`)
- **CORS**: Enabled for cross-origin frontend client connections (`origin: '*'`, `credentials: true`).
- **Middleware Handshake Authentication**:
  - JWT access tokens are extracted during socket connection setup from:
    1. `socket.handshake.auth.token`
    2. `socket.handshake.headers.authorization` (`Bearer <token>`)
  - Tokens are validated using `JwtService.verify()`.
  - User active status (`isActive: true`) is verified via PostgreSQL query before allowing socket connection.
  - Sockets with invalid, missing, or inactive user tokens are immediately rejected during handshake (`connect_error`).

---

## 2. Room Management & Multi-Tenant Isolation

Rooms are strictly scoped by tenant and project:

```
organization:{organizationId}:project:{projectId}
```

### Inbound Events

#### `project:join`
- **Payload**: `{ organizationId: string, projectId: string }`
- **Validation**:
  1. Validates user membership in `organizationId` (`TenancyService`).
  2. Verifies project exists within `organizationId`.
  3. Validates user membership in `projectId` (`ProjectMember`).
- **Response**:
  - Success: `{ success: true, room: "organization:{orgId}:project:{projectId}", message: "..." }`
  - Rejection: `{ success: false, error: { code: "PROJECT_ACCESS_DENIED", message: "..." } }`

#### `project:leave`
- **Payload**: `{ organizationId: string, projectId: string }`
- **Action**: Removes socket from the specified project room.

---

## 3. Event Catalog & Payload Schema

All outbound real-time broadcast payloads adhere to the standard contract:

```typescript
interface WebSocketEventPayload<T = any> {
  eventId: string;        // UUID v4
  organizationId: string; // Tenant ID
  projectId: string;      // Scope ID
  taskId?: string;        // Optional Task ID
  type: string;           // Event type string (e.g., 'task:created')
  timestamp: string;      // ISO 8601 string
  actor?: {
    id: string;
    email: string;
  };
  data: T;                // Event data (sanitized, no passwords/tokens)
}
```

### Supported Events

| Event Category | Event Name | Trigger |
| :--- | :--- | :--- |
| **Project** | `project:created` | New project created in organization |
| | `project:updated` | Project details updated |
| | `project:deleted` | Project deleted |
| **Task & Kanban** | `task:created` | Task created |
| | `task:updated` | Task details updated |
| | `task:status-changed` | Task moved across Kanban columns (TODO, IN_PROGRESS, IN_REVIEW, DONE) |
| | `task:priority-changed` | Task priority changed (LOW, MEDIUM, HIGH, URGENT) |
| | `task:assigned` | Assignee changed |
| | `task:reordered` | Task reordered within Kanban column |
| | `task:deleted` | Task removed |
| **Comment** | `comment:created` | New comment posted |
| | `comment:updated` | Comment content edited |
| | `comment:deleted` | Comment soft-deleted |
| **Activity** | `activity:created` | New activity log recorded |

---

## 4. Delivery Safety & Transaction Order

1. **Post-Commit Emission**: WebSockets emissions are executed AFTER PostgreSQL database transactions successfully commit (`$transaction`).
2. **Non-Fatal Resilience**: All WebSocket emissions are wrapped in error boundaries (`try/catch`). Network or client socket errors will NEVER roll back database transactions or cause REST API requests to fail (HTTP 500).
3. **Data Sanitization**: Payload data is sanitized recursively to strip sensitive fields (`password`, `passwordHash`, `refreshToken`, `secret`) before broadcasting.

---

## 5. Testing & Verification

- **Unit Tests**: `src/websocket/websocket.service.spec.ts` & `src/websocket/websocket.gateway.spec.ts` (100% pass rate).
- **E2E Tests**: `test/websocket.e2e-spec.ts` (Covering auth rejection, cross-tenant room join rejection, REST mutation -> WS broadcast delivery, payload sanitization).
- **Live Script Verification**: `scratch/test-websocket.js` verified live against running backend container (`http://localhost:3001`).
