import { useState } from 'react';
import { Bot, ChevronRight, RotateCcw, Copy, Check } from 'lucide-react';
import type { ChatMessage } from './types';

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
  '/profile/wallet': '💳 My Wallet',
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

export function MessageBubble({
  message,
  onRedirect,
  onRetry,
}: {
  message: ChatMessage;
  onRedirect: (path: string) => void;
  onRetry?: () => void;
}) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  async function copyTicketNumber(ticketNumber: string) {
    try {
      await navigator.clipboard.writeText(ticketNumber);
      setCopied(true);
    } catch {
      // No clipboard access (e.g. an insecure context): the number is in the message text anyway
    }
  }

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

        {/* Copy the new ticket's number, so the player can keep it */}
        {message.ticketNumber && (
          <button
            onClick={() => copyTicketNumber(message.ticketNumber!)}
            className="chatbot-redirect-chip flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : `Copy ${message.ticketNumber}`}
          </button>
        )}

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
