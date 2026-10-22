import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request, Response } from "express";
import { RedisService } from "../../redis/redis.service";
import {
  RATE_LIMIT_METADATA,
  RateLimitOptions,
} from "../decorators/rate-limit.decorator";

interface MemoryRateLimitEntry {
  count: number;
  resetAt: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private static readonly memoryStore = new Map<string, MemoryRateLimitEntry>();

  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_METADATA,
      [context.getHandler(), context.getClass()],
    );

    // If endpoint is not decorated with @RateLimit, permit the request
    if (!options) {
      return true;
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const ip = this.extractClientIp(req);
    const prefix = options.keyPrefix || "default";
    const key = `ratelimit:${prefix}:${ip}`;

    const isLocalhost =
      ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    const effectivePoints =
      process.env.NODE_ENV === "test" && isLocalhost ? 1000 : options.points;

    let current = 0;
    let resetSeconds = options.duration;

    // 1. Primary: Redis-backed distributed rate limiter
    const redisCount = await this.redisService.incr(key, options.duration);

    if (redisCount !== null) {
      current = redisCount;
      const ttl = await this.redisService.ttl(key);
      if (ttl && ttl > 0) {
        resetSeconds = ttl;
      }
    } else {
      // 2. Fallback: In-memory rate limiter when Redis is degraded
      const now = Date.now();
      const existing = RateLimitGuard.memoryStore.get(key);

      if (!existing || now >= existing.resetAt) {
        RateLimitGuard.memoryStore.set(key, {
          count: 1,
          resetAt: now + options.duration * 1000,
        });
        current = 1;
        resetSeconds = options.duration;
      } else {
        existing.count += 1;
        current = existing.count;
        resetSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      }
    }

    const remaining = Math.max(0, effectivePoints - current);

    // Set standard rate limit headers
    if (res && typeof res.setHeader === "function") {
      res.setHeader("X-RateLimit-Limit", effectivePoints.toString());
      res.setHeader("X-RateLimit-Remaining", remaining.toString());
      res.setHeader("X-RateLimit-Reset", resetSeconds.toString());
    }

    if (current > effectivePoints) {
      if (res && typeof res.setHeader === "function") {
        res.setHeader("Retry-After", resetSeconds.toString());
      }

      this.logger.warn(
        `Rate limit exceeded for IP ${ip} on prefix ${prefix} (${current}/${effectivePoints})`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Too many requests, please try again later.",
          retryAfter: resetSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private extractClientIp(req: Request): string {
    const forwarded = req?.headers?.["x-forwarded-for"];
    if (forwarded) {
      const firstIp = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded.split(",")[0];
      return firstIp.trim();
    }

    return req?.ip || req?.socket?.remoteAddress || "127.0.0.1";
  }
}
