export const CACHE_KEY_VERSION = "v1";

export const CACHE_TTL = {
  PROJECT_LIST: 60, // 60 seconds
  PROJECT_DETAIL: 60, // 60 seconds
  TASK_LIST: 30, // 30 seconds
  TASK_BOARD: 30, // 30 seconds
  TASK_DETAIL: 60, // 60 seconds
  ACTIVITY: 30, // 30 seconds
} as const;

export const CACHE_LOG_PREFIX = {
  HIT: "[CACHE HIT]",
  MISS: "[CACHE MISS]",
  SET: "[CACHE SET]",
  INVALIDATE: "[CACHE INVALIDATE]",
  ERROR: "[REDIS ERROR]",
} as const;
