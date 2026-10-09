# CI/CD Pipeline Architecture & Operations

This document describes the continuous integration and continuous deployment (CI/CD) automation pipeline implemented via GitHub Actions for the Multi-Tenant SaaS Project Management Platform.

---

## 1. Pipeline Overview

The CI/CD pipeline automates code quality verification, unit/E2E testing, container image building, database migration deployment, Azure Container Apps release orchestration, and post-deployment smoke testing.

```text
Developer Push / PR
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ .github/workflows/ci.yml (Pull Requests & Main Push)     │
│ ├─ PostgreSQL (16-Alpine) Service Container               │
│ ├─ Redis (7-Alpine) Service Container                    │
│ ├─ ESLint (`npm run lint`)                               │
│ ├─ Non-destructive Migration (`npx prisma migrate deploy`)│
│ ├─ 19 Unit Test Suites (146 tests)                        │
│ ├─ 12 E2E & Security Suites (168 tests)                  │
│ └─ Next.js & NestJS Production Builds                    │
└────────────────────────────┬─────────────────────────────┘
                             │ (On Merge to Main)
                             ▼
┌──────────────────────────────────────────────────────────┐
│ .github/workflows/deploy.yml (CD Release Pipeline)       │
│ ├─ Quality Gate Verification                             │
│ ├─ Docker Multi-stage Builds (`latest` & `${{ git.sha }}`)│
│ ├─ Push Images to Azure Container Registry (ACR)          │
│ ├─ Run `prisma migrate deploy` against Azure PostgreSQL  │
│ ├─ Deploy Backend Container App (Revising container)     │
│ ├─ Deploy Frontend Container App (Revising container)    │
│ └─ Automated REST & Socket.IO Smoke Test                 │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Workflows & Triggers

| Workflow File | Trigger | Concurrency | Scope |
| :--- | :--- | :--- | :--- |
| `.github/workflows/ci.yml` | `pull_request` (main), `push` (main) | `cancel-in-progress: true` | Quality gates, unit & E2E tests, isolated DB/Redis testing, Docker build verification. |
| `.github/workflows/deploy.yml` | `push` (main), `workflow_dispatch` | `cancel-in-progress: false` (Sequential) | End-to-end CD release to Azure Container Apps, ACR push, production DB migration, and smoke tests. |

---

## 3. Isolated CI Test Infrastructure

CI jobs execute in isolated GitHub-hosted Ubuntu runners (`ubuntu-latest`) using containerized service sidecars:
- **PostgreSQL 16 Service**: Containerized PostgreSQL instance running on port `5432` with healthcheck (`pg_isready`).
- **Redis 7 Service**: Containerized Redis instance running on port `6379` with healthcheck (`redis-cli ping`).
- **Non-Destructive Migrations**: Executes `npx prisma migrate deploy` against the ephemeral CI database. `prisma migrate reset` is strictly prohibited.

---

## 4. Docker Image Strategy & Tagging

1. **Multi-Stage Reusability**: Reuses production multi-stage Dockerfiles from Phase 14 ([`backend/Dockerfile`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/backend/Dockerfile) and [`frontend/Dockerfile`](file:///Users/thakurveersingh/Documents/multi-tenant-saas/frontend/Dockerfile)).
2. **Immutable Tags**:
   - `saasprodacr.azurecr.io/multi-tenant-saas-backend:<git-sha>`
   - `saasprodacr.azurecr.io/multi-tenant-saas-frontend:<git-sha>`
   - Floating tag `latest` updated concurrently for fallback reference.
3. **Build Caching**: Uses GitHub Actions cache (`type=gha`) via `docker/build-push-action` for layer reuse.

---

## 5. Required GitHub Secrets

The CD pipeline relies on the following repository secrets stored in GitHub (`Settings -> Secrets and variables -> Actions`):

```env
# Azure Credentials (OIDC or Service Principal)
AZURE_CREDENTIALS={"clientId":"...","clientSecret":"...","subscriptionId":"...","tenantId":"..."}

# Container Registry
ACR_LOGIN_SERVER=saasprodacr.azurecr.io
ACR_USERNAME=saasprodacr
ACR_PASSWORD=azure_container_registry_password_secret

# Azure Infrastructure Names
AZURE_RESOURCE_GROUP=rg-multi-tenant-saas-prod
AZURE_CONTAINER_APP_NAME=saas-prod-backend
AZURE_FRONTEND_APP_NAME=saas-prod-frontend

# Production Database & Cache Credentials
AZURE_POSTGRESQL_DATABASE_URL=postgresql://saas_admin:secret@psql-multi-tenant-saas.postgres.database.azure.com:5432/saas_platform_prod?sslmode=require
AZURE_REDIS_URL=redis://:secret@redis-multi-tenant-saas.redis.cache.windows.net:6380

# Security Tokens
JWT_SECRET=production_access_jwt_secret_at_least_32_characters
JWT_REFRESH_SECRET=production_refresh_jwt_secret_at_least_32_characters

# Production URLs
AZURE_BACKEND_URL=https://saas-prod-backend.azurecontainerapps.io
AZURE_FRONTEND_URL=https://saas-prod-frontend.azurecontainerapps.io
```

---

## 6. Rollback & Fail-Safe Strategy

In the event of a deployment anomaly or unhealthy revision:

1. **Immutable Revision Rollback**:
   To redeploy a previous known-good revision:
   ```bash
   az containerapp revision set-active \
     --name saas-prod-backend \
     --resource-group rg-multi-tenant-saas-prod \
     --revision saas-prod-backend--<previous-git-sha>
   ```
2. **ACR Image Pinning**:
   Previous image tags (e.g. `multi-tenant-saas-backend:<previous-sha>`) remain intact in Azure Container Registry indefinitely.
3. **Database Migration Policy**:
   Migrations are forward-compatible and non-destructive. Schema updates avoid dropping columns without multi-step deprecation cycles.
