import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { PrismaService } from "../database/prisma.service";

describe("AuthService (Unit)", () => {
  let service: AuthService;

  const mockUser = {
    id: "user-uuid-1",
    email: "test@example.com",
    passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
    firstName: "John",
    lastName: "Doe",
    avatarUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue("mocked_access_token"),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("register", () => {
    it("should throw ConflictException if email is already taken", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(mockUser);

      await expect(
        service.register({
          email: "test@example.com",
          password: "Password123!",
          firstName: "John",
          lastName: "Doe",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("should successfully register a new user and return tokens", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.user.create.mockResolvedValueOnce(mockUser);
      mockPrismaService.refreshToken.create.mockResolvedValueOnce({});

      const result = await service.register({
        email: "newuser@example.com",
        password: "Password123!",
        firstName: "John",
        lastName: "Doe",
      });

      expect(result.accessToken).toBe("mocked_access_token");
      expect(result.refreshToken).toBeDefined();
      expect(result.user.email).toBe("test@example.com");
      expect(
        (result.user as unknown as Record<string, unknown>).passwordHash,
      ).toBeUndefined();
    });
  });

  describe("login", () => {
    it("should throw UnauthorizedException if user is not found", async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.login({
          email: "nonexistent@example.com",
          password: "Password123!",
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("refreshToken (Token Family Reuse Detection)", () => {
    it("should throw UnauthorizedException and revoke entire token family when a revoked token is reused", async () => {
      const revokedToken = {
        id: "token-1",
        userId: "user-uuid-1",
        tokenHash: "revoked-token-hash",
        revokedAt: new Date(Date.now() - 3600000), // revoked 1 hour ago
        expiresAt: new Date(Date.now() + 86400000),
        user: mockUser,
      };

      mockPrismaService.refreshToken.findFirst.mockResolvedValueOnce(
        revokedToken,
      );
      mockPrismaService.refreshToken.updateMany.mockResolvedValueOnce({
        count: 2,
      });

      await expect(
        service.refreshToken({
          refreshToken: "compromised_replayed_token",
        }),
      ).rejects.toThrow(UnauthorizedException);

      // Verify all active tokens for this user were revoked
      expect(mockPrismaService.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-uuid-1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("should successfully rotate refresh token and revoke previous token", async () => {
      const validToken = {
        id: "token-2",
        userId: "user-uuid-1",
        tokenHash: "valid-token-hash",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
        user: mockUser,
      };

      mockPrismaService.refreshToken.findFirst.mockResolvedValueOnce(
        validToken,
      );
      mockPrismaService.refreshToken.update.mockResolvedValueOnce({
        ...validToken,
        revokedAt: new Date(),
      });
      mockPrismaService.refreshToken.create.mockResolvedValueOnce({});

      const result = await service.refreshToken({
        refreshToken: "valid_active_token",
      });

      expect(result.accessToken).toBe("mocked_access_token");
      expect(result.refreshToken).toBeDefined();
      expect(mockPrismaService.refreshToken.update).toHaveBeenCalledWith({
        where: { id: "token-2" },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
