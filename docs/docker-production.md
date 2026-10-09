# Production Docker & Containerization Architecture

This document describes the hardened, multi-stage production container setup for the Multi-Tenant SaaS Project Management Platform.

---

## Architecture Overview

The production deployment consists of four containerized services orchestrated via `docker-compose.prod.yml`:

| Service | Image Base | Internal Port | Multi-Stage | Non-Root User | Healthcheck |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`backend`** | `node:20-alpine` | `3001` | Yes (3-stage) | `nestjs` (UID 1001) | `curl http://localhost:3001/health` |
| **`frontend`** | `node:20-alpine` | `3000` | Yes (3-stage) | `nextjs` (UID 1001) | `curl http://localhost:3000/` |
| **`postgres`** | `postgres:16-alpine` | `5432` | N/A | `postgres` | `pg_isready` |
| **`redis`** | `redis:7-alpine` | `6379` | N/A | `redis` | `redis-cli ping` |

---

## Security Hardening & Best Practices

1. **Non-Root Execution**:
   - Backend runs as system user `nestjs` (`uid: 1001`, `gid: 1001`).
   - Frontend runs as system user `nextjs` (`uid: 1001`, `gid: 1001`).
2. **Network Isolation**:
   - `backend_network`: Connects backend, PostgreSQL, and Redis.
   - `frontend_network`: Connects frontend and backend.
   - PostgreSQL (`5432`) and Redis (`6379`) are NOT exposed on host ports in production (`docker-compose.prod.yml`).
3. **Optimized Image Sizes**:
   - Backend: Reduced from ~969MB to ~452MB (115MB compressed) using `npm prune --omit=dev`.
   - Frontend: Reduced from ~1.15GB to ~232MB (56MB compressed) leveraging Next.js `output: 'standalone'`.
4. **Graceful Shutdown**:
   - NestJS uses `app.enableShutdownHooks()` to catch `SIGTERM` / `SIGINT` signals and close database and Redis connections cleanly before process termination.
5. **Database Persistence**:
   - Named volume `postgres_prod_data` ensures PostgreSQL data persists across container restarts and updates.
   - Named volume `redis_prod_data` ensures Redis state persistence.

---

## Environment Configuration

Production environment variables are managed via `.env.production`. A template is provided in `.env.production.example`.

### Key Environment Variables

```env
# Node Environment
NODE_ENV=production

# Backend
PORT=3001
JWT_SECRET=your_production_jwt_secret_key_at_least_32_chars
JWT_REFRESH_SECRET=your_production_jwt_refresh_secret_key_at_least_32_chars
FRONTEND_URL=http://localhost:3000

# PostgreSQL
POSTGRES_USER=postgres_prod_user
POSTGRES_PASSWORD=postgres_prod_password
POSTGRES_DB=saas_platform_prod
DATABASE_URL=postgresql://postgres_prod_user:postgres_prod_password@postgres:5432/saas_platform_prod?schema=public

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=redis_prod_password
REDIS_URL=redis://:redis_prod_password@redis:6379

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## Running in Production

### 1. Build and Start Containers

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

### 2. Apply Prisma Database Migrations

```bash
docker exec saas_backend_prod npx prisma migrate deploy
```

### 3. Seed Initial System Data (Optional)

```bash
docker exec saas_backend_prod npx prisma db seed
```

### 4. Check Container Status & Health

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

---

## Verification & Testing

### Running Unit & E2E Tests in Production Container

```bash
# Run 19 Unit Test Suites (146 tests)
docker exec saas_backend_prod npx jest --maxWorkers=2

# Run 12 E2E Test Suites (168 tests)
docker exec saas_backend_prod npx jest --config ./test/jest-e2e.json --maxWorkers=2
```

---

## Phase Status

Phase 14 (Production Docker & Containerization Hardening) is **COMPLETE and VERIFIED**.
Phase 15 (CI/CD Pipelines & Cloud Deployment) has NOT been started.
