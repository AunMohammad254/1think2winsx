import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import { useChatbot } from '@/components/chatbot/useChatbot';

// The conversation behind ChatbotWidget, driven without its markup (the widget test covers the UI)
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ message: 'Answer' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useChatbot', () => {
  it('greets only once the panel opens, and clearing brings the greeting and suggestions back', async () => {
    const { result, rerender } = renderHook(({ open }) => useChatbot(open), { initialProps: { open: false } });
    expect(result.current.messages).toEqual([]);
    rerender({ open: true });
    expect(result.current.messages).toEqual([expect.objectContaining({ id: 'welcome', role: 'assistant' })]);
    expect(result.current.suggestionsShown).toBe(true);

    await act(() => result.current.sendMessage('  Hi  '));
    expect(result.current.messages.map((m) => m.content)).toEqual([expect.stringContaining('support assistant'), 'Hi', 'Answer']);
    expect(result.current.suggestionsShown).toBe(false);

    act(() => result.current.clearChat());
    expect(result.current.messages).toEqual([expect.objectContaining({ id: 'welcome' })]);
    expect(result.current.suggestionsShown).toBe(true);
  });

  it('raises the unread flag for a reply that lands while closed, and clears it on reopening', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (release = r)));
    const { result, rerender } = renderHook(({ open }) => useChatbot(open), { initialProps: { open: true } });
    act(() => void result.current.sendMessage('Question'));
    expect(result.current.isLoading).toBe(true);
    rerender({ open: false });
    await act(async () => release(jsonResponse({ message: 'Late' })));
    expect(result.current.hasUnread).toBe(true);
    expect(result.current.isLoading).toBe(false);
    rerender({ open: true });
    await waitFor(() => expect(result.current.hasUnread).toBe(false));
  });

  it('retries the last question in place of the failed reply', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Model overloaded' }, 503));
    const { result } = renderHook(() => useChatbot(true));
    await act(() => result.current.sendMessage('Question'));
    expect(result.current.messages.at(-1)).toMatchObject({ content: 'Model overloaded', failed: true });
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.messages.at(-1)?.content).toBe('Answer'));
    expect(result.current.messages.some((m) => m.failed)).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages.at(-1)).toEqual({ role: 'user', parts: [{ text: 'Question' }] });
  });
});
