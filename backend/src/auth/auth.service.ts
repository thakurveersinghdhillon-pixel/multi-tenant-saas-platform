import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../database/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { LogoutDto } from "./dto/logout.dto";
import {
  AuthResponse,
  UserResponse,
} from "./interfaces/auth-response.interface";
import { JwtPayload } from "./interfaces/jwt-payload.interface";
import * as bcrypt from "bcryptjs";
import * as crypto from "crypto";

@Injectable()
export class AuthService {
  // Precomputed dummy bcrypt hash (cost factor 10) to prevent user enumeration timing attacks
  private static readonly DUMMY_HASH =
    "$2a$10$wK1vE8mN5oY1zK0vF7tA.OGlR8kL6aY.y9wR/C3sB4mD2jH6eK4mG";

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Register a new user with normalized email
   */
  async register(dto: RegisterDto): Promise<AuthResponse> {
    const normalizedEmail = dto.email.toLowerCase().trim();
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictException("Email is already registered");
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
      },
    });

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      ...tokens,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * Login user with credentials, protected against user enumeration timing attacks
   */
  async login(dto: LoginDto): Promise<AuthResponse> {
    const normalizedEmail = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      // Execute dummy bcrypt compare to equalize timing with valid user lookup
      await bcrypt.compare(dto.password, AuthService.DUMMY_HASH);
      throw new UnauthorizedException("Invalid email or password");
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      ...tokens,
      user: this.sanitizeUser(user),
    };
  }

  /**
   * Refresh access token and rotate refresh token with RFC 6819 token family reuse detection
   */
  async refreshToken(
    dto: RefreshTokenDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hashToken(dto.refreshToken.trim());

    const storedToken = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    // Refresh Token Family Reuse Detection (RFC 6819):
    // If a revoked token is reused outside the rotation leeway/grace window (3 seconds),
    // it indicates a replay/theft attack. Invalidate all active tokens in the family.
    if (storedToken.revokedAt) {
      const gracePeriodMs = 3000;
      const isOutsideGrace =
        Date.now() - storedToken.revokedAt.getTime() > gracePeriodMs;

      if (isOutsideGrace) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: storedToken.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    if (
      storedToken.expiresAt < new Date() ||
      !storedToken.user ||
      !storedToken.user.isActive
    ) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    // Revoke old refresh token (Token Rotation)
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    // Generate new token pair
    return this.generateTokens(storedToken.user.id, storedToken.user.email);
  }

  /**
   * Logout user by revoking refresh token
   */
  async logout(dto: LogoutDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.refreshToken.trim());

    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { message: "Logged out successfully" };
  }

  /**
   * Get authenticated user profile
   */
  async getMe(userId: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException("User not found or inactive");
    }

    return this.sanitizeUser(user);
  }

  // ==========================================
  // HELPER METHODS
  // ==========================================

  private async generateTokens(userId: string, email: string) {
    const payload: JwtPayload = { sub: userId, email };

    const accessToken = await this.jwtService.signAsync(payload);

    // Generate random raw refresh token string
    const rawRefreshToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = this.hashToken(rawRefreshToken);

    // Default 7 days expiration for refresh tokens
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sanitizeUser(user: any): UserResponse {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...sanitized } = user;
    return sanitized;
  }
}
