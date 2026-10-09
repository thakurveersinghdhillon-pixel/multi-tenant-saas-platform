import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";

describe("Auth System (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const testUser = {
    email: `authtest-${Date.now()}@example.com`,
    password: "SecurePassword123!",
    firstName: "Auth",
    lastName: "Tester",
  };

  let accessToken: string;
  let refreshToken: string;
  let userId: string;

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
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      if (userId) {
        await prisma.refreshToken.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }
      await prisma.$disconnect();
    }
    await app.close();
  });

  describe("POST /auth/register", () => {
    it("should register a new user successfully and return tokens", async () => {
      const response = await request(app.getHttpServer())
        .post("/auth/register")
        .send(testUser)
        .expect(201);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.user).toBeDefined();
      expect(response.body.user.email).toBe(testUser.email.toLowerCase());
      expect(response.body.user.firstName).toBe(testUser.firstName);
      expect(response.body.user.passwordHash).toBeUndefined();

      accessToken = response.body.accessToken;
      refreshToken = response.body.refreshToken;
      userId = response.body.user.id;
    });

    it("should reject registration with duplicate email (409 Conflict)", async () => {
      await request(app.getHttpServer())
        .post("/auth/register")
        .send(testUser)
        .expect(409);
    });

    it("should reject registration with invalid email format (400 Bad Request)", async () => {
      await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          email: "invalid-email-format",
          password: "Password123!",
          firstName: "John",
          lastName: "Doe",
        })
        .expect(400);
    });

    it("should reject registration with weak/short password (400 Bad Request)", async () => {
      await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          email: "weakpass@example.com",
          password: "short",
          firstName: "John",
          lastName: "Doe",
        })
        .expect(400);
    });
  });

  describe("POST /auth/login", () => {
    it("should login successfully with valid credentials", async () => {
      const response = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.user.email).toBe(testUser.email.toLowerCase());
      expect(response.body.user.passwordHash).toBeUndefined();

      // Update active tokens
      accessToken = response.body.accessToken;
      refreshToken = response.body.refreshToken;
    });

    it("should reject login with wrong password (401 Unauthorized)", async () => {
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: testUser.email,
          password: "WrongPassword999!",
        })
        .expect(401);
    });

    it("should reject login with non-existent email (401 Unauthorized)", async () => {
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "nonexistent-user-12345@example.com",
          password: testUser.password,
        })
        .expect(401);
    });
  });

  describe("GET /auth/me", () => {
    it("should return current user when authenticated with Bearer token", async () => {
      const response = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(userId);
      expect(response.body.email).toBe(testUser.email.toLowerCase());
      expect(response.body.passwordHash).toBeUndefined();
    });

    it("should reject request without Authorization header (401 Unauthorized)", async () => {
      await request(app.getHttpServer()).get("/auth/me").expect(401);
    });

    it("should reject request with invalid Bearer token (401 Unauthorized)", async () => {
      await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", "Bearer invalid_access_token_string")
        .expect(401);
    });
  });

  describe("POST /auth/refresh", () => {
    let rotatedRefreshToken: string;

    it("should refresh access token and rotate refresh token", async () => {
      const response = await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.refreshToken).not.toBe(refreshToken);

      rotatedRefreshToken = response.body.refreshToken;
    });

    it("should reject refresh attempt using revoked old refresh token (401 Unauthorized)", async () => {
      await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken }) // old refresh token
        .expect(401);
    });

    it("should reject refresh with fake token (401 Unauthorized)", async () => {
      await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: "fake_refresh_token_value" })
        .expect(401);
    });

    it("should allow refreshing using the new rotated refresh token", async () => {
      const response = await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: rotatedRefreshToken })
        .expect(200);

      expect(response.body.accessToken).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();

      rotatedRefreshToken = response.body.refreshToken;
    });
  });

  describe("POST /auth/logout", () => {
    let activeRefreshToken: string;

    beforeEach(async () => {
      // Login to get a fresh refresh token
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: testUser.email, password: testUser.password });
      activeRefreshToken = res.body.refreshToken;
    });

    it("should revoke refresh token on logout", async () => {
      await request(app.getHttpServer())
        .post("/auth/logout")
        .send({ refreshToken: activeRefreshToken })
        .expect(200);

      // Verify that refreshing with logged-out token fails
      await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: activeRefreshToken })
        .expect(401);
    });
  });
});
