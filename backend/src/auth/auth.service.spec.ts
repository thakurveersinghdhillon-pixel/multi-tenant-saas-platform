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
});
