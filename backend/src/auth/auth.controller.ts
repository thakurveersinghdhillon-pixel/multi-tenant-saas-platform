import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { AuthService } from "./auth.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { LogoutDto } from "./dto/logout.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { CurrentUser } from "./decorators/current-user.decorator";
import { UserResponse } from "./interfaces/auth-response.interface";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { RateLimit } from "../common/decorators/rate-limit.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 50, duration: 60, keyPrefix: "auth-register" })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 10, duration: 60, keyPrefix: "auth-login" })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 30, duration: 60, keyPrefix: "auth-refresh" })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ points: 30, duration: 60, keyPrefix: "auth-logout" })
  async logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getMe(@CurrentUser("id") userId: string): Promise<UserResponse> {
    return this.authService.getMe(userId);
  }
}
