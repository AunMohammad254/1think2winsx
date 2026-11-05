import { X, Bot, RotateCcw } from 'lucide-react';

export function ChatHeader({
  canClear,
  onClear,
  onClose,
}: {
  /** Show the clear button: there is more than the greeting to clear */
  canClear: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
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
        {canClear && (
          <button
            onClick={onClear}
            title="Clear chat"
            className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-all duration-200"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close chat"
          id="chatbot-close-btn"
          className="p-1.5 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-all duration-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
