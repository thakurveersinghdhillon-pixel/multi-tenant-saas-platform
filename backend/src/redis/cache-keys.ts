import { CACHE_KEY_VERSION } from "./redis.constants";
import * as crypto from "crypto";

export class CacheKeys {
  private static v = CACHE_KEY_VERSION;

  /**
   * Helper to hash and normalize filter objects deterministically
   */
  private static hashFilters(filters: Record<string, any> = {}): string {
    const keys = Object.keys(filters)
      .filter(
        (k) =>
          filters[k] !== undefined && filters[k] !== null && filters[k] !== "",
      )
      .sort();

    if (keys.length === 0) return "all";

    const normalizedStr = keys.map((k) => `${k}=${filters[k]}`).join("&");
    return crypto
      .createHash("md5")
      .update(normalizedStr)
      .digest("hex")
      .slice(0, 10);
  }

  /**
   * Tenant project list cache key
   */
  static projectList(organizationId: string): string {
    return `${this.v}:tenant:${organizationId}:projects:list`;
  }

  /**
   * Tenant project detail cache key
   */
  static projectDetail(organizationId: string, projectId: string): string {
    return `${this.v}:tenant:${organizationId}:project:${projectId}`;
  }

  /**
   * Tenant task list cache key with normalized filters
   */
  static taskList(
    organizationId: string,
    projectId: string,
    filters: Record<string, any> = {},
  ): string {
    const hash = this.hashFilters(filters);
    return `${this.v}:tenant:${organizationId}:project:${projectId}:tasks:list:${hash}`;
  }

  /**
   * Tenant Kanban board cache key
   */
  static taskBoard(organizationId: string, projectId: string): string {
    return `${this.v}:tenant:${organizationId}:project:${projectId}:board`;
  }

  /**
   * Tenant task detail cache key
   */
  static taskDetail(
    organizationId: string,
    projectId: string,
    taskId: string,
  ): string {
    return `${this.v}:tenant:${organizationId}:project:${projectId}:task:${taskId}`;
  }

  /**
   * Tenant project activity cache key
   */
  static projectActivity(
    organizationId: string,
    projectId: string,
    query: Record<string, any> = {},
  ): string {
    const hash = this.hashFilters(query);
    return `${this.v}:tenant:${organizationId}:project:${projectId}:activity:${hash}`;
  }

  /**
   * Tenant task activity cache key
   */
  static taskActivity(
    organizationId: string,
    projectId: string,
    taskId: string,
    query: Record<string, any> = {},
  ): string {
    const hash = this.hashFilters(query);
    return `${this.v}:tenant:${organizationId}:project:${projectId}:task:${taskId}:activity:${hash}`;
  }

  /**
   * Prefix pattern for invalidating all task, board, and activity caches under a project
   */
  static projectPrefix(organizationId: string, projectId: string): string {
    return `${this.v}:tenant:${organizationId}:project:${projectId}`;
  }

  /**
   * Prefix for invalidating project list caches under an organization
   */
  static orgProjectsPrefix(organizationId: string): string {
    return `${this.v}:tenant:${organizationId}:projects:`;
  }
}
