import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Logger, UsePipes, ValidationPipe } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { WebSocketService } from "./websocket.service";
import {
  WEBSOCKET_ROOMS,
  WEBSOCKET_EVENTS,
  WEBSOCKET_ERROR_CODES,
} from "./websocket.constants";
import { AuthenticatedSocket, WebSocketResponse } from "./websocket.types";
import { JoinProjectDto } from "./dto/join-project.dto";
import { LeaveProjectDto } from "./dto/leave-project.dto";
import { JwtPayload } from "../auth/interfaces/jwt-payload.interface";

@WebSocketGateway({
  cors: {
    origin: "*",
    credentials: true,
  },
})
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class AppWebSocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AppWebSocketGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly tenancyService: TenancyService,
    private readonly webSocketService: WebSocketService,
  ) {}

  afterInit(server: Server) {
    this.webSocketService.setServer(server);

    server.use(async (socket: Socket, next) => {
      try {
        const token = this.extractToken(socket);

        if (!token) {
          this.logger.warn(
            `[WEBSOCKET AUTH REJECTED] Missing token for socket ${socket.id}`,
          );
          return next(new Error("Authentication token missing"));
        }

        const secret =
          process.env.JWT_SECRET || "change_me_local_jwt_secret_key_987654321";
        const payload: JwtPayload = this.jwtService.verify(token, { secret });

        if (!payload || !payload.sub) {
          this.logger.warn(
            `[WEBSOCKET AUTH REJECTED] Invalid token payload for socket ${socket.id}`,
          );
          return next(new Error("Invalid token payload"));
        }

        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, email: true, isActive: true },
        });

        if (!user || !user.isActive) {
          this.logger.warn(
            `[WEBSOCKET AUTH REJECTED] Inactive or non-existent user ${payload.sub} for socket ${socket.id}`,
          );
          return next(new Error("User inactive or non-existent"));
        }

        (socket as AuthenticatedSocket).user = {
          id: user.id,
          email: user.email,
        };

        next();
      } catch (err: any) {
        this.logger.warn(
          `[WEBSOCKET AUTH ERROR] Socket ${socket.id} authentication failed: ${err.message}`,
        );
        next(new Error(`Authentication failed: ${err.message}`));
      }
    });

    this.logger.log(
      "WebSocket Gateway initialized with authentication middleware",
    );
  }

  /**
   * Called when an authenticated socket connection is established
   */
  async handleConnection(client: Socket) {
    const user = (client as AuthenticatedSocket).user;
    if (user) {
      const userRoom = WEBSOCKET_ROOMS.user(user.id);
      client.join(userRoom);
      this.logger.log(
        `[WEBSOCKET CONNECTED] Socket ${client.id} authenticated for user ${user.id} (${user.email}), joined room "${userRoom}"`,
      );
    } else {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const user = (client as AuthenticatedSocket).user;
    const userIdLog = user ? ` (user ${user.id})` : "";
    this.logger.log(`[WEBSOCKET DISCONNECTED] Socket ${client.id}${userIdLog}`);
  }

  /**
   * Join an authorized project room after verifying organization and project membership
   */
  @SubscribeMessage(WEBSOCKET_EVENTS.PROJECT_JOIN)
  async handleJoinProject(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: JoinProjectDto,
  ): Promise<WebSocketResponse> {
    const user = client.user;
    if (!user) {
      return {
        success: false,
        error: {
          code: WEBSOCKET_ERROR_CODES.AUTHENTICATION_REQUIRED,
          message: "Authentication required before joining rooms",
        },
      };
    }

    try {
      // 1. Validate Organization Membership
      await this.tenancyService.validateAndGetTenantContext(
        user.id,
        dto.organizationId,
      );

      // 2. Validate Project belongs to Organization
      const project = await this.prisma.project.findFirst({
        where: {
          id: dto.projectId,
          organizationId: dto.organizationId,
        },
      });

      if (!project) {
        return {
          success: false,
          error: {
            code: WEBSOCKET_ERROR_CODES.PROJECT_NOT_FOUND,
            message: "Project not found in this organization",
          },
        };
      }

      // 3. Validate Project Membership
      const projectMember = await this.prisma.projectMember.findUnique({
        where: {
          projectId_userId: {
            projectId: dto.projectId,
            userId: user.id,
          },
        },
      });

      if (!projectMember) {
        return {
          success: false,
          error: {
            code: WEBSOCKET_ERROR_CODES.PROJECT_ACCESS_DENIED,
            message: "You must be a member of this project to join its room",
          },
        };
      }

      // 4. Join room
      const roomName = WEBSOCKET_ROOMS.project(
        dto.organizationId,
        dto.projectId,
      );
      client.join(roomName);

      this.logger.log(
        `[WEBSOCKET ROOM JOIN] User ${user.id} joined room "${roomName}"`,
      );

      return {
        success: true,
        room: roomName,
        message: "Successfully joined project room",
      };
    } catch (err: any) {
      this.logger.warn(
        `[WEBSOCKET JOIN DENIED] User ${user.id} failed to join project ${dto.projectId}: ${err.message}`,
      );

      return {
        success: false,
        error: {
          code: WEBSOCKET_ERROR_CODES.PROJECT_ACCESS_DENIED,
          message: err.message || "Access denied to project room",
        },
      };
    }
  }

  /**
   * Leave a project room
   */
  @SubscribeMessage(WEBSOCKET_EVENTS.PROJECT_LEAVE)
  async handleLeaveProject(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: LeaveProjectDto,
  ): Promise<WebSocketResponse> {
    const roomName = WEBSOCKET_ROOMS.project(dto.organizationId, dto.projectId);
    client.leave(roomName);

    this.logger.log(
      `[WEBSOCKET ROOM LEAVE] Socket ${client.id} left room "${roomName}"`,
    );

    return {
      success: true,
      room: roomName,
      message: "Successfully left project room",
    };
  }

  /**
   * Helper to extract JWT token from socket auth handshake or headers
   */
  private extractToken(client: Socket): string | null {
    // 1. Check handshake.auth.token
    const authHeader = client.handshake.auth?.token;
    if (authHeader) {
      return authHeader.replace(/^Bearer\s+/i, "").trim();
    }

    // 2. Check handshake.headers.authorization
    const headerAuth = client.handshake.headers?.authorization;
    if (headerAuth) {
      return headerAuth.replace(/^Bearer\s+/i, "").trim();
    }

    return null;
  }
}
