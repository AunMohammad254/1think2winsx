import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { parse } from 'url';
import { getToken } from 'next-auth/jwt';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  isAdmin?: boolean;
  channels?: Set<string>;
}

// Define proper types for WebSocket message data
interface QuizData {
  id: string;
  title: string;
  description?: string;
  isActive?: boolean;
  status?: string;
  [key: string]: unknown;
}

interface QuestionData {
  id: string;
  quizId: string;
  text: string;
  options: string[];
  correctOption?: number;
  status?: string;
  [key: string]: unknown;
}

// Mock request interface for NextAuth compatibility
interface MockNextAuthRequest {
  headers: {
    authorization: string;
    cookie: string;
  };
  cookies: Map<string, string>;
  url: string;
}

interface WebSocketMessage {
  type: string;
  channel?: string;
  data?: QuizData | QuestionData | Record<string, unknown>;
  timestamp?: number;
}

class QuizWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, AuthenticatedWebSocket> = new Map();
  private channels: Map<string, Set<string>> = new Map();

  constructor() {
    this.setupWebSocketServer();
  }

  private setupWebSocketServer() {
    // This would typically be integrated with your Next.js server
    // For now, we'll create a basic structure that can be extended
    console.log('WebSocket server structure initialized');
  }

  // Authenticate WebSocket connection
  private async authenticateConnection(
    ws: AuthenticatedWebSocket, 
    request: IncomingMessage
  ): Promise<boolean> {
    try {
      const url = parse(request.url || '', true);
      const token = url.query.token as string;

      if (!token) {
        return false;
      }

      // Create a mock request object for NextAuth's getToken
       const mockRequest: MockNextAuthRequest = {
         headers: {
           authorization: `Bearer ${token}`,
           cookie: request.headers.cookie || ''
         },
         cookies: new Map(),
         url: request.url || ''
       };

      // Verify JWT token using NextAuth's getToken
      const decoded = await getToken({ 
        req: mockRequest,
        secret: process.env.NEXTAUTH_SECRET || ''
      });
      
      if (!decoded) {
        return false;
      }

      ws.userId = decoded.id as string;
      ws.isAdmin = decoded.isAdmin as boolean;
      ws.channels = new Set();

      this.clients.set(ws.userId, ws);
      return true;
    } catch (error) {
      console.error('WebSocket authentication failed:', error);
      return false;
    }
  }

  // Handle client connection
  private handleConnection(ws: AuthenticatedWebSocket, request: IncomingMessage) {
    console.log('New WebSocket connection attempt');

    // Authenticate the connection
    this.authenticateConnection(ws, request).then((authenticated) => {
      if (!authenticated) {
        ws.close(1008, 'Authentication failed');
        return;
      }

      console.log(`User ${ws.userId} connected via WebSocket`);

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error('Invalid WebSocket message:', error);
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: 'Invalid message format' }
          }));
        }
      });

      // Handle disconnection
      ws.on('close', () => {
        this.handleDisconnection(ws);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        data: { message: 'WebSocket connection established' },
        timestamp: Date.now()
      }));
    });
  }

  // Handle incoming messages
  private handleMessage(ws: AuthenticatedWebSocket, message: WebSocketMessage) {
    switch (message.type) {
      case 'join_channel':
        this.joinChannel(ws, message.channel || '');
        break;
      case 'leave_channel':
        this.leaveChannel(ws, message.channel || '');
        break;
      case 'quiz_updated':
        if (ws.isAdmin && message.data) {
          this.broadcastQuizUpdate(message.data as QuizData);
        }
        break;
      case 'question_updated':
        if (ws.isAdmin && message.data) {
          this.broadcastQuestionUpdate(message.data as QuestionData);
        }
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      default:
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Unknown message type' }
        }));
    }
  }

  // Join a channel (e.g., quiz editing room)
  private joinChannel(ws: AuthenticatedWebSocket, channel: string) {
    if (!channel || !ws.userId) return;

    // Add user to channel
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)?.add(ws.userId);
    ws.channels?.add(channel);

    // Notify user
    ws.send(JSON.stringify({
      type: 'channel_joined',
      channel,
      timestamp: Date.now()
    }));

    // Notify other users in the channel (for admin presence)
    if (ws.isAdmin) {
      this.broadcastToChannel(channel, {
        type: 'admin_joined',
        data: { userId: ws.userId, channel },
        timestamp: Date.now()
      }, ws.userId);
    }
  }

  // Leave a channel
  private leaveChannel(ws: AuthenticatedWebSocket, channel: string) {
    if (!channel || !ws.userId) return;

    this.channels.get(channel)?.delete(ws.userId);
    ws.channels?.delete(channel);

    // Clean up empty channels
    if (this.channels.get(channel)?.size === 0) {
      this.channels.delete(channel);
    }

    // Notify user
    ws.send(JSON.stringify({
      type: 'channel_left',
      channel,
      timestamp: Date.now()
    }));

    // Notify other users in the channel
    if (ws.isAdmin) {
      this.broadcastToChannel(channel, {
        type: 'admin_left',
        data: { userId: ws.userId, channel },
        timestamp: Date.now()
      }, ws.userId);
    }
  }

  // Handle disconnection
  private handleDisconnection(ws: AuthenticatedWebSocket) {
    if (!ws.userId) return;

    console.log(`User ${ws.userId} disconnected`);

    // Remove from all channels
    ws.channels?.forEach(channel => {
      this.channels.get(channel)?.delete(ws.userId!);
      if (this.channels.get(channel)?.size === 0) {
        this.channels.delete(channel);
      }
    });

    // Remove from clients
    this.clients.delete(ws.userId);
  }

  // Broadcast quiz updates to all connected clients
   public broadcastQuizUpdate(quizData: QuizData | Record<string, unknown>) {
     const message = {
       type: 'quiz_updated',
       data: quizData,
       timestamp: Date.now()
     };

     this.broadcast(message);
   }

   // Broadcast question updates to specific quiz channel
   public broadcastQuestionUpdate(questionData: QuestionData | Record<string, unknown>) {
     const channel = `quiz_${(questionData as QuestionData).quizId}`;
     const message = {
       type: 'question_updated',
       data: questionData,
       timestamp: Date.now()
     };

     this.broadcastToChannel(channel, message);
   }

  // Broadcast to all connected clients
  private broadcast(message: WebSocketMessage) {
    const messageStr = JSON.stringify(message);
    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  // Broadcast to specific channel
  private broadcastToChannel(channel: string, message: WebSocketMessage, excludeUserId?: string) {
    const messageStr = JSON.stringify(message);
    const channelUsers = this.channels.get(channel);

    if (!channelUsers) return;

    channelUsers.forEach((userId) => {
      if (userId === excludeUserId) return;
      
      const ws = this.clients.get(userId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  // Get active admins in a channel
  public getActiveAdmins(channel: string): string[] {
    const channelUsers = this.channels.get(channel);
    if (!channelUsers) return [];

    const activeAdmins: string[] = [];
    channelUsers.forEach((userId) => {
      const ws = this.clients.get(userId);
      if (ws && ws.isAdmin && ws.readyState === WebSocket.OPEN) {
        activeAdmins.push(userId);
      }
    });

    return activeAdmins;
  }

  // Send message to specific user
  public sendToUser(userId: string, message: WebSocketMessage) {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // Get connection stats
  public getStats() {
    return {
      totalConnections: this.clients.size,
      activeChannels: this.channels.size,
      adminConnections: Array.from(this.clients.values()).filter(ws => ws.isAdmin).length
    };
  }
}

// Export singleton instance
export const quizWebSocketServer = new QuizWebSocketServer();

// Helper function to broadcast quiz updates from API routes
export function broadcastQuizUpdate(quizData: QuizData | Record<string, unknown>) {
  quizWebSocketServer.broadcastQuizUpdate(quizData);
}

// Helper function to broadcast question updates from API routes
export function broadcastQuestionUpdate(questionData: QuestionData | Record<string, unknown>) {
  quizWebSocketServer.broadcastQuestionUpdate(questionData);
}

export default QuizWebSocketServer;