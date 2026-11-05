// The widget's keyframes and classes, injected by ChatbotWidget in a <style> tag.
// Kept byte-for-byte as it was inline, hence the deep indentation inside the string.
export const CHATBOT_STYLES = `
        @keyframes chatDotBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40%            { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes chatPulseRing {
          0%   { transform: scale(1);    opacity: 0.6; }
          100% { transform: scale(1.6);  opacity: 0; }
        }
        /* Enter/exit motion; a closing element keeps data-state="closed" until usePresence unmounts it */
        @keyframes chatPopIn      { from { opacity: 0; transform: scale(0); } }
        @keyframes chatPopOut     { to   { opacity: 0; transform: scale(0); } }
        @keyframes chatFadeIn     { from { opacity: 0; } }
        @keyframes chatFadeOut    { to   { opacity: 0; } }
        @keyframes chatSlideUp    { from { opacity: 0; transform: translateY(100%); } }
        @keyframes chatSlideDown  { to   { opacity: 0; transform: translateY(100%); } }
        @keyframes chatExpand     { from { grid-template-rows: 0fr; opacity: 0; } }
        @keyframes chatCollapse   { to   { grid-template-rows: 0fr; opacity: 0; } }
        .chatbot-trigger[data-state="open"]       { animation: chatPopIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
        .chatbot-trigger[data-state="closed"]     { animation: chatPopOut 0.2s ease-in forwards; }
        .chatbot-backdrop[data-state="open"]      { animation: chatFadeIn 0.2s ease-out; }
        .chatbot-backdrop[data-state="closed"]    { animation: chatFadeOut 0.2s ease-out forwards; }
        .chatbot-slide[data-state="open"]         { animation: chatSlideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1); }
        .chatbot-slide[data-state="closed"]       { animation: chatSlideDown 0.3s ease-in forwards; }
        .chatbot-suggestions[data-state="open"]   { animation: chatExpand 0.3s ease-out; }
        .chatbot-suggestions[data-state="closed"] { animation: chatCollapse 0.3s ease-out forwards; }
        .chatbot-trigger[data-state="closed"],
        .chatbot-backdrop[data-state="closed"],
        .chatbot-slide[data-state="closed"],
        .chatbot-suggestions[data-state="closed"] { pointer-events: none; }
        @media (prefers-reduced-motion: reduce) {
          .chatbot-trigger, .chatbot-backdrop, .chatbot-slide, .chatbot-suggestions { animation: none !important; }
          .chatbot-trigger[data-state="closed"],
          .chatbot-backdrop[data-state="closed"],
          .chatbot-slide[data-state="closed"] { visibility: hidden; }
          .chatbot-suggestions[data-state="closed"] { display: none; }
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
          background: rgba(10, 15, 35, 0.95);
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
        /* Mobile bottom-sheet safe area */
        .chatbot-sheet-mobile {
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
      `;
