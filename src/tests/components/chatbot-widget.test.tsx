import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

import ChatbotWidget from '@/components/chatbot/ChatbotWidget';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); // not implemented by jsdom
  router.push.mockReset();
  fetchMock = vi.fn(async () => jsonResponse({ message: 'Here you go', redirects: ['/leaderboard', '/somewhere'], model: 'gemini-2.0' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Open AI support chat' }));
  await screen.findByText(/I'm the 1Think2Win support assistant/);
};
const input = () => screen.getByPlaceholderText('Ask me anything… 🏏');
const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

describe('ChatbotWidget', () => {
  it('greets, answers a quick question and offers navigation chips', async () => {
    const { container } = render(<ChatbotWidget />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '📊 View Leaderboard' }));
    // The suggestions collapse (closing state) before they unmount
    expect(container.querySelector('.chatbot-suggestions')).toHaveAttribute('data-state', 'closed');
    expect(await screen.findByText('Here you go')).toBeInTheDocument();
    expect(screen.getByText('gemini-2.0')).toBeInTheDocument();
    expect(lastBody().messages).toEqual([
      { role: 'model', parts: [{ text: expect.stringContaining('support assistant') }] },
      { role: 'user', parts: [{ text: 'I want to see the leaderboard.' }] },
    ]);
    await waitFor(() => expect(screen.queryByText('Quick questions')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /→ Go to \/somewhere/ }));
    expect(router.push).toHaveBeenCalledWith('/somewhere');
    await waitFor(() => expect(screen.queryByText('Here you go')).toBeNull());
  });

  it('sends typed messages with Enter or the send button, but not Shift+Enter or blanks', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ message: 'ok' }));
    render(<ChatbotWidget />);
    await open();
    fireEvent.change(input(), { target: { value: '   ' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(input(), { target: { value: 'line one' } });
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input(), { key: 'a' });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(await screen.findByText('ok')).toBeInTheDocument();
    expect(input()).toHaveValue('');
    fireEvent.change(input(), { target: { value: ' second ' } });
    fireEvent.click(document.getElementById('chatbot-send-btn')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastBody().messages.at(-1)).toEqual({ role: 'user', parts: [{ text: 'second' }] });
  });

  it('shows a rate-limit notice without a retry button', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ rateLimited: true, error: 'Slow down a little' }, 429));
    render(<ChatbotWidget />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '💳 Payment methods?' }));
    expect(await screen.findByText('Slow down a little')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });

  it('marks failures, retries the last question and leaves failed replies out of the history', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Model overloaded' }, 503))
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(jsonResponse({ message: 'Finally' }));
    render(<ChatbotWidget />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '🎯 Winning chances?' }));
    expect(await screen.findByText('Model overloaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('Model overloaded')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText(/couldn't connect to the AI service/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Finally')).toBeInTheDocument();
    expect(lastBody().messages.every((m: { parts: { text: string }[] }) => !m.parts[0].text.includes('Model overloaded'))).toBe(true);
  });

  it('offers retry only on a failed reply that is still the last message', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Model overloaded' }, 503)).mockResolvedValueOnce(jsonResponse({ message: 'ok' }));
    render(<ChatbotWidget />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '🎯 Winning chances?' }));
    expect(await screen.findByText('Model overloaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'something else' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(await screen.findByText('ok')).toBeInTheDocument();
    // a retry here would have resent "something else", not the question that failed
    expect(screen.getByText('Model overloaded')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });

  it('shows a typing indicator and ignores sends while waiting', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
    const { container } = render(<ChatbotWidget />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '🏏 How do I register?' }));
    await waitFor(() => expect(container.ownerDocument.querySelector('[style*="chatDotBounce"]')).not.toBeNull());
    expect(input()).toBeDisabled();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => release(jsonResponse({ message: 'Register at /register' })));
    expect(await screen.findByText('Register at /register')).toBeInTheDocument();
  });

  it('clears the chat back to the greeting, and closes from the X or the backdrop', async () => {
    render(<ChatbotWidget />);
    await open();
    expect(screen.queryByTitle('Clear chat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '🏆 What prizes can I win?' }));
    await screen.findByText('Here you go');
    fireEvent.click(screen.getByTitle('Clear chat'));
    await waitFor(() => expect(screen.queryByText('Here you go')).toBeNull());
    expect(await screen.findByText('Quick questions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    // The panel slides out (closing state) while the trigger pops straight back in
    expect(document.getElementById('chatbot-panel')).toHaveAttribute('data-state', 'closed');
    expect(document.getElementById('chatbot-trigger-btn')).toHaveAttribute('data-state', 'open');
    await waitFor(() => expect(document.getElementById('chatbot-panel')).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Open AI support chat' }));
    await screen.findByRole('button', { name: 'Close chat' });
    fireEvent.click(document.querySelector('.bg-black\\/50.sm\\:hidden')!); // the mobile backdrop
    await waitFor(() => expect(document.getElementById('chatbot-panel')).toBeNull());
  });

  it('shows the unread badge for a reply that arrives after closing, and for a late error', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
    const { unmount } = render(<ChatbotWidget />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '❓ How does the quiz work?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    await act(async () => release(jsonResponse({ message: 'Late answer' })));
    expect(await screen.findByRole('button', { name: 'Open AI support chat' })).toHaveTextContent('!');
    unmount();

    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
    render(<ChatbotWidget />);
    await open();
    fireEvent.click(screen.getByRole('button', { name: '❓ How does the quiz work?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    await act(async () => release(jsonResponse({ error: 'busy' }, 500)));
    expect(await screen.findByRole('button', { name: 'Open AI support chat' })).toHaveTextContent('!');
  });
});
