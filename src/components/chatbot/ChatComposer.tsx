import type { KeyboardEvent, RefObject } from 'react';
import { Send } from 'lucide-react';

/** The message box and send button. Enter sends; Shift+Enter starts a new line. */
export function ChatComposer({
  value,
  onChange,
  onSend,
  disabled,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  /** A reply is on its way */
  disabled: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend(value);
    }
  }

  return (
    <div className="flex items-end gap-2 p-3 border-t border-white/10 bg-black/20 flex-shrink-0">
      <textarea
        ref={inputRef}
        id="chatbot-input"
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask me anything… 🏏"
        disabled={disabled}
        className="flex-1 px-3 py-2.5 rounded-xl text-sm chatbot-input disabled:opacity-50"
      />
      <button
        onClick={() => onSend(value)}
        disabled={disabled || !value.trim()}
        id="chatbot-send-btn"
        aria-label="Send message"
        className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg transition-all duration-200 hover:from-blue-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
      >
        <Send className="w-4 h-4 text-white" />
      </button>
    </div>
  );
}
