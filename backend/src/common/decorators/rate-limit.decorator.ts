import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_METADATA = "rate_limit_metadata";

export interface RateLimitOptions {
  /**
   * Maximum number of allowed requests within the duration window.
   */
  points: number;

  /**
   * Duration window in seconds.
   */
  duration: number;

  /**
   * Optional prefix to distinguish rate limit categories/endpoints.
   */
  keyPrefix?: string;
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_METADATA, options);
