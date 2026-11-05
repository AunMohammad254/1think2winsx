import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from './types';

interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

// Build Gemini message history
function buildHistory(msgs: ChatMessage[]): GeminiMessage[] {
  return msgs
    .filter((m) => !m.failed)
    .map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));
}

/**
 * The chatbot conversation: messages, the draft in the composer, sending to /api/chatbot,
 * retrying a failed reply and clearing the chat. `isOpen` is whether the panel is showing,
 * which decides the first-open greeting and whether a reply raises the unread badge.
 */
export function useChatbot(isOpen: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);
  const suggestionsShown = showSuggestions && messages.length <= 1;
  // The reply arrives after an await, so read whether the panel is open now, not when the message was sent
  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);
  const lastUserMessageRef = useRef<string>('');

  // Opening the panel shows any reply that arrived while it was closed
  useEffect(() => {
    if (isOpen) setHasUnread(false);
  }, [isOpen]);

  // Greet on first open
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content:
            "👋 Hey! I'm the 1Think2Win support assistant.\n\nI can help you with registration, quiz rules and prizes, and navigate you around the platform. If something's wrong, I can send it to our support team as a ticket. What can I help you with today? 🏏",
          redirects: [],
          timestamp: new Date(),
        },
      ]);
    }
  }, [isOpen, messages.length]);

  // Send message to API
  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return;

    lastUserMessageRef.current = text.trim();
    setShowSuggestions(false);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = buildHistory([...messages, userMsg]);

      const res = await fetch('/api/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errMsg = data?.rateLimited
          ? data.error
          : (data?.error ?? 'Something went wrong. Please try again.');

        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: errMsg,
            timestamp: new Date(),
            failed: !data?.rateLimited,
          },
        ]);

        // Show unread badge if panel is closed
        if (!isOpenRef.current) setHasUnread(true);
        return;
      }

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        redirects: data.redirects ?? [],
        model: data.model,
        timestamp: new Date(),
        ticketNumber: data.ticketNumber,
      };

      setMessages((prev) => [...prev, aiMsg]);
      if (!isOpenRef.current) setHasUnread(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: "Sorry, I couldn't connect to the AI service. Please check your connection and try again.",
          timestamp: new Date(),
          failed: true,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  // Retry is only offered on a failed reply that is still the last message, so it
  // always answers lastUserMessageRef
  function retry() {
    // Remove the failed AI message
    setMessages((prev) => prev.slice(0, -1));
    sendMessage(lastUserMessageRef.current);
  }

  function clearChat() {
    setMessages([]);
    setShowSuggestions(true);
  }

  return {
    messages,
    input,
    setInput,
    isLoading,
    hasUnread,
    suggestionsShown,
    sendMessage,
    retry,
    clearChat,
  };
}
