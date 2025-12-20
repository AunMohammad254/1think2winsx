import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Define specific data types for different message types
interface QuizUpdateData {
  quizId: string;
  title?: string;
  description?: string;
  status?: string;
  [key: string]: unknown;
}

interface QuestionUpdateData {
  questionId: string;
  quizId: string;
  question?: string;
  options?: string[];
  correctAnswer?: number;
  [key: string]: unknown;
}

interface AdminActivityData {
  userId: string;
  username?: string;
  timestamp?: number;
  [key: string]: unknown;
}

interface PingData {
  timestamp: number;
}

interface ChannelData {
  channel: string;
  userId?: string;
  [key: string]: unknown;
}

// Union type for all possible WebSocket message data
type WebSocketMessageData =
  | QuizUpdateData
  | QuestionUpdateData
  | AdminActivityData
  | PingData
  | ChannelData
  | Record<string, unknown>
  | null
  | undefined;

interface WebSocketMessage {
  type: string;
  channel?: string;
  data?: WebSocketMessageData;
  timestamp?: number;
}

interface UseWebSocketOptions {
  url?: string;
  autoConnect?: boolean;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

interface WebSocketState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  lastMessage: WebSocketMessage | null;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { user } = useAuth();
  const {
    url = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001',
    autoConnect = true,
    reconnectAttempts = 5,
    reconnectInterval = 3000
  } = options;

  const ws = useRef<WebSocket | null>(null);
  const reconnectCount = useRef(0);
  const reconnectTimer = useRef<NodeJS.Timeout | null>(null);
  const messageHandlers = useRef<Map<string, (data: WebSocketMessageData) => void>>(new Map());

  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    lastMessage: null
  });

  // Schedule reconnection function
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
    }

    reconnectCount.current++;
    console.log(`Scheduling WebSocket reconnect attempt ${reconnectCount.current}/${reconnectAttempts}`);

    reconnectTimer.current = setTimeout(() => {
      // Inline reconnection logic to avoid circular dependency
      if (!user) {
        setState(prev => ({ ...prev, error: 'No authenticated session' }));
        return;
      }

      if (ws.current?.readyState === WebSocket.OPEN) {
        return; // Already connected
      }

      setState(prev => ({ ...prev, isConnecting: true, error: null }));

      try {
        const wsUrl = `${url}?token=${user.id || 'demo-token'}`;
        ws.current = new WebSocket(wsUrl);

        ws.current.onopen = () => {
          console.log('WebSocket reconnected');
          reconnectCount.current = 0;
          setState(prev => ({
            ...prev,
            isConnected: true,
            isConnecting: false,
            error: null
          }));
        };

        ws.current.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);

            setState(prev => ({ ...prev, lastMessage: message }));

            // Call specific message handlers
            const handler = messageHandlers.current.get(message.type);
            if (handler) {
              handler(message.data);
            }

            // Call generic message handler
            const genericHandler = messageHandlers.current.get('*');
            if (genericHandler) {
              genericHandler(message.data);
            }
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        ws.current.onclose = (event) => {
          console.log('WebSocket disconnected:', event.code, event.reason);
          setState(prev => ({
            ...prev,
            isConnected: false,
            isConnecting: false
          }));

          // Attempt to reconnect if not a manual close
          if (event.code !== 1000 && reconnectCount.current < reconnectAttempts) {
            scheduleReconnect();
          }
        };

        ws.current.onerror = (error) => {
          console.error('WebSocket error:', error);
          setState(prev => ({
            ...prev,
            error: 'WebSocket connection error',
            isConnecting: false
          }));
        };

      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        setState(prev => ({
          ...prev,
          error: 'Failed to create WebSocket connection',
          isConnecting: false
        }));
      }
    }, reconnectInterval);
  }, [user, url, reconnectAttempts, reconnectInterval]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!user) {
      setState(prev => ({ ...prev, error: 'No authenticated session' }));
      return;
    }

    if (ws.current?.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Create WebSocket connection with user ID as token
      const wsUrl = `${url}?token=${user.id || 'demo-token'}`;
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log('WebSocket connected');
        reconnectCount.current = 0;
        setState(prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
          error: null
        }));
      };

      ws.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          setState(prev => ({ ...prev, lastMessage: message }));

          // Call specific message handlers
          const handler = messageHandlers.current.get(message.type);
          if (handler) {
            handler(message.data);
          }

          // Call generic message handler
          const genericHandler = messageHandlers.current.get('*');
          if (genericHandler) {
            genericHandler(message.data);
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.current.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false
        }));

        // Attempt to reconnect if not a manual close
        if (event.code !== 1000 && reconnectCount.current < reconnectAttempts) {
          scheduleReconnect();
        }
      };

      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setState(prev => ({
          ...prev,
          error: 'WebSocket connection error',
          isConnecting: false
        }));
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setState(prev => ({
        ...prev,
        error: 'Failed to create WebSocket connection',
        isConnecting: false
      }));
    }
  }, [user, url, reconnectAttempts, scheduleReconnect]);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    if (ws.current) {
      ws.current.close(1000, 'Manual disconnect');
      ws.current = null;
    }

    setState(prev => ({
      ...prev,
      isConnected: false,
      isConnecting: false
    }));
  }, []);

  // Send message
  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        ...message,
        timestamp: Date.now()
      }));
      return true;
    }
    return false;
  }, []);

  // Join a channel
  const joinChannel = useCallback((channel: string) => {
    return sendMessage({
      type: 'join_channel',
      channel
    });
  }, [sendMessage]);

  // Leave a channel
  const leaveChannel = useCallback((channel: string) => {
    return sendMessage({
      type: 'leave_channel',
      channel
    });
  }, [sendMessage]);

  // Subscribe to message type
  const subscribe = useCallback((messageType: string, handler: (data: WebSocketMessageData) => void) => {
    messageHandlers.current.set(messageType, handler);

    // Return unsubscribe function
    return () => {
      messageHandlers.current.delete(messageType);
    };
  }, []);

  // Send ping to keep connection alive
  const ping = useCallback(() => {
    return sendMessage({ type: 'ping' });
  }, [sendMessage]);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect && user) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, user, connect, disconnect]);

  // Ping interval to keep connection alive
  useEffect(() => {
    if (!state.isConnected) return;

    const pingInterval = setInterval(() => {
      ping();
    }, 30000); // Ping every 30 seconds

    return () => clearInterval(pingInterval);
  }, [state.isConnected, ping]);

  return {
    ...state,
    connect,
    disconnect,
    sendMessage,
    joinChannel,
    leaveChannel,
    subscribe,
    ping
  };
}

// Hook for quiz-specific WebSocket functionality
export function useQuizWebSocket(quizId?: string) {
  const webSocket = useWebSocket();
  const [quizUpdates, setQuizUpdates] = useState<QuizUpdateData[]>([]);
  const [questionUpdates, setQuestionUpdates] = useState<QuestionUpdateData[]>([]);
  const [activeAdmins, setActiveAdmins] = useState<string[]>([]);

  // Subscribe to quiz updates
  useEffect(() => {
    const unsubscribeQuiz = webSocket.subscribe('quiz_updated', (data) => {
      if (data && typeof data === 'object' && 'quizId' in data) {
        setQuizUpdates(prev => [...prev, data as QuizUpdateData]);
      }
    });

    const unsubscribeQuestion = webSocket.subscribe('question_updated', (data) => {
      if (data && typeof data === 'object' && 'questionId' in data) {
        setQuestionUpdates(prev => [...prev, data as QuestionUpdateData]);
      }
    });

    const unsubscribeAdminJoined = webSocket.subscribe('admin_joined', (data) => {
      if (data && typeof data === 'object' && 'userId' in data) {
        const adminData = data as AdminActivityData;
        setActiveAdmins(prev => [...prev, adminData.userId]);
      }
    });

    const unsubscribeAdminLeft = webSocket.subscribe('admin_left', (data) => {
      if (data && typeof data === 'object' && 'userId' in data) {
        const adminData = data as AdminActivityData;
        setActiveAdmins(prev => prev.filter(id => id !== adminData.userId));
      }
    });

    return () => {
      unsubscribeQuiz();
      unsubscribeQuestion();
      unsubscribeAdminJoined();
      unsubscribeAdminLeft();
    };
  }, [webSocket]);

  // Join quiz channel when quizId changes
  useEffect(() => {
    if (quizId && webSocket.isConnected) {
      webSocket.joinChannel(`quiz_${quizId}`);

      return () => {
        webSocket.leaveChannel(`quiz_${quizId}`);
      };
    }
  }, [quizId, webSocket.isConnected, webSocket]);

  // Broadcast quiz update (admin only)
  const broadcastQuizUpdate = useCallback((quizData: QuizUpdateData) => {
    return webSocket.sendMessage({
      type: 'quiz_update',
      data: quizData
    });
  }, [webSocket]);

  // Broadcast question update (admin only)
  const broadcastQuestionUpdate = useCallback((questionData: QuestionUpdateData) => {
    return webSocket.sendMessage({
      type: 'question_update',
      data: questionData
    });
  }, [webSocket]);

  return {
    ...webSocket,
    quizUpdates,
    questionUpdates,
    activeAdmins,
    broadcastQuizUpdate,
    broadcastQuestionUpdate,
    clearUpdates: () => {
      setQuizUpdates([]);
      setQuestionUpdates([]);
    }
  };
}