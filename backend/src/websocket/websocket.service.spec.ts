import { Test, TestingModule } from "@nestjs/testing";
import { WebSocketService } from "./websocket.service";
import { WEBSOCKET_EVENTS, WEBSOCKET_ROOMS } from "./websocket.constants";

describe("WebSocketService (Unit)", () => {
  let service: WebSocketService;
  let mockServer: any;

  beforeEach(async () => {
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [WebSocketService],
    }).compile();

    service = module.get<WebSocketService>(WebSocketService);
    service.setServer(mockServer);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("emitProjectEvent", () => {
    it("should broadcast project event to authorized project room", () => {
      const orgId = "org-1";
      const projectId = "proj-1";
      const data = { id: projectId, name: "Test Project" };

      service.emitProjectEvent(orgId, projectId, "PROJECT_CREATED", data);

      const expectedRoom = WEBSOCKET_ROOMS.project(orgId, projectId);
      expect(mockServer.to).toHaveBeenCalledWith(expectedRoom);
      expect(mockServer.emit).toHaveBeenCalledWith(
        WEBSOCKET_EVENTS.PROJECT_CREATED,
        expect.objectContaining({
          organizationId: orgId,
          projectId: projectId,
          type: WEBSOCKET_EVENTS.PROJECT_CREATED,
          data: data,
        }),
      );
    });
  });

  describe("emitTaskEvent", () => {
    it("should broadcast task event with task ID and sanitized data", () => {
      const orgId = "org-1";
      const projectId = "proj-1";
      const taskId = "task-1";
      const data = {
        id: taskId,
        title: "Task Title",
        password: "secret-password",
      };

      service.emitTaskEvent(orgId, projectId, taskId, "TASK_CREATED", data);

      const expectedRoom = WEBSOCKET_ROOMS.project(orgId, projectId);
      expect(mockServer.to).toHaveBeenCalledWith(expectedRoom);
      expect(mockServer.emit).toHaveBeenCalledWith(
        WEBSOCKET_EVENTS.TASK_CREATED,
        expect.objectContaining({
          organizationId: orgId,
          projectId: projectId,
          taskId: taskId,
          type: WEBSOCKET_EVENTS.TASK_CREATED,
          data: { id: taskId, title: "Task Title" }, // password removed
        }),
      );
    });
  });

  describe("emitCommentEvent", () => {
    it("should broadcast comment event to project room", () => {
      const orgId = "org-1";
      const projectId = "proj-1";
      const taskId = "task-1";
      const commentId = "comment-1";
      const data = { content: "Comment Content" };

      service.emitCommentEvent(
        orgId,
        projectId,
        taskId,
        commentId,
        "COMMENT_CREATED",
        data,
      );

      expect(mockServer.to).toHaveBeenCalledWith(
        WEBSOCKET_ROOMS.project(orgId, projectId),
      );
      expect(mockServer.emit).toHaveBeenCalledWith(
        WEBSOCKET_EVENTS.COMMENT_CREATED,
        expect.objectContaining({
          organizationId: orgId,
          projectId: projectId,
          taskId: taskId,
          type: WEBSOCKET_EVENTS.COMMENT_CREATED,
          data: expect.objectContaining({
            commentId,
            content: "Comment Content",
          }),
        }),
      );
    });
  });
});
