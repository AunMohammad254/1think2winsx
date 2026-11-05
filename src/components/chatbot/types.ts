export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  redirects?: string[];
  model?: string;
  timestamp: Date;
  failed?: boolean;
  /** A support ticket the server created for this reply */
  ticketNumber?: string;
}
