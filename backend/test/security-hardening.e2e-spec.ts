import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";

describe("Phase 16 Application Security Hardening (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe("1. Authentication Rate Limiting", () => {
    const testIp = `198.51.100.${(Date.now() % 200) + 10}`; // Unique IP per run to avoid collision

    it("should allow requests up to rate limit points and return 429 when breached", async () => {
      // Points is 10 for auth-login
      for (let i = 1; i <= 10; i++) {
        const res = await request(app.getHttpServer())
          .post("/auth/login")
          .set("X-Forwarded-For", testIp)
          .send({
            email: "nobody@example.com",
            password: "WrongPassword123!",
          });

        expect(res.status).toBe(401);
        expect(res.headers["x-ratelimit-limit"]).toBe("10");
        expect(Number(res.headers["x-ratelimit-remaining"])).toBe(10 - i);
      }

      // 11th request must be rejected with 429
      const blockedRes = await request(app.getHttpServer())
        .post("/auth/login")
        .set("X-Forwarded-For", testIp)
        .send({
          email: "nobody@example.com",
          password: "WrongPassword123!",
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers["retry-after"]).toBeDefined();
      expect(blockedRes.headers["x-ratelimit-remaining"]).toBe("0");
      expect(blockedRes.body.message).toContain("Too many requests");
    });
  });

  describe("2. Refresh Token Family Reuse Detection (RFC 6819)", () => {
    const userEmail = `token-family-${Date.now()}@example.com`;
    const password = "StrongPassword123!";
    let refreshToken1: string;
    let refreshToken2: string;

    it("should register a user and issue initial tokens", async () => {
      const regRes = await request(app.getHttpServer())
        .post("/auth/register")
        .set("X-Forwarded-For", "198.51.100.43")
        .send({
          email: userEmail,
          password,
          firstName: "Token",
          lastName: "Family",
        })
        .expect(201);

      refreshToken1 = regRes.body.refreshToken;
      expect(refreshToken1).toBeDefined();
    });

    it("should rotate refresh token and issue new token pair", async () => {
      const refreshRes = await request(app.getHttpServer())
        .post("/auth/refresh")
        .set("X-Forwarded-For", "198.51.100.43")
        .send({ refreshToken: refreshToken1 })
        .expect(200);

      refreshToken2 = refreshRes.body.refreshToken;
      expect(refreshToken2).toBeDefined();
      expect(refreshToken2).not.toBe(refreshToken1);
    });

    it("should detect reuse of revoked token and revoke all tokens in family", async () => {
      // Wait for 3-second grace window to expire to simulate an attack replay
      await new Promise((resolve) => setTimeout(resolve, 3100));

      // Replay old (revoked) refreshToken1
      await request(app.getHttpServer())
        .post("/auth/refresh")
        .set("X-Forwarded-For", "198.51.100.43")
        .send({ refreshToken: refreshToken1 })
        .expect(401);

      // Now attempt to use refreshToken2 - it must also be revoked now due to family invalidation
      await request(app.getHttpServer())
        .post("/auth/refresh")
        .set("X-Forwarded-For", "198.51.100.43")
        .send({ refreshToken: refreshToken2 })
        .expect(401);
    }, 10000);
  });

  describe("3. Input Validation & Mass-Assignment Prevention", () => {
    it("should reject non-whitelisted fields during registration (mass-assignment prevention)", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/register")
        .set("X-Forwarded-For", "198.51.100.44")
        .send({
          email: `mass-assign-${Date.now()}@example.com`,
          password: "SecurePassword123!",
          firstName: "Hacker",
          lastName: "User",
          role: "OWNER",
          isAdmin: true,
          status: "SUPERUSER",
        })
        .expect(400);

      expect(res.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining("property role should not exist"),
          expect.stringContaining("property isAdmin should not exist"),
          expect.stringContaining("property status should not exist"),
        ]),
      );
    });

    it("should reject password exceeding maximum length (128 characters)", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/register")
        .set("X-Forwarded-For", "198.51.100.45")
        .send({
          email: `longpass-${Date.now()}@example.com`,
          password: "A".repeat(129),
          firstName: "Long",
          lastName: "Pass",
        })
        .expect(400);

      expect(JSON.stringify(res.body.message)).toContain(
        "Password must not exceed 128 characters",
      );
    });

    it("should reject email exceeding maximum length (255 characters)", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/register")
        .set("X-Forwarded-For", "198.51.100.46")
        .send({
          email: "a".repeat(250) + "@example.com",
          password: "ValidPassword123!",
          firstName: "Long",
          lastName: "Email",
        })
        .expect(400);

      expect(JSON.stringify(res.body.message)).toContain(
        "Email must not exceed 255 characters",
      );
    });
  });

  describe("4. Email Normalization & Timing Attack Resistance", () => {
    const rawEmail = `  Trimmed.Email.${Date.now()}@Example.COM  `;
    const normalizedEmail = rawEmail.toLowerCase().trim();
    const password = "StrongPassword123!";

    it("should normalize email with whitespace and uppercase on registration", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/register")
        .set("X-Forwarded-For", "198.51.100.47")
        .send({
          email: rawEmail,
          password,
          firstName: "  Jane  ",
          lastName: "  Doe  ",
        })
        .expect(201);

      expect(res.body.user.email).toBe(normalizedEmail);
      expect(res.body.user.firstName).toBe("Jane");
      expect(res.body.user.lastName).toBe("Doe");
    });

    it("should successfully authenticate with mixed casing and extra whitespace", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .set("X-Forwarded-For", "198.51.100.48")
        .send({
          email: `  ${normalizedEmail.toUpperCase()}  `,
          password,
        })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.email).toBe(normalizedEmail);
    });

    it("should return generic error without user enumeration on invalid login", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .set("X-Forwarded-For", "198.51.100.49")
        .send({
          email: "completely.fictional.user@example.com",
          password: "RandomPassword123!",
        })
        .expect(401);

      expect(res.body.message).toBe("Invalid email or password");
    });
  });
});
