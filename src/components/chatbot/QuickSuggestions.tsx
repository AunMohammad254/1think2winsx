import { Sparkles } from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Quick suggestion chips
// ─────────────────────────────────────────────────────────────
const QUICK_SUGGESTIONS = [
  { label: '🏏 How do I register?',     text: 'How do I register and join a quiz?' },
  { label: '🏆 What prizes can I win?', text: 'What prizes are available to win?' },
  { label: '❓ How does the quiz work?', text: 'How does the quiz competition work?' },
  { label: '📊 View Leaderboard',       text: 'I want to see the leaderboard.' },
  { label: '💳 Do I need to pay?',      text: 'Do I need to pay to play a quiz?' },
  { label: '🎯 Winning chances?',       text: 'How are winners selected? What are my chances?' },
  { label: '🎫 My support tickets',     text: 'What is the status of my support tickets?' },
];

/**
 * The quick-question chips. The 1fr <-> 0fr grid row expands and collapses them to their own height;
 * the parent keeps them mounted (usePresence) while `open` is false so the collapse can play.
 */
export function QuickSuggestions({
  open,
  disabled,
  onPick,
}: {
  open: boolean;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <div
      data-state={open ? 'open' : 'closed'}
      className="chatbot-suggestions grid grid-rows-[1fr] flex-shrink-0"
    >
      <div className="min-h-0 overflow-hidden">
        <div className="px-4 pb-2 border-t border-white/5">
          <p className="text-[10px] text-white/30 uppercase tracking-wider pt-2 pb-1.5 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Quick questions
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_SUGGESTIONS.map((s) => (
              <button
                key={s.text}
                onClick={() => onPick(s.text)}
                disabled={disabled}
                className="px-2.5 py-1 text-[11px] rounded-full border border-white/10 bg-white/5 text-white/60 hover:text-white hover:border-white/20 hover:bg-white/10 transition-all duration-200 disabled:opacity-40"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
