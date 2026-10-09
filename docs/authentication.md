# Authentication Architecture Documentation — Phase 3

## 1. Overview

The Multi-Tenant SaaS Project Management Platform implements a stateless **JWT Access Token** + **Hashed Refresh Token Rotation** authentication system built with **NestJS**, **Passport-JWT**, and **Prisma ORM**.

---

## 2. Authentication Architecture

```text
                 ┌──────────────┐
                 │    Client    │
                 └──────┬───────┘
                        │
                  Login/Register
                        │
                        ▼
                 ┌──────────────┐
                 │   Auth API   │
                 └──────┬───────┘
                        │
                 ┌──────▼───────┐
                 │ Auth Service │
                 └──────┬───────┘
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
        PostgreSQL             JWT Service
             │                     │
             ▼                     ▼
          User DB             Access Token
                              Refresh Token
```

---

## 3. Core Capabilities & Flows

### A. Registration (`POST /auth/register`)
1. Validates incoming payload using `RegisterDto` (`class-validator`).
2. Checks for email uniqueness in `User` table (returns `409 Conflict` if existing).
3. Hashes plaintext password using `bcryptjs` with cost factor 10.
4. Persists new `User` record.
5. Generates short-lived JWT Access Token (`sub = userId`, `email`).
6. Generates raw Refresh Token, computes SHA-256 hash, and stores hashed token in `RefreshToken` table with 7-day expiration.
7. Returns Access Token, raw Refresh Token, and sanitized `user` object (omitting `passwordHash`).

### B. Login (`POST /auth/login`)
1. Validates email & password input format.
2. Finds user by email in database.
3. Compares password hash using `bcrypt.compare`.
4. Returns generic `401 Unauthorized` for both missing user and invalid password (prevents email enumeration).
5. Generates new JWT Access Token and rotated Refresh Token.
6. Returns tokens and sanitized `user` object.

### C. JWT Access Token Validation (`GET /auth/me`)
1. `JwtAuthGuard` extracts Bearer token from `Authorization` header (`Bearer <token>`).
2. `JwtStrategy` verifies signature using `JWT_SECRET` and checks expiration (`15m`).
3. Strategy extracts `sub` (User ID), verifies active user status in database, and attaches sanitized user to `req.user`.
4. `@CurrentUser()` custom decorator extracts user or specific properties (e.g. `@CurrentUser('id')`).

### D. Refresh Token & Token Rotation (`POST /auth/refresh`)
1. Client sends `{ refreshToken: "..." }`.
2. Backend computes SHA-256 hash of incoming raw refresh token.
3. Queries `RefreshToken` table for matching `tokenHash`.
4. Checks if token exists, is not revoked (`revokedAt == null`), and is not expired (`expiresAt > NOW()`).
5. **Token Rotation**: Immediately marks old refresh token as revoked (`revokedAt = NOW()`).
6. Generates a brand new JWT Access Token and new Refresh Token.
7. Stores new hashed Refresh Token in database.

### E. Logout (`POST /auth/logout`)
1. Hashes incoming raw refresh token.
2. Marks matching refresh token as revoked (`revokedAt = NOW()`).
3. Prevents any future refresh attempts using that token.

---

## 4. API Endpoint Summary

| Method | Endpoint | Auth Required | Request Body | Response |
|---|---|---|---|---|
| `POST` | `/auth/register` | No | `{ email, password, firstName, lastName }` | `201 Created` `{ accessToken, refreshToken, user }` |
| `POST` | `/auth/login` | No | `{ email, password }` | `200 OK` `{ accessToken, refreshToken, user }` |
| `POST` | `/auth/refresh` | No | `{ refreshToken }` | `200 OK` `{ accessToken, refreshToken }` |
| `POST` | `/auth/logout` | No | `{ refreshToken }` | `200 OK` `{ message }` |
| `GET` | `/auth/me` | Yes (`Bearer`) | None | `200 OK` `{ id, email, firstName, lastName, ... }` |

---

## 5. Security Decisions

1. **Password Hashing**: `bcryptjs` with 10 salt rounds. Plaintext passwords are never logged or stored.
2. **JWT Payload Scope**: Payload contains only `sub` (User ID) and `email`. No password hashes, roles, or full user objects are embedded inside JWT tokens.
3. **Multi-Tenancy Readiness**: JWT contains `sub = userId`. Organization context is left out of the JWT because a user can belong to multiple tenant organizations. Organization authorization will be resolved in Phase 4.
4. **Hashed Refresh Tokens**: Database stores only SHA-256 hashes of refresh tokens (`tokenHash`). If database read access is compromised, raw refresh tokens cannot be stolen.
5. **Token Rotation**: Old refresh tokens are revoked immediately upon use. If a stolen refresh token is replayed after legitimate rotation, authorization fails.
6. **Input Validation**: `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, and `transform: true` prevents mass-assignment vulnerabilities.

---

## 6. Environment Variables

| Variable | Description | Default |
|---|---|---|
| `JWT_SECRET` | Secret key for signing access tokens | `change_me_local_jwt_secret_key_987654321` |
| `JWT_ACCESS_EXPIRES_IN` | Access token expiration duration | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token expiration duration | `7d` |
