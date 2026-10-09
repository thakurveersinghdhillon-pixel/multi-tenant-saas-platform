# Phase 10 — Redis Caching & Performance Documentation

This document describes the design, architecture, key strategies, TTL configurations, post-mutation cache invalidations, resilience/fallback handling, and verification process for Phase 10 (Redis Caching & Performance) of the Multi-Tenant SaaS Project Management Platform.

---

## 1. Architecture & Redis Integration

Redis is integrated as a high-performance in-memory cache layer in front of PostgreSQL, reducing database load and speeding up read queries for tenant resources.

```text
HTTP Request
     │
     ▼
NestJS REST Controllers (Guards & Tenancy Validation)
     │
     ▼
RedisService (Cache-Aside Lookup) ──────[Cache HIT]────► Return Cached JSON Response
     │
 [Cache MISS or Outage]
     │
     ▼
PrismaService ──► PostgreSQL (Source-of-Truth DB)
     │
     ▼
Write-Back to Redis (with TTL) & Return Response
```

### Key Components

- **`RedisModule`** (`backend/src/redis/redis.module.ts`): Decorated with `@Global()`, providing `RedisService` application-wide.
- **`RedisService`** (`backend/src/redis/redis.service.ts`): Encapsulates `ioredis` client instantiation, event listeners (`connect`, `error`), connection health tracking, and methods (`get`, `set`, `del`, `delMany`, `exists`, `invalidateByPrefix`).
- **`CacheKeys`** (`backend/src/redis/cache-keys.ts`): Provides deterministic, versioned, tenant-isolated cache keys and filter hashing.
- **`redis.constants.ts`** (`backend/src/redis/redis.constants.ts`): Centralized TTL definitions and logging prefixes.

---

## 2. Key Strategy & Tenant Isolation

To prevent cross-tenant data leakage, **every cache key includes the tenant Organization ID** and version prefix:

`v1:tenant:{organizationId}:...`

### Cache Key Definitions

| Resource | Key Format | TTL |
| :--- | :--- | :--- |
| **Project List** | `v1:tenant:{organizationId}:projects:list` | 60 seconds |
| **Project Detail** | `v1:tenant:{organizationId}:project:{projectId}` | 60 seconds |
| **Task List** | `v1:tenant:{organizationId}:project:{projectId}:tasks:list:{filterHash}` | 30 seconds |
| **Task Board** | `v1:tenant:{organizationId}:project:{projectId}:board` | 30 seconds |
| **Task Detail** | `v1:tenant:{organizationId}:project:{projectId}:task:{taskId}` | 60 seconds |
| **Project Activity** | `v1:tenant:{organizationId}:project:{projectId}:activity:{queryHash}` | 30 seconds |
| **Task Activity** | `v1:tenant:{organizationId}:project:{projectId}:task:{taskId}:activity:{queryHash}` | 30 seconds |

---

## 3. Cache-Aside Pattern & TTLs

Read operations follow the **Cache-Aside** (Lazy Loading) pattern:

1. Validate caller authentication and tenant context.
2. Check Redis using tenant-scoped key.
3. If **Cache HIT**, return cached JSON data immediately.
4. If **Cache MISS**, query PostgreSQL via Prisma.
5. Store result in Redis with configured TTL.
6. Return data to client.

### Centralized TTL Configurations

```typescript
export const CACHE_TTL = {
  PROJECT_LIST: 60,   // 60 seconds
  PROJECT_DETAIL: 60, // 60 seconds
  TASK_LIST: 30,      // 30 seconds
  TASK_BOARD: 30,     // 30 seconds
  TASK_DETAIL: 60,    // 60 seconds
  ACTIVITY: 30,       // 30 seconds
} as const;
```

---

## 4. Post-Mutation Cache Invalidation

To maintain data consistency, PostgreSQL mutations **MUST complete successfully before Redis keys are invalidated**.

```text
Client Mutation Request (Create/Update/Delete Task or Project)
     │
     ▼
Prisma Atomic DB Transaction ($transaction) ──► PostgreSQL Updated (Source-of-Truth)
     │
 [DB Transaction Committed Successfully]
     │
     ▼
RedisService Invalidation (del / invalidateByPrefix)
     │
     ▼
Return Response to Client
```

### Invalidation Triggers

- **Project Created**: Invalidates `v1:tenant:{orgId}:projects:*`.
- **Project Updated**: Invalidates project detail `v1:tenant:{orgId}:project:{projectId}` & project list `v1:tenant:{orgId}:projects:*`.
- **Project Deleted**: Purges all project keys `v1:tenant:{orgId}:project:{projectId}*` & list.
- **Task Created/Updated/Reordered/Deleted**: Purges project task list, board, detail, and activity caches `v1:tenant:{orgId}:project:{projectId}*`.
- **Comment Created/Updated/Deleted**: Purges project/task activity and detail caches under project.

---

## 5. Resilience & Outage Fallback

PostgreSQL remains the single source-of-truth. If Redis experiences a connection failure, network timeout, or container shutdown:

1. `RedisService` catches errors silently and marks internal health state `isHealthy = false`.
2. All `get()` calls gracefully return `null` (forcing fallback to PostgreSQL).
3. All `set()`, `del()`, and `invalidateByPrefix()` calls exit silently without throwing exceptions.
4. Application continues serving HTTP requests without throwing 500 errors.

---

## 6. Verification Summary

### Unit Tests
- `backend/src/redis/redis.service.spec.ts`: Unit tests covering connected state, error handling, `delMany`, and `invalidateByPrefix`.
- Updated unit test suites: `projects.service.spec.ts`, `tasks.service.spec.ts`, `activity.service.spec.ts`.
- **96 / 96 Unit Tests Passed** across 11 test suites.

### End-to-End Tests
- `backend/test/redis-caching.e2e-spec.ts`: Validates Cache HIT/MISS, post-mutation invalidations, and strict tenant cache isolation.
- **126 / 126 E2E Tests Passed** across 9 test suites.

### Live Verification & Outage Simulation
- Executed `scratch/test-redis-caching.js` against live backend container (`http://localhost:3001`).
- Simulated Redis container outage (`docker compose stop redis`) -> All HTTP APIs continued functioning seamlessly via PostgreSQL fallback.
