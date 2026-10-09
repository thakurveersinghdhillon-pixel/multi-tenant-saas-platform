# Azure Infrastructure & Deployment Architecture

This document details the production Azure cloud deployment architecture, resource configurations, networking, database migration, WebSocket routing, and CORS policies for the Multi-Tenant SaaS Project Management Platform.

---

## 1. Production Architecture Overview

The platform is deployed to Microsoft Azure using serverless containerized services and managed database/caching infrastructure:

```text
                                  Internet
                                     │
                                     ▼
                     ┌──────────────────────────────┐
                     │ Azure Container Apps Ingress │
                     └──────────────┬───────────────┘
                                    │
             ┌──────────────────────┴──────────────────────┐
             │                                             │
             ▼                                             ▼
┌───────────────────────────┐                 ┌───────────────────────────┐
│ Azure Container App       │                 │ Azure Container App       │
│ (Frontend: Next.js)       │                 │ (Backend: NestJS)         │
│ Port 3000                 │                 │ Port 3001                 │
│ Standalone Node           │                 │ WebSockets & REST         │
└───────────────────────────┘                 └─────────────┬─────────────┘
                                                            │
                                    ┌───────────────────────┴───────────────────────┐
                                    │                                               │
                                    ▼                                               ▼
                      ┌───────────────────────────┐                   ┌───────────────────────────┐
                      │ Azure Database for        │                   │ Azure Cache for Redis     │
                      │ PostgreSQL Flexible Server│                   │ Enterprise / Premium      │
                      │ Port 5432 (SSL Required)  │                   │ Port 6380 (TLS Required)  │
                      └───────────────────────────┘                   └───────────────────────────┘
```

---

## 2. Resource Specifications

| Resource Name | Azure Service Type | SKU / Tier | Purpose |
| :--- | :--- | :--- | :--- |
| `rg-multi-tenant-saas-prod` | Resource Group | N/A | Central resource container for all production assets. |
| `saasprodacr` | Azure Container Registry (ACR) | Basic / Standard | Private container image repository for backend and frontend images. |
| `saas-prod-backend` | Azure Container Apps | 0.5 vCPU / 1.0 GiB | NestJS REST API and Socket.IO gateway serverless container. |
| `saas-prod-frontend` | Azure Container Apps | 0.25 vCPU / 0.5 GiB | Next.js App Router standalone production container. |
| `psql-multi-tenant-saas` | Azure Database for PostgreSQL Flexible Server | Burstable B1ms / General Purpose | Managed PostgreSQL 16 database with automated backups and SSL encryption. |
| `redis-multi-tenant-saas` | Azure Cache for Redis | Basic C0 / Standard C1 | Managed Redis 7 cache for versioned tenant queries and unread notification counts. |

---

## 3. Environment Variables & Secret Configuration

Production application secrets are managed securely in Azure Container Apps using secret references (`secretref:`), avoiding plaintext environment values:

```env
# Managed Secret References in Azure Container Apps
DATABASE_URL=secretref:database-url
REDIS_URL=secretref:redis-url
JWT_SECRET=secretref:jwt-secret
JWT_REFRESH_SECRET=secretref:jwt-refresh-secret

# Plaintext Configuration Variables
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://saas-prod-frontend.azurecontainerapps.io
FRONTEND_URL=https://saas-prod-frontend.azurecontainerapps.io
NEXT_PUBLIC_API_URL=https://saas-prod-backend.azurecontainerapps.io
```

---

## 4. Prisma Database Migration Policy

Database schema updates are applied cleanly during deployment using non-destructive commands:
```bash
npx prisma migrate deploy
```
- **Safety**: Executes only pending forward migrations without schema resets or data loss.
- **Seeding**: Production seeding is **NOT** executed automatically in deployment pipelines. Initial seed data is run once out-of-band via `npx prisma db seed`.

---

## 5. WebSockets & Real-Time Collaboration in Azure

The backend WebSocket gateway (`AppWebSocketGateway`) runs on `@nestjs/platform-socket.io` and supports WebSocket connections over Azure Container Apps HTTP/2 and WebSocket ingress:
1. **Ingress Protocol**: Azure Container Apps ingress must have `transport: auto` or `transport: http2` enabled with WebSocket support.
2. **Authentication**: Handshake authentication validated via `Authorization: Bearer <jwt_token>` header or `auth.token` payload.
3. **Room Isolation**: Tenant-isolated rooms (`organization:{orgId}:project:{projectId}` and `user:{userId}`) operate seamlessly over Azure internal networks.

---

## 6. CORS Configuration

Backend CORS settings restrict cross-origin access strictly to the deployed Azure frontend origin:
```typescript
app.enableCors({
  origin: process.env.CORS_ORIGIN || 'https://saas-prod-frontend.azurecontainerapps.io',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
```

---

## 7. Monitoring & Logging

Application stdout/stderr logs are streamed directly to Azure Log Analytics workspace:
```bash
# View live backend container logs in Azure
az containerapp logs show \
  --name saas-prod-backend \
  --resource-group rg-multi-tenant-saas-prod \
  --follow
```
