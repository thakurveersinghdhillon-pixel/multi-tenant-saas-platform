import { Reflector } from "@nestjs/core";
import { ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import { RateLimitGuard } from "./rate-limit.guard";
import { RedisService } from "../../redis/redis.service";

describe("RateLimitGuard (Unit)", () => {
  let guard: RateLimitGuard;
  let reflector: jest.Mocked<Reflector>;
  let redisService: jest.Mocked<RedisService>;

  const mockResponse = () => {
    const headers: Record<string, string> = {};
    return {
      setHeader: jest.fn((key: string, val: string) => {
        headers[key] = val;
      }),
      headers,
    };
  };

  const createMockContext = (
    req: {
      ip?: string;
      headers?: Record<string, string>;
      socket?: { remoteAddress?: string };
    },
    res = mockResponse(),
  ): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    redisService = {
      incr: jest.fn(),
      ttl: jest.fn(),
    } as unknown as jest.Mocked<RedisService>;

    guard = new RateLimitGuard(reflector, redisService);
  });

  it("should permit request if no @RateLimit metadata is configured", async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createMockContext({ ip: "127.0.0.1" });

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(redisService.incr).not.toHaveBeenCalled();
  });

  it("should permit request and set headers when within limit using Redis", async () => {
    reflector.getAllAndOverride.mockReturnValue({
      points: 5,
      duration: 60,
      keyPrefix: "test",
    });

    redisService.incr.mockResolvedValue(2);
    redisService.ttl.mockResolvedValue(45);

    const res = mockResponse();
    const context = createMockContext({ ip: "192.168.1.100" }, res);

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "5");
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "3");
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Reset", "45");
  });

  it("should throw 429 HttpException when limit exceeded using Redis", async () => {
    reflector.getAllAndOverride.mockReturnValue({
      points: 3,
      duration: 60,
      keyPrefix: "login",
    });

    redisService.incr.mockResolvedValue(4); // Exceeded 3
    redisService.ttl.mockResolvedValue(30);

    const res = mockResponse();
    const context = createMockContext({ ip: "192.168.1.100" }, res);

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "3");
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "0");
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "30");
  });

  it("should use in-memory fallback when Redis is unavailable", async () => {
    reflector.getAllAndOverride.mockReturnValue({
      points: 2,
      duration: 60,
      keyPrefix: "memory-fallback",
    });

    // Redis returns null (degraded)
    redisService.incr.mockResolvedValue(null);

    const res1 = mockResponse();
    const ctx1 = createMockContext({ ip: "10.0.0.1" }, res1);

    const res2 = mockResponse();
    const ctx2 = createMockContext({ ip: "10.0.0.1" }, res2);

    const res3 = mockResponse();
    const ctx3 = createMockContext({ ip: "10.0.0.1" }, res3);

    // Call 1: pass
    expect(await guard.canActivate(ctx1)).toBe(true);
    expect(res1.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "1");

    // Call 2: pass
    expect(await guard.canActivate(ctx2)).toBe(true);
    expect(res2.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "0");

    // Call 3: exceeds limit -> throw 429
    try {
      await guard.canActivate(ctx3);
      fail("Should have thrown 429");
    } catch (err: any) {
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });
});
