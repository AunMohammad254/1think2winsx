import type { RefObject } from 'react';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import type { ChatMessage } from './types';

export function MessageList({
  messages,
  isLoading,
  onRedirect,
  onRetry,
  endRef,
}: {
  messages: ChatMessage[];
  isLoading: boolean;
  onRedirect: (path: string) => void;
  /** Offered only on a failed reply that is still the last message */
  onRetry: () => void;
  /** Scrolled into view as messages arrive */
  endRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4 chatbot-scrollbar">
      {messages.map((msg, i) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          onRedirect={onRedirect}
          onRetry={msg.failed && i === messages.length - 1 ? onRetry : undefined}
        />
      ))}

      {isLoading && <TypingIndicator />}
      <div ref={endRef} />
    </div>
  );
}
