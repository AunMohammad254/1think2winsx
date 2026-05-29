'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Send,
  Bot,
  ChevronRight,
  RotateCcw,
  Sparkles,
  MessageCircle,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  redirects?: string[];
  model?: string;
  timestamp: Date;
  failed?: boolean;
}

interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

// ─────────────────────────────────────────────────────────────
// Quick suggestion chips
// ─────────────────────────────────────────────────────────────
const QUICK_SUGGESTIONS = [
  { label: '🏏 How do I register?',     text: 'How do I register and join a quiz?' },
  { label: '🏆 What prizes can I win?', text: 'What prizes are available to win?' },
  { label: '❓ How does the quiz work?', text: 'How does the quiz competition work?' },
  { label: '📊 View Leaderboard',       text: 'I want to see the leaderboard.' },
  { label: '💳 Payment methods?',       text: 'What payment methods are accepted?' },
  { label: '🎯 Winning chances?',       text: 'How are winners selected? What are my chances?' },
];

// ─────────────────────────────────────────────────────────────
// Redirect path → nice label map
// ─────────────────────────────────────────────────────────────
const REDIRECT_LABELS: Record<string, string> = {
  '/':              '🏠 Go to Homepage',
  '/register':      '📝 Register Now',
  '/login':         '🔑 Sign In',
  '/quizzes':       '🎮 Browse Quizzes',
  '/leaderboard':   '📊 View Leaderboard',
  '/prizes':        '🏆 See All Prizes',
  '/profile':       '👤 My Profile',
  '/how-to-play':   '📖 How To Play',
  '/faq':           '❓ FAQ',
  '/contact':       '📞 Contact Support',
  '/privacy':       '🔒 Privacy Policy',
  '/terms':         '📋 Terms & Conditions',
  '/disclaimer':    '⚠️ Disclaimer',
};

function getRedirectLabel(path: string): string {
  return REDIRECT_LABELS[path] ?? `→ Go to ${path}`;
}

// ─────────────────────────────────────────────────────────────
// Typing indicator
// ─────────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center flex-shrink-0">
        <Bot className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="chatbot-bubble-ai px-4 py-3 rounded-2xl rounded-bl-md">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-blue-400"
              style={{ animation: `chatDotBounce 1.2s ${i * 0.2}s ease-in-out infinite` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Single message bubble
// ─────────────────────────────────────────────────────────────
function MessageBubble({
  message,
  onRedirect,
  onRetry,
}: {
  message: ChatMessage;
  onRedirect: (path: string) => void;
  onRetry?: () => void;
}) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-end gap-2 mb-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center flex-shrink-0">
          <Bot className="w-3.5 h-3.5 text-white" />
        </div>
      )}

      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1.5`}>
        {/* Bubble */}
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
            isUser
              ? 'chatbot-bubble-user rounded-br-md text-white'
              : message.failed
              ? 'chatbot-bubble-error rounded-bl-md'
              : 'chatbot-bubble-ai rounded-bl-md text-white/90'
          }`}
        >
          {message.content}

          {/* Retry button for failed messages */}
          {message.failed && onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 mt-2 text-xs text-red-300 hover:text-red-200 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Retry
            </button>
          )}
        </div>

        {/* Navigation chips */}
        {message.redirects && message.redirects.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.redirects.map((path) => (
              <button
                key={path}
                onClick={() => onRedirect(path)}
                className="chatbot-redirect-chip flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
              >
                {getRedirectLabel(path)}
                <ChevronRight className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}

        {/* Metadata */}
        <div className={`flex items-center gap-2 text-[10px] text-white/30 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span>
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {message.model && (
            <>
              <span>·</span>
              <span className="text-blue-400/60">{message.model}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main ChatbotWidget
// ─────────────────────────────────────────────────────────────
export default function ChatbotWidget() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastUserMessageRef = useRef<string>('');

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setHasUnread(false);
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // Greet on first open
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content:
            "👋 Hey! I'm the 1Think2Win support assistant.\n\nI can help you with registration, quiz rules, prizes, payments, and navigate you around the platform. What can I help you with today? 🏏",
          redirects: [],
          timestamp: new Date(),
        },
      ]);
    }
  }, [isOpen, messages.length]);

  // Build Gemini message history
  function buildHistory(msgs: ChatMessage[]): GeminiMessage[] {
    return msgs
      .filter((m) => !m.failed)
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      }));
  }

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
        if (!isOpen) setHasUnread(true);
        return;
      }

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        redirects: data.redirects ?? [],
        model: data.model,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, aiMsg]);
      if (!isOpen) setHasUnread(true);
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

  function handleRetry() {
    if (lastUserMessageRef.current) {
      // Remove last failed AI message
      setMessages((prev) => {
        const copy = [...prev];
        if (copy[copy.length - 1]?.failed) copy.pop();
        return copy;
      });
      sendMessage(lastUserMessageRef.current);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleRedirect(path: string) {
    router.push(path);
    setIsOpen(false);
  }

  function handleClearChat() {
    setMessages([]);
    setShowSuggestions(true);
  }

  return (
    <>
      {/* ─── CSS-in-JS keyframes injected via style tag ─── */}
      <style>{`
        @keyframes chatDotBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40%            { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes chatPulseRing {
          0%   { transform: scale(1);    opacity: 0.6; }
          100% { transform: scale(1.6);  opacity: 0; }
        }
        .chatbot-bubble-user {
          background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
        }
        .chatbot-bubble-ai {
          background: rgba(255, 255, 255, 0.07);
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(8px);
        }
        .chatbot-bubble-error {
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.25);
          color: #fca5a5;
        }
        .chatbot-redirect-chip {
          background: rgba(37, 99, 235, 0.15);
          border: 1px solid rgba(59, 130, 246, 0.35);
          color: #93c5fd;
        }
        .chatbot-redirect-chip:hover {
          background: rgba(37, 99, 235, 0.30);
          border-color: rgba(59, 130, 246, 0.6);
          color: #bfdbfe;
          transform: translateY(-1px);
        }
        .chatbot-panel {
          background: rgba(10, 15, 35, 0.92);
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
        }
        .chatbot-input {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: white;
          resize: none;
          field-sizing: content;
          min-height: 44px;
          max-height: 120px;
        }
        .chatbot-input:focus {
          outline: none;
          border-color: rgba(59, 130, 246, 0.5);
          background: rgba(255, 255, 255, 0.07);
        }
        .chatbot-input::placeholder { color: rgba(255,255,255,0.3); }
        .chatbot-scrollbar::-webkit-scrollbar { width: 4px; }
        .chatbot-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .chatbot-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.15);
          border-radius: 2px;
        }
      `}</style>

      {/* ─── Floating trigger button ─── */}
      <div className="fixed bottom-6 right-6 z-[9999]">
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.93 }}
              onClick={() => setIsOpen(true)}
              id="chatbot-trigger-btn"
              aria-label="Open AI support chat"
              className="relative w-14 h-14 rounded-full shadow-2xl shadow-blue-500/30 flex items-center justify-center bg-gradient-to-br from-blue-600 via-blue-700 to-purple-700 border border-white/20"
            >
              {/* Pulse ring */}
              <span
                className="absolute inset-0 rounded-full bg-blue-500/40"
                style={{ animation: 'chatPulseRing 2s ease-out infinite' }}
              />
              <MessageCircle className="w-6 h-6 text-white relative z-10" />

              {/* Unread badge */}
              {hasUnread && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-[#0a0f23] text-[9px] text-white flex items-center justify-center font-bold z-20">
                  !
                </span>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Chat panel ─── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{ opacity: 0, y: 30,  scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-[9999] w-[360px] sm:w-[400px] max-h-[85vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl shadow-black/50 chatbot-panel"
            style={{ maxHeight: 'min(600px, 85vh)' }}
            id="chatbot-panel"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gradient-to-r from-blue-900/40 to-purple-900/40 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center shadow-lg">
                  <Bot className="w-4.5 h-4.5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white leading-tight">1Think2Win AI</p>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    <span className="text-[10px] text-green-400/80">Online · Powered by Gemini</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {messages.length > 1 && (
                  <button
                    onClick={handleClearChat}
                    title="Clear chat"
                    className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-all duration-200"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label="Close chat"
                  id="chatbot-close-btn"
                  className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-all duration-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 chatbot-scrollbar">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onRedirect={handleRedirect}
                  onRetry={msg.failed ? handleRetry : undefined}
                />
              ))}

              {isLoading && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick suggestions */}
            <AnimatePresence>
              {showSuggestions && messages.length <= 1 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="px-4 pb-2 border-t border-white/5 flex-shrink-0"
                >
                  <p className="text-[10px] text-white/30 uppercase tracking-wider pt-2 pb-1.5 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    Quick questions
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_SUGGESTIONS.map((s) => (
                      <button
                        key={s.text}
                        onClick={() => sendMessage(s.text)}
                        disabled={isLoading}
                        className="px-2.5 py-1 text-[11px] rounded-full border border-white/10 bg-white/5 text-white/60 hover:text-white hover:border-white/20 hover:bg-white/10 transition-all duration-200 disabled:opacity-40"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input area */}
            <div className="flex items-end gap-2 p-3 border-t border-white/10 bg-black/20 flex-shrink-0">
              <textarea
                ref={inputRef}
                id="chatbot-input"
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything… 🏏"
                disabled={isLoading}
                className="flex-1 px-3 py-2.5 rounded-xl text-sm chatbot-input disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={isLoading || !input.trim()}
                id="chatbot-send-btn"
                aria-label="Send message"
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg transition-all duration-200 hover:from-blue-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>

            {/* Footer disclaimer */}
            <div className="text-center text-[9px] text-white/15 pb-2 flex-shrink-0">
              AI can make mistakes · Always verify important information
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
