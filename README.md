# Multi-Tenant SaaS Project Management Platform

A production-oriented, high-performance Multi-Tenant SaaS Project Management Platform designed for enterprise multi-tenancy, real-time collaboration, role-based access control, and scalable cloud infrastructure.

---

## Overview

This platform provides an isolated, multi-tenant workspace architecture where organizations can manage projects, tasks, and workflows seamlessly. Built with modern web technology, it supports granular access controls, real-time updates via WebSockets, and cached query performance.

---

## Tech Stack

- **Frontend:** Next.js (App Router), React, TypeScript, ESLint
- **Backend:** NestJS, TypeScript, Passport-JWT, Prisma ORM, Jest, Supertest
- **Database:** PostgreSQL (v16) with Prisma ORM (v5.22.0)
- **Cache / Pub/Sub:** Redis (v7)
- **Containerization:** Docker, Docker Compose
- **Real-Time Communication:** WebSockets (Socket.IO, `@nestjs/websockets`)
- **CI/CD (Future):** GitHub Actions
- **Cloud (Future):** Azure

---

## WebSockets & Real-Time Collaboration (Phase 11)

The backend features a real-time event broadcasting gateway built on Socket.IO (`AppWebSocketGateway` and `WebSocketService`). It provides JWT handshake authentication, tenant-scoped and project-isolated rooms (`organization:{orgId}:project:{projectId}`), authorization validation before room entry (`project:join`), structured UUID-tagged event payloads (`eventId`, `timestamp`, `type`, `organizationId`, `projectId`, `taskId`, sanitized `data`), post-commit transaction order, and fail-safe delivery guarantees. Detailed documentation is available in [`docs/websockets.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/websockets.md).

### Real-Time Event Types

- **Projects:** `project:created`, `project:updated`, `project:deleted`
- **Tasks & Kanban:** `task:created`, `task:updated`, `task:status-changed`, `task:priority-changed`, `task:assigned`, `task:reordered`, `task:deleted`
- **Comments:** `comment:created`, `comment:updated`, `comment:deleted`
- **Activity History:** `activity:created`

---

## Redis Caching & Performance (Phase 10)

The backend incorporates an in-memory Redis (`ioredis`) caching layer for query performance optimization, featuring tenant-scoped versioned keys (`v1:tenant:{orgId}:...`), Cache-Aside pattern for read endpoints (Projects, Tasks, Kanban Board, Activity History), post-mutation cache invalidations, and seamless fail-safe fallback to PostgreSQL during Redis outages. Detailed documentation is available in [`docs/redis-caching.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/redis-caching.md).

### Cache Key Versioning & Centralized TTLs

- **Project List:** `v1:tenant:{orgId}:projects:list` (TTL: 60s)
- **Project Detail:** `v1:tenant:{orgId}:project:{projectId}` (TTL: 60s)
- **Task List:** `v1:tenant:{orgId}:project:{projectId}:tasks:list:{filterHash}` (TTL: 30s)
- **Task Board:** `v1:tenant:{orgId}:project:{projectId}:board` (TTL: 30s)
- **Task Detail:** `v1:tenant:{orgId}:project:{projectId}:task:{taskId}` (TTL: 60s)
- **Activity History:** `v1:tenant:{orgId}:project:{projectId}:activity:{queryHash}` (TTL: 30s)

---

## Comments & Activity History (Phase 9)

The backend provides task comments and centralized activity audit history. Features include task comment creation, listing active comments (`createdAt ASC`), author-only content editing, author/admin soft deletion (`deletedAt`), centralized activity logging for projects/members/tasks/comments, activity retrieval with pagination (`page`, `limit`) and filtering (`eventType`, `actorId`, `taskId`), and strict tenant/project boundary protection. Detailed documentation is available in [`docs/comments-activity.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/comments-activity.md).

### Comments & Activity Endpoints

- `POST /organizations/:orgId/projects/:projId/tasks/:taskId/comments` — Create comment (`comment:create`)
- `GET /organizations/:orgId/projects/:projId/tasks/:taskId/comments` — List active comments (`comment:read`)
- `PATCH /organizations/:orgId/projects/:projId/tasks/:taskId/comments/:commentId` — Update own comment (`comment:update`)
- `DELETE /organizations/:orgId/projects/:projId/tasks/:taskId/comments/:commentId` — Soft delete comment (`comment:delete`)
- `GET /organizations/:orgId/projects/:projId/activity` — Get project activity history (`project:read`)
- `GET /organizations/:orgId/projects/:projId/tasks/:taskId/activity` — Get task activity history (`task:read`)

---

## Task Management & Kanban (Phase 8)

The backend provides a comprehensive task management and Kanban board system scoped by Organization and Project. Features include task CRUD operations, Kanban board column grouping (`TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`), Float-based numeric position ordering, status transitions, assignee validation (requiring dual Organization + Project membership), role-based project mutation access control (`PROJECT_VIEWER` read-only protection), and cross-tenant isolation attack prevention (Patterns 1–6). Detailed documentation is available in [`docs/tasks.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/tasks.md).

### Task & Kanban Endpoints

- `POST /organizations/:orgId/projects/:projId/tasks` — Create task (`task:create`)
- `GET /organizations/:orgId/projects/:projId/tasks` — List tasks with optional status/priority/assignee filters (`task:read`)
- `GET /organizations/:orgId/projects/:projId/tasks/board` — Get Kanban board grouped by column status ordered by position (`task:read`)
- `GET /organizations/:orgId/projects/:projId/tasks/:taskId` — Get task details by ID (`task:read`)
- `PATCH /organizations/:orgId/projects/:projId/tasks/:taskId` — Update task details (`task:update`)
- `PATCH /organizations/:orgId/projects/:projId/tasks/:taskId/status` — Update task status column transition (`task:update`)
- `PATCH /organizations/:orgId/projects/:projId/tasks/:taskId/assignee` — Assign task to valid project member or unassign (`task:assign`)
- `PATCH /organizations/:orgId/projects/:projId/tasks/:taskId/reorder` — Reorder task within Kanban column (`task:reorder`)
- `DELETE /organizations/:orgId/projects/:projId/tasks/:taskId` — Delete task (`task:delete`)

---

## Project Management (Phase 7)

The backend provides a complete project lifecycle layer including tenant-scoped project creation (`organizationId + slug`), project listing, details retrieval, updates, atomic deletion, project membership management, project roles (`PROJECT_ADMIN`, `PROJECT_MEMBER`, `PROJECT_VIEWER`), tenant membership validation, and sole-admin protection. Detailed documentation is available in [`docs/projects.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/projects.md).

### Project Endpoints

- `POST /organizations/:id/projects` — Create project inside active organization (`project:create`)
- `GET /organizations/:id/projects` — List projects belonging to organization (`project:read`)
- `GET /organizations/:id/projects/:projectId` — Get project details by ID (`project:read`)
- `PATCH /organizations/:id/projects/:projectId` — Update project details (`project:update`)
- `DELETE /organizations/:id/projects/:projectId` — Delete project and members (`project:delete`)
- `GET /organizations/:id/projects/:projectId/members` — List project members (`project:read`)
- `POST /organizations/:id/projects/:projectId/members` — Add organization member to project (`project:update`)
- `PATCH /organizations/:id/projects/:projectId/members/:targetUserId/role` — Update project member role (`project:update`)
- `DELETE /organizations/:id/projects/:projectId/members/:targetUserId` — Remove member from project (`project:update`)

---

## Organization & Member Management (Phase 6)

The backend provides a complete membership lifecycle including member addition, role updates, member removal, leaving organizations, ownership safety rules, and strict tenant isolation. Detailed documentation is available in [`docs/organization-members.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/organization-members.md).

### Organization & Membership Endpoints

- `GET /organizations/:id/members` — List members of an organization (`member:read`)
- `POST /organizations/:id/members` — Add existing user by email (`member:create`)
- `PATCH /organizations/:id/members/:targetUserId/role` — Update member role (`member:update`)
- `DELETE /organizations/:id/members/:targetUserId` — Remove member from organization (`member:delete`)
- `POST /organizations/:id/leave` — Leave organization (Tenant member context, sole-owner protected)

---

## Role-Based Access Control - RBAC (Phase 5)

The backend enforces dynamic, fine-grained Role-Based Access Control (RBAC) across 4 system roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) and 19 granular permissions. Permissions are dynamically evaluated from PostgreSQL using `RbacService`, `PermissionsGuard`, and `@RequirePermissions(...)`. Detailed RBAC documentation is available in [`docs/rbac.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/rbac.md).

### Role Management & RBAC Endpoints

- `PATCH /organizations/:organizationId/members/:targetUserId/role` — Update member role (Requires `member:update` permission, enforces hierarchy & sole-owner protection)

---

## Multi-Tenancy & Tenant Isolation (Phase 4)

The backend enforces application-level multi-tenancy and workspace isolation via `OrganizationMember` membership verification and `X-Organization-Id` header resolution. Detailed documentation is available in [`docs/multi-tenancy.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/multi-tenancy.md).

### Organization & Tenancy Endpoints

- `POST /organizations` — Create organization & bind creator as `OWNER` (`{ name, slug, description }`)
- `GET /organizations` — List all organizations the authenticated user belongs to
- `GET /organizations/current` — Get current workspace context (Requires `Authorization: Bearer` and `X-Organization-Id` header)
- `GET /organizations/:id` — Get organization details (Enforces member access, `403 Forbidden` if non-member)
- `PATCH /organizations/:id` — Update organization details (Enforces member access)
- `GET /organizations/:id/members` — List members of an organization (Enforces member access)

---

## Authentication System (Phase 3)

The backend provides a stateless **JWT Access Token** + **Hashed Refresh Token Rotation** authentication system. Detailed authentication documentation is available in [`docs/authentication.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/authentication.md).

### Auth API Endpoints

- `POST /auth/register` — Register new user
- `POST /auth/login` — Authenticate user
- `POST /auth/refresh` — Refresh access token with token rotation
- `POST /auth/logout` — Revoke refresh token
- `GET /auth/me` — Get current user profile

---

## Database Architecture

The platform uses **PostgreSQL 16** with **Prisma ORM**. Detailed database documentation and ER diagrams are available in [`docs/database.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/database.md).

### Entities (13 Models)
- `User`, `Organization`, `OrganizationMember`, `Role`, `Permission`, `RolePermission`, `Project`, `ProjectMember`, `Task`, `Comment`, `ActivityLog`, `Notification`, `RefreshToken`.

---

## Project Structure

```text
multi-tenant-saas/
│
├── frontend/             # Next.js frontend application
│   ├── app/              # App router pages and layouts
│   ├── components/       # Shared UI components
│   ├── lib/              # Client utilities and helpers
│   ├── hooks/            # Custom React hooks
│   ├── services/         # API services
│   ├── types/            # TypeScript type definitions
│   ├── public/           # Static assets
│   ├── Dockerfile        # Frontend development container configuration
│   └── package.json
│
├── backend/              # NestJS backend application
│   ├── prisma/           # Prisma ORM schema and seed scripts
│   │   ├── schema.prisma # 13 database entities and relations
│   │   └── seed.ts       # Development data seeder
│   ├── src/              # Application source code
│   │   ├── tenancy/      # TenancyModule, TenancyService, TenantGuard, @CurrentOrganization
│   │   ├── organizations/# OrganizationsModule, Controller, Service, DTOs
│   │   ├── auth/         # AuthModule, Controller, Service, JwtStrategy, JwtAuthGuard
│   │   ├── common/       # Cross-cutting concerns
│   │   ├── config/       # Configuration loaders
│   │   ├── database/     # PrismaModule and PrismaService
│   │   ├── health/       # Health check module with DB verification
│   │   ├── app.module.ts # Root application module
│   │   └── main.ts       # Application entry point with global ValidationPipe
│   ├── test/             # End-to-end integration tests
│   │   ├── tenancy.e2e-spec.ts# E2E Multi-tenancy & Tenant isolation tests
│   │   ├── auth.e2e-spec.ts   # E2E Authentication tests
│   │   └── health.e2e-spec.ts # E2E Health check tests
│   ├── Dockerfile        # Backend development container configuration
│   └── package.json
│
├── docker/               # Additional Docker scripts and configuration
├── docs/                 # Platform documentation
│   ├── multi-tenancy.md  # Multi-tenancy & tenant isolation architecture documentation
│   ├── authentication.md # Authentication system architecture documentation
│   └── database.md       # Database architecture & ER diagram documentation
├── .github/              # GitHub Action workflows and templates
│   └── workflows/
│
├── docker-compose.yml    # Root Docker Compose orchestration setup
├── .env.example          # Environment variable template
├── .gitignore            # Git exclusion rules
└── README.md             # Project documentation
```

---

## Local Development

### Prerequisites

- Node.js (v20+)
- npm (v10+)
- Docker & Docker Compose

### Backend Setup

```bash
cd backend
npm install
npx prisma generate
npm run start:dev
```

Backend server will run on `http://localhost:3001`.

### Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend application will run on `http://localhost:3000`.

---

## Running with Docker

To spin up all services in isolated containers:

```bash
# Build and start all services
docker compose up --build -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

---

## Environment Variables

Copy `.env.example` to `.env` before running locally:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | Runtime environment | `development` |
| `BACKEND_PORT` | Port for backend NestJS service | `3001` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@postgres:5432/saas_platform?schema=public` |
| `NEXT_PUBLIC_API_URL` | API base URL for frontend | `http://localhost:3001` |
| `POSTGRES_HOST` | PostgreSQL hostname | `postgres` |
| `POSTGRES_PORT` | PostgreSQL port | `5432` |
| `POSTGRES_DB` | Database name | `saas_platform` |
| `POSTGRES_USER` | Database user | `postgres` |
| `POSTGRES_PASSWORD` | Database password | `postgres` |
| `REDIS_HOST` | Redis host | `redis` |
| `REDIS_PORT` | Redis port | `6379` |
| `JWT_SECRET` | Secret key for JWT signing | `change_me_local_jwt_secret_key_987654321` |
| `JWT_ACCESS_EXPIRES_IN` | Access token expiration | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token expiration | `7d` |

---

## Notifications & Real-Time Notification Delivery (Phase 12)

The backend features a comprehensive multi-tenant notification system integrated with PostgreSQL, Redis, and WebSockets. It delivers real-time notifications for platform events (task assignments, status changes, comments, project member lifecycle, role changes) while ensuring strict tenant isolation and suppressing self-notifications. Detailed documentation is available in [`docs/notifications.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/notifications.md).

### Notification Endpoints & Features

- `GET /notifications` — List user's notifications (supports pagination `page`, `limit`, `unread=true`)
- `GET /notifications/unread-count` — Get count of unread notifications (cached in Redis)
- `GET /notifications/:notificationId` — Fetch single notification details
- `PATCH /notifications/:notificationId/read` — Mark single notification as read
- `PATCH /notifications/read-all` — Mark all unread notifications as read
- **WebSocket Room Delivery:** Real-time `notification:new` events delivered to personal user room `user:{userId}`.
- **Self-Notification Suppression:** Automatically skips generating notifications when `actorId === recipientId`.

## Comprehensive Testing & Quality Hardening (Phase 13)

The project includes a comprehensive quality assurance, security boundary, and regression-hardening suite across 31 test suites (314 tests total). It validates service logic correctness, REST API contracts, multi-tenant workspace boundaries, RBAC permissions, owner safety rules, transaction rollback consistency, Redis cache fallback resilience, and WebSocket room isolation with zero event leakage. Detailed testing documentation is available in [`docs/testing.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/testing.md).

### Test Commands

```bash
# Run unit tests (19 test suites, 146 unit tests)
docker exec saas_backend npm run test

# Run E2E & security tests (12 test suites, 168 E2E tests)
docker exec saas_backend npm run test:e2e

# Run test coverage report
docker exec saas_backend npm run test:cov

# Run ESLint check (0 errors)
docker exec saas_backend npm run lint

# Run production build check
docker exec saas_backend npm run build
```

## Production Docker & Containerization Hardening (Phase 14)

The platform features a hardened, multi-stage production container setup managed via `docker-compose.prod.yml`. Key features include non-root execution (`nestjs` UID 1001, `nextjs` UID 1001), isolated bridge networks (`backend_network`, `frontend_network`), hidden internal database/Redis ports, Next.js standalone output (232MB image size), NestJS pruned dependencies (452MB image size), graceful shutdown hooks (`SIGTERM`/`SIGINT`), persistent PostgreSQL and Redis named volumes, and production healthchecks. Detailed documentation is available in [`docs/docker-production.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/docker-production.md).

### Production Docker Commands

```bash
# Build and launch production stack
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

# Run database migrations in production container
docker exec saas_backend_prod npx prisma migrate deploy

# Seed production database (optional)
docker exec saas_backend_prod npx prisma db seed

# Run unit tests in production container (19 suites, 146 tests)
docker exec saas_backend_prod npx jest --maxWorkers=2

# Run E2E tests in production container (12 suites, 168 tests)
docker exec saas_backend_prod npx jest --config ./test/jest-e2e.json --maxWorkers=2
```

## CI/CD Pipeline & Azure Deployment (Phase 15)

The platform features automated Continuous Integration (CI) and Continuous Deployment (CD) workflows powered by GitHub Actions ([`.github/workflows/ci.yml`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/.github/workflows/ci.yml) and [`.github/workflows/deploy.yml`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/.github/workflows/deploy.yml)) targeting Microsoft Azure:

- **CI Pipeline**: Triggers on pull requests and pushes to `main`. Executes containerized PostgreSQL 16 & Redis 7 services, ESLint checks, Prisma migrations (`npx prisma migrate deploy`), 19 unit test suites (146 tests), 12 E2E suites (168 tests), Next.js & NestJS production builds, and Docker build verifications.
- **CD Pipeline**: Triggers on `main` push or manual dispatch. Builds multi-stage production images, tags with Git SHA and `latest`, pushes to Azure Container Registry (ACR), applies non-destructive database migrations against Azure PostgreSQL Flexible Server, deploys Azure Container Apps for backend and frontend, and runs post-deployment REST & Socket.IO smoke tests.
- Detailed CI/CD architecture documentation is available in [`docs/ci-cd.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/ci-cd.md) and Azure infrastructure specification is in [`docs/azure-deployment.md`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/docs/azure-deployment.md).

---

## Current Status

- **Phase 1 Complete:** Project Initialization & Development Environment
- **Phase 2 Complete:** PostgreSQL Database Architecture
- **Phase 3 Complete:** Production Authentication System
- **Phase 4 Complete:** Multi-Tenancy & Tenant Isolation
- **Phase 5 Complete:** Role-Based Access Control (RBAC)
- **Phase 6 Complete:** Organization & Member Management
- **Phase 7 Complete:** Project Management
- **Phase 8 Complete:** Task Management & Kanban
- **Phase 9 Complete:** Comments & Activity History
- **Phase 10 Complete:** Redis Caching & Performance
- **Phase 11 Complete:** WebSockets & Real-Time Collaboration
- **Phase 12 Complete:** Notifications & Real-Time Notification Delivery
- **Phase 13 Complete:** Comprehensive Testing & Quality Hardening
- **Phase 14 Complete:** Production Docker & Containerization Hardening
- **Phase 15 Complete:** CI/CD & Azure Deployment (GitHub Actions CI/CD workflows, ACR image pushing with Git SHA tags, Azure Container Apps deployment, Azure PostgreSQL Flexible Server non-destructive migrations, Azure Cache for Redis integration, secret references, Socket.IO WebSockets over ACA, automated REST & WebSocket post-deployment smoke tests, 100% test pass rate across 314 tests)

---

## Upcoming Phases

- **Phase 16:** Advanced Application Security Hardening




