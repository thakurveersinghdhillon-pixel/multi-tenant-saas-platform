import { Socket } from "socket.io";

export interface SocketUser {
  id: string;
  email: string;
}

export interface AuthenticatedSocket extends Socket {
  user: SocketUser;
}

export interface WebSocketEventPayload<T = any> {
  eventId: string;
  organizationId: string;
  projectId: string;
  taskId?: string;
  type: string;
  timestamp: string;
  actor?: {
    id: string;
    email: string;
  };
  data: T;
}

export interface WebSocketResponse<T = any> {
  success: boolean;
  room?: string;
  message?: string;
  error?: {
    code: string;
    message: string;
  };
  data?: T;
}
