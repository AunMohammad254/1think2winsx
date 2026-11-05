import { Bot } from 'lucide-react';

export function TypingIndicator() {
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
