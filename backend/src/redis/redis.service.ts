import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import Redis from "ioredis";
import { CACHE_LOG_PREFIX } from "./redis.constants";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isHealthy = false;

  onModuleInit() {
    this.initRedisClient();
  }

  onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  /**
   * Initialize ioredis client with connection event listeners & retry strategy
   */
  private initRedisClient() {
    try {
      const redisUrl = process.env.REDIS_URL;
      const host = process.env.REDIS_HOST || "localhost";
      const port = Number(process.env.REDIS_PORT) || 6379;
      const password = process.env.REDIS_PASSWORD || undefined;

      if (redisUrl) {
        this.client = new Redis(redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
      } else {
        this.client = new Redis({
          host,
          port,
          password,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        });
      }

      this.client.on("connect", () => {
        this.isHealthy = true;
        this.logger.log("Redis client successfully connected");
      });

      this.client.on("error", (err) => {
        this.isHealthy = false;
        this.logger.warn(
          `${CACHE_LOG_PREFIX.ERROR} ${err.message || "Connection error"}`,
        );
      });

      // Attempt initial connection asynchronously
      this.client.connect().catch((err) => {
        this.isHealthy = false;
        this.logger.warn(
          `${CACHE_LOG_PREFIX.ERROR} Redis initial connection failed: ${err.message}`,
        );
      });
    } catch (err: any) {
      this.isHealthy = false;
      this.logger.warn(
        `${CACHE_LOG_PREFIX.ERROR} Failed to initialize Redis client: ${err.message}`,
      );
    }
  }

  /**
   * Check if Redis is currently connected and healthy
   */
  isRedisHealthy(): boolean {
    return this.isHealthy && this.client?.status === "ready";
  }

  /**
   * Retrieve cached value by key with graceful fallback on Redis error
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client || !this.isHealthy) {
      return null;
    }

    try {
      const data = await this.client.get(key);
      if (!data) {
        this.logger.debug(`${CACHE_LOG_PREFIX.MISS} ${key}`);
        return null;
      }

      this.logger.debug(`${CACHE_LOG_PREFIX.HIT} ${key}`);
      return JSON.parse(data) as T;
    } catch (err: any) {
      this.logger.warn(
        `${CACHE_LOG_PREFIX.ERROR} Failed get for key ${key}: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Set cache entry with optional TTL (in seconds)
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    if (!this.client || !this.isHealthy) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, serialized, "EX", ttlSeconds);
        this.logger.debug(
          `${CACHE_LOG_PREFIX.SET} ${key} (TTL: ${ttlSeconds}s)`,
        );
      } else {
        await this.client.set(key, serialized);
        this.logger.debug(`${CACHE_LOG_PREFIX.SET} ${key}`);
      }
      return true;
    } catch (err: any) {
      this.logger.warn(
        `${CACHE_LOG_PREFIX.ERROR} Failed set for key ${key}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Invalidate specific cache key
   */
  async del(key: string): Promise<boolean> {
    if (!this.client || !this.isHealthy) {
      return false;
    }

    try {
      await this.client.del(key);
      this.logger.debug(`${CACHE_LOG_PREFIX.INVALIDATE} ${key}`);
      return true;
    } catch (err: any) {
      this.logger.warn(
        `${CACHE_LOG_PREFIX.ERROR} Failed del for key ${key}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Invalidate multiple cache keys
   */
  async delMany(keys: string[]): Promise<boolean> {
    if (!this.client || !this.isHealthy || !keys || keys.length === 0) {
      return true;
    }

    try {
      const validKeys = keys.filter(Boolean);
      if (validKeys.length > 0) {
        await this.client.del(...validKeys);
        this.logger.debug(
          `${CACHE_LOG_PREFIX.INVALIDATE} Removed ${validKeys.length} keys`,
        );
      }
      return true;
    } catch (err: any) {
      this.logger.warn(
        `${CACHE_LOG_PREFIX.ERROR} Failed delMany: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Check if a cache key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.client || !this.isHealthy) {
      return false;
    }

    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (err: any) {
      this.logger.warn(
        `${CACHE_LOG_PREFIX.ERROR} Failed exists check for ${key}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Invalidate all keys matching a key prefix (tenant / project scoped)
   */
  async invalidateByPrefix(prefix: string): Promise<number> {
    if (!this.client || !this.isHealthy || !prefix) {
      return 0;
    }

    try {
      const pattern = prefix.endsWith("*") ? prefix : `${prefix}*`;
      let keysToDelete: string[] = [];

      if (typeof this.client.scanStream === "function") {
        await new Promise<void>((resolve) => {
          try {
            const stream = this.client!.scanStream({
              match: pattern,
              count: 100,
            });

            stream.on("data", (resultKeys: string[]) => {
              if (resultKeys && resultKeys.length > 0) {
                keysToDelete.push(...resultKeys);
              }
            });

            stream.on("end", () => resolve());
            stream.on("error", (err) => {
              this.logger.warn(
                `${CACHE_LOG_PREFIX.ERROR} scanStream error: ${err.message}`,
              );
              resolve();
            });
          } catch (err: any) {
            this.logger.warn(
              `${CACHE_LOG_PREFIX.ERROR} scanStream launch failed: ${err.message}`,
            );
            resolve();
          }
        });
      } else if (typeof this.client.keys === "function") {
        keysToDelete = await this.client.keys(pattern);
      }

      if (keysToDelete.length > 0) {
        // Delete keys in batches of 100
        for (let i = 0; i < keysToDelete.length; i += 100) {
          const batch = keysToDelete.slice(i, i + 100);
          await this.client.del(...batch);
        }
        this.logger.debug(
          `${CACHE_LOG_PREFIX.INVALIDATE} Prefix "${prefix}*" purged ${keysToDelete.length} keys`,
        );
      }
      return keysToDelete.length;
    } catch (err: any) {
      this.logger.warn(
        `${CACHE_LOG_PREFIX.ERROR} Failed invalidateByPrefix for ${prefix}: ${err.message}`,
      );
      return 0;
    }
  }
}
