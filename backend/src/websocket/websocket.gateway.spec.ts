import { Test, TestingModule } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { AppWebSocketGateway } from "./websocket.gateway";
import { PrismaService } from "../database/prisma.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { WebSocketService } from "./websocket.service";
import { WEBSOCKET_ERROR_CODES, WEBSOCKET_ROOMS } from "./websocket.constants";
import { AuthenticatedSocket } from "./websocket.types";

describe("AppWebSocketGateway", () => {
  let gateway: AppWebSocketGateway;
  let jwtService: jest.Mocked<JwtService>;
  let prisma: jest.Mocked<PrismaService>;
  let tenancyService: jest.Mocked<TenancyService>;
  let webSocketService: jest.Mocked<WebSocketService>;

  beforeEach(async () => {
    const mockJwtService = {
      verify: jest.fn(),
    };

    const mockPrismaService = {
      user: {
        findUnique: jest.fn(),
      },
      project: {
        findFirst: jest.fn(),
      },
      projectMember: {
        findUnique: jest.fn(),
      },
    };

    const mockTenancyService = {
      validateAndGetTenantContext: jest.fn(),
    };

    const mockWebSocketService = {
      setServer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppWebSocketGateway,
        { provide: JwtService, useValue: mockJwtService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: TenancyService, useValue: mockTenancyService },
        { provide: WebSocketService, useValue: mockWebSocketService },
      ],
    }).compile();

    gateway = module.get<AppWebSocketGateway>(AppWebSocketGateway);
    jwtService = module.get(JwtService);
    prisma = module.get(PrismaService);
    tenancyService = module.get(TenancyService);
    webSocketService = module.get(WebSocketService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(gateway).toBeDefined();
  });

  describe("afterInit", () => {
    it("should register server with WebSocketService and attach auth middleware", () => {
      const mockServer = { use: jest.fn() } as any;
      gateway.afterInit(mockServer);
      expect(webSocketService.setServer).toHaveBeenCalledWith(mockServer);
      expect(mockServer.use).toHaveBeenCalled();
    });

    it("middleware should reject connection if no token provided", async () => {
      let middlewareFn: any;
      const mockServer = {
        use: jest.fn((fn) => {
          middlewareFn = fn;
        }),
      } as any;

      gateway.afterInit(mockServer);

      const mockSocket = {
        id: "socket-123",
        handshake: { auth: {}, headers: {} },
      };
      const nextFn = jest.fn();

      await middlewareFn(mockSocket, nextFn);
      expect(nextFn).toHaveBeenCalledWith(expect.any(Error));
    });

    it("middleware should attach user to socket on valid JWT", async () => {
      let middlewareFn: any;
      const mockServer = {
        use: jest.fn((fn) => {
          middlewareFn = fn;
        }),
      } as any;

      gateway.afterInit(mockServer);

      const mockSocket = {
        id: "socket-123",
        handshake: { auth: { token: "valid-token" }, headers: {} },
      } as any;
      const nextFn = jest.fn();

      jwtService.verify.mockReturnValue({ sub: "user-1" });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: "user-1",
        email: "test@example.com",
        isActive: true,
      });

      await middlewareFn(mockSocket, nextFn);

      expect(mockSocket.user).toEqual({
        id: "user-1",
        email: "test@example.com",
      });
      expect(nextFn).toHaveBeenCalledWith();
    });
  });

  describe("handleConnection", () => {
    it("should log connection when user is attached", async () => {
      const mockClient = {
        id: "socket-123",
        user: { id: "user-1", email: "test@example.com" },
        join: jest.fn(),
        disconnect: jest.fn(),
      } as any;

      await gateway.handleConnection(mockClient);
      expect(mockClient.join).toHaveBeenCalledWith(
        WEBSOCKET_ROOMS.user("user-1"),
      );
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it("should disconnect socket if user is missing", async () => {
      const mockClient = {
        id: "socket-123",
        disconnect: jest.fn(),
      } as any;

      await gateway.handleConnection(mockClient);
      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe("handleJoinProject", () => {
    const dto = {
      organizationId: "11111111-1111-1111-1111-111111111111",
      projectId: "22222222-2222-2222-2222-222222222222",
    };

    it("should fail if socket is unauthenticated", async () => {
      const mockClient = { id: "socket-123" } as unknown as AuthenticatedSocket;

      const response = await gateway.handleJoinProject(mockClient, dto);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(
        WEBSOCKET_ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    });

    it("should fail if user does not belong to organization", async () => {
      const mockClient = {
        id: "socket-123",
        user: { id: "user-1", email: "test@example.com" },
      } as AuthenticatedSocket;

      tenancyService.validateAndGetTenantContext.mockRejectedValue(
        new Error("User is not a member of this organization"),
      );

      const response = await gateway.handleJoinProject(mockClient, dto);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(
        WEBSOCKET_ERROR_CODES.PROJECT_ACCESS_DENIED,
      );
    });

    it("should fail if project is not found in organization", async () => {
      const mockClient = {
        id: "socket-123",
        user: { id: "user-1", email: "test@example.com" },
      } as AuthenticatedSocket;

      tenancyService.validateAndGetTenantContext.mockResolvedValue({} as any);
      (prisma.project.findFirst as jest.Mock).mockResolvedValue(null);

      const response = await gateway.handleJoinProject(mockClient, dto);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(
        WEBSOCKET_ERROR_CODES.PROJECT_NOT_FOUND,
      );
    });

    it("should fail if user is not a member of project", async () => {
      const mockClient = {
        id: "socket-123",
        user: { id: "user-1", email: "test@example.com" },
      } as AuthenticatedSocket;

      tenancyService.validateAndGetTenantContext.mockResolvedValue({} as any);
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: dto.projectId,
      } as any);
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue(null);

      const response = await gateway.handleJoinProject(mockClient, dto);

      expect(response.success).toBe(false);
      expect(response.error?.code).toBe(
        WEBSOCKET_ERROR_CODES.PROJECT_ACCESS_DENIED,
      );
    });

    it("should join project room when all checks pass", async () => {
      const mockClient = {
        id: "socket-123",
        user: { id: "user-1", email: "test@example.com" },
        join: jest.fn(),
      } as any;

      tenancyService.validateAndGetTenantContext.mockResolvedValue({} as any);
      (prisma.project.findFirst as jest.Mock).mockResolvedValue({
        id: dto.projectId,
      } as any);
      (prisma.projectMember.findUnique as jest.Mock).mockResolvedValue({
        projectId: dto.projectId,
        userId: "user-1",
      } as any);

      const response = await gateway.handleJoinProject(mockClient, dto);

      const expectedRoom = WEBSOCKET_ROOMS.project(
        dto.organizationId,
        dto.projectId,
      );
      expect(mockClient.join).toHaveBeenCalledWith(expectedRoom);
      expect(response.success).toBe(true);
      expect(response.room).toBe(expectedRoom);
    });
  });

  describe("handleLeaveProject", () => {
    it("should leave project room", async () => {
      const mockClient = {
        id: "socket-123",
        leave: jest.fn(),
      } as any;

      const dto = {
        organizationId: "11111111-1111-1111-1111-111111111111",
        projectId: "22222222-2222-2222-2222-222222222222",
      };

      const response = await gateway.handleLeaveProject(mockClient, dto);

      const expectedRoom = WEBSOCKET_ROOMS.project(
        dto.organizationId,
        dto.projectId,
      );
      expect(mockClient.leave).toHaveBeenCalledWith(expectedRoom);
      expect(response.success).toBe(true);
      expect(response.room).toBe(expectedRoom);
    });
  });
});
