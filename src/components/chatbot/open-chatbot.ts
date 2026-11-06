/**
 * Lets any page open the chat assistant (ChatbotWidget listens for this event), e.g. the contact
 * page's "Ask the assistant" button. Nothing happens if the widget hasn't loaded yet.
 */
export const OPEN_CHATBOT_EVENT = '1t2w:open-chatbot';

export function openChatbot(): void {
  window.dispatchEvent(new Event(OPEN_CHATBOT_EVENT));
}
