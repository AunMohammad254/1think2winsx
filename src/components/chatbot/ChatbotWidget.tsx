'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { usePresence } from '@/hooks/usePresence';
import { useChatbot } from './useChatbot';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { QuickSuggestions } from './QuickSuggestions';
import { ChatComposer } from './ChatComposer';
import { CHATBOT_STYLES } from './chatbotStyles';

// ─────────────────────────────────────────────────────────────
// Main ChatbotWidget: the floating trigger and the chat panel around the conversation in useChatbot
// ─────────────────────────────────────────────────────────────
export default function ChatbotWidget() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const {
    messages,
    input,
    setInput,
    isLoading,
    hasUnread,
    suggestionsShown,
    sendMessage,
    retry,
    clearChat,
  } = useChatbot(isOpen);
  // Each stays mounted while its exit animation plays (durations match CHATBOT_STYLES)
  const triggerMounted = usePresence(!isOpen, 200);
  const panelMounted = usePresence(isOpen, 300);
  const suggestionsMounted = usePresence(suggestionsShown, 300);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  function handleRedirect(path: string) {
    router.push(path);
    setIsOpen(false);
  }

  return (
    <>
      {/* ─── CSS-in-JS keyframes injected via style tag ─── */}
      <style>{CHATBOT_STYLES}</style>

      {/* ─── Floating trigger button ─── */}
      <div className="fixed bottom-5 right-4 sm:bottom-6 sm:right-6 z-[9999]">
        {triggerMounted && (
          <button
            data-state={isOpen ? 'closed' : 'open'}
            onClick={() => setIsOpen(true)}
            id="chatbot-trigger-btn"
            aria-label="Open AI support chat"
            className="chatbot-trigger relative w-12 h-12 sm:w-14 sm:h-14 rounded-full shadow-2xl shadow-blue-500/30 flex items-center justify-center bg-gradient-to-br from-blue-600 via-blue-700 to-purple-700 border border-white/20 transition-transform duration-200 motion-safe:hover:scale-[1.08] motion-safe:active:scale-[0.93]"
          >
            {/* Pulse ring */}
            <span
              className="absolute inset-0 rounded-full bg-blue-500/40"
              style={{ animation: 'chatPulseRing 2s ease-out infinite' }}
            />
            <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 text-white relative z-10" />

            {/* Unread badge */}
            {hasUnread && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-[#0a0f23] text-[9px] text-white flex items-center justify-center font-bold z-20">
                !
              </span>
            )}
          </button>
        )}
      </div>

      {/* ─── Backdrop (mobile only) ─── */}
      {panelMounted && (
        <div
          data-state={isOpen ? 'open' : 'closed'}
          className="chatbot-backdrop fixed inset-0 z-[9998] bg-black/50 sm:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* ─── Chat panel ─── */}
      {panelMounted && (
        <div
          /* Mobile: slide up from bottom full-width sheet */
          /* sm+: the same slide-up for the floating card bottom-right */
          data-state={isOpen ? 'open' : 'closed'}
          className={
            'chatbot-slide fixed z-[9999] flex flex-col overflow-hidden shadow-2xl shadow-black/60 chatbot-panel chatbot-sheet-mobile ' +
            /* Mobile: anchor full-width to bottom, rounded top corners only */
            'inset-x-0 bottom-0 rounded-t-2xl rounded-b-none ' +
            /* sm+: floating card, restore all rounded corners + right positioning */
            'sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[400px] sm:rounded-2xl sm:rounded-b-2xl'
          }
          style={{
            maxHeight: 'min(600px, 85dvh)',
            /* On mobile fill 80% of viewport height */
            height: 'clamp(420px, 80dvh, 600px)',
          }}
          id="chatbot-panel"
        >
          {/* Drag handle pill — mobile only */}
          <div className="sm:hidden flex justify-center pt-2.5 pb-1 flex-shrink-0">
            <div className="w-10 h-1 rounded-full bg-white/20" />
          </div>

          <ChatHeader canClear={messages.length > 1} onClear={clearChat} onClose={() => setIsOpen(false)} />

          <MessageList
            messages={messages}
            isLoading={isLoading}
            onRedirect={handleRedirect}
            onRetry={retry}
            endRef={messagesEndRef}
          />

          {suggestionsMounted && (
            <QuickSuggestions open={suggestionsShown} disabled={isLoading} onPick={sendMessage} />
          )}

          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={sendMessage}
            disabled={isLoading}
            inputRef={inputRef}
          />

          {/* Footer disclaimer */}
          <div className="text-center text-[9px] text-white/15 pb-2 flex-shrink-0">
            AI can make mistakes · Always verify important information
          </div>
        </div>
      )}
    </>
  );
}
