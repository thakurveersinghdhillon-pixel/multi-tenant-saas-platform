import { Injectable, Logger } from "@nestjs/common";
import { Server } from "socket.io";
import { WEBSOCKET_ROOMS, WEBSOCKET_EVENTS } from "./websocket.constants";
import { WebSocketEventPayload } from "./websocket.types";
import * as crypto from "crypto";

@Injectable()
export class WebSocketService {
  private readonly logger = new Logger(WebSocketService.name);
  private server: Server | null = null;

  /**
   * Called by WebSocketGateway upon Socket.IO initialization to register the server instance
   */
  setServer(server: Server) {
    this.server = server;
    this.logger.log("Socket.IO server instance attached to WebSocketService");
  }

  /**
   * Safely broadcast a project event to authorized project room
   */
  emitProjectEvent(
    organizationId: string,
    projectId: string,
    type: string,
    data: any,
    actor?: { id: string; email: string },
  ): void {
    const eventMap: Record<string, string> = {
      PROJECT_CREATED: WEBSOCKET_EVENTS.PROJECT_CREATED,
      PROJECT_UPDATED: WEBSOCKET_EVENTS.PROJECT_UPDATED,
      PROJECT_DELETED: WEBSOCKET_EVENTS.PROJECT_DELETED,
    };

    const eventName = eventMap[type] || WEBSOCKET_EVENTS.PROJECT_UPDATED;
    this.broadcastToProjectRoom(organizationId, projectId, eventName, {
      organizationId,
      projectId,
      type,
      data,
      actor,
    });
  }

  /**
   * Safely broadcast a task event to authorized project room
   */
  emitTaskEvent(
    organizationId: string,
    projectId: string,
    taskId: string,
    type: string,
    data: any,
    actor?: { id: string; email: string },
  ): void {
    const eventMap: Record<string, string> = {
      TASK_CREATED: WEBSOCKET_EVENTS.TASK_CREATED,
      TASK_UPDATED: WEBSOCKET_EVENTS.TASK_UPDATED,
      TASK_STATUS_CHANGED: WEBSOCKET_EVENTS.TASK_STATUS_CHANGED,
      TASK_PRIORITY_CHANGED: WEBSOCKET_EVENTS.TASK_PRIORITY_CHANGED,
      TASK_ASSIGNED: WEBSOCKET_EVENTS.TASK_ASSIGNED,
      TASK_UNASSIGNED: WEBSOCKET_EVENTS.TASK_UNASSIGNED,
      TASK_REORDERED: WEBSOCKET_EVENTS.TASK_REORDERED,
      TASK_DELETED: WEBSOCKET_EVENTS.TASK_DELETED,
    };

    const eventName = eventMap[type] || WEBSOCKET_EVENTS.TASK_UPDATED;
    this.broadcastToProjectRoom(organizationId, projectId, eventName, {
      organizationId,
      projectId,
      taskId,
      type,
      data,
      actor,
    });
  }

  /**
   * Safely broadcast a comment event to authorized project room
   */
  emitCommentEvent(
    organizationId: string,
    projectId: string,
    taskId: string,
    commentId: string,
    type: string,
    data: any,
    actor?: { id: string; email: string },
  ): void {
    const eventMap: Record<string, string> = {
      COMMENT_CREATED: WEBSOCKET_EVENTS.COMMENT_CREATED,
      COMMENT_UPDATED: WEBSOCKET_EVENTS.COMMENT_UPDATED,
      COMMENT_DELETED: WEBSOCKET_EVENTS.COMMENT_DELETED,
    };

    const eventName = eventMap[type] || WEBSOCKET_EVENTS.COMMENT_CREATED;
    this.broadcastToProjectRoom(organizationId, projectId, eventName, {
      organizationId,
      projectId,
      taskId,
      type,
      data: {
        commentId,
        ...data,
      },
      actor,
    });
  }

  /**
   * Safely broadcast an activity log event to authorized project room
   */
  emitActivityEvent(
    organizationId: string,
    projectId: string,
    taskId: string | undefined,
    type: string,
    data: any,
    actor?: { id: string; email: string },
  ): void {
    this.broadcastToProjectRoom(
      organizationId,
      projectId,
      WEBSOCKET_EVENTS.ACTIVITY_CREATED,
      {
        organizationId,
        projectId,
        taskId,
        type,
        data,
        actor,
      },
    );
  }

  /**
   * Safely emit a targeted in-app notification event to user room
   */
  emitNotificationEvent(
    organizationId: string,
    recipientUserId: string,
    data: any,
    actor?: { id: string; email: string },
  ): void {
    try {
      if (!this.server) {
        this.logger.debug(
          `Skipping WebSocket notification emission for recipient ${recipientUserId}: Socket.IO server not attached`,
        );
        return;
      }

      const roomName = WEBSOCKET_ROOMS.user(recipientUserId);

      const payload: WebSocketEventPayload = {
        eventId: crypto.randomUUID(),
        organizationId,
        projectId: data.projectId,
        ...(data.taskId && { taskId: data.taskId }),
        type: WEBSOCKET_EVENTS.NOTIFICATION_NEW,
        timestamp: new Date().toISOString(),
        ...(actor && { actor }),
        data: this.sanitizeData(data),
      };

      this.server.to(roomName).emit(WEBSOCKET_EVENTS.NOTIFICATION_NEW, payload);
      this.logger.debug(
        `[WEBSOCKET NOTIFICATION] Emitted "${WEBSOCKET_EVENTS.NOTIFICATION_NEW}" (ID: ${payload.eventId}) to room "${roomName}"`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to emit WebSocket notification to user "${recipientUserId}": ${err.message}`,
      );
    }
  }

  /**
   * Core broadcast helper to emit structured payloads into tenant-isolated project room
   */
  private broadcastToProjectRoom(
    organizationId: string,
    projectId: string,
    eventName: string,
    params: {
      organizationId: string;
      projectId: string;
      taskId?: string;
      type: string;
      data: any;
      actor?: { id: string; email: string };
    },
  ): void {
    try {
      if (!this.server) {
        this.logger.debug(
          `Skipping WebSocket broadcast for "${eventName}": Socket.IO server instance not attached`,
        );
        return;
      }

      const roomName = WEBSOCKET_ROOMS.project(organizationId, projectId);

      const payload: WebSocketEventPayload = {
        eventId: crypto.randomUUID(),
        organizationId: params.organizationId,
        projectId: params.projectId,
        ...(params.taskId && { taskId: params.taskId }),
        type: eventName,
        timestamp: new Date().toISOString(),
        ...(params.actor && { actor: params.actor }),
        data: this.sanitizeData(params.data),
      };

      this.server.to(roomName).emit(eventName, payload);
      this.logger.debug(
        `[WEBSOCKET EMIT] "${eventName}" (ID: ${payload.eventId}) to room "${roomName}"`,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to emit WebSocket event "${eventName}" for project "${projectId}": ${err.message}`,
      );
    }
  }

  /**
   * Sanitize payload data to ensure sensitive fields are never broadcasted
   */
  private sanitizeData(data: any): any {
    if (!data || typeof data !== "object") return data;

    const sensitiveFields = [
      "password",
      "passwordHash",
      "refreshToken",
      "refreshTokenHash",
      "secret",
      "token",
    ];

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeData(item));
    }

    const sanitized: Record<string, any> = {};
    for (const key of Object.keys(data)) {
      if (!sensitiveFields.includes(key)) {
        sanitized[key] = this.sanitizeData(data[key]);
      }
    }

    return sanitized;
  }
}
