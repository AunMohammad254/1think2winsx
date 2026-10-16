import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type BroadcastHandler = (message: unknown) => void;

const fake = vi.hoisted(() => {
  const state = {
    handler: null as null | ((message: unknown) => void),
    statusCb: null as null | ((status: string, err?: unknown) => void),
    channelArgs: null as null | unknown[],
    onArgs: null as null | unknown[],
    removed: 0,
    setAuthImpl: (async () => {}) as () => Promise<void>,
    created: 0,
  };
  const channel = {
    on(...args: unknown[]) {
      state.onArgs = args;
      state.handler = args[2] as BroadcastHandler;
      return channel;
    },
    subscribe(cb: (status: string, err?: unknown) => void) {
      state.statusCb = cb;
      return channel;
    },
  };
  const client = {
    realtime: { setAuth: () => state.setAuthImpl() },
    channel: (...args: unknown[]) => {
      state.channelArgs = args;
      return channel;
    },
    removeChannel: () => {
      state.removed++;
    },
  };
  return { state, client };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    fake.state.created++;
    return fake.client;
  },
}));

import { useQuizBroadcast } from '@/hooks/useQuizBroadcast';

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  Object.assign(fake.state, { handler: null, statusCb: null, channelArgs: null, onArgs: null, removed: 0, created: 0, setAuthImpl: async () => {} });
});

describe('useQuizBroadcast', () => {
  it('does nothing while disabled (no client, no socket)', async () => {
    renderHook(() => useQuizBroadcast({ enabled: false, onSignal: vi.fn() }));
    await flush();
    expect(fake.state.created).toBe(0);
    expect(fake.state.channelArgs).toBeNull();
  });

  it('joins the PRIVATE `quizzes` channel after authorising with the signed-in user', async () => {
    renderHook(() => useQuizBroadcast({ enabled: true, onSignal: vi.fn() }));
    await flush();
    expect(fake.state.channelArgs).toEqual(['quizzes', { config: { private: true } }]);
    expect(fake.state.onArgs?.[0]).toBe('broadcast');
    expect(fake.state.onArgs?.[1]).toEqual({ event: 'quiz_changed' });
  });

  it('delivers parsed signals and silently ignores malformed ones', async () => {
    const onSignal = vi.fn();
    renderHook(() => useQuizBroadcast({ enabled: true, onSignal }));
    await flush();
    fake.state.handler!({ payload: { op: 'UPDATE', id: 'q1', title: 'T', status: 'active', pushedAt: null } });
    fake.state.handler!({ payload: { op: 'NOPE' } });
    fake.state.handler!(null);
    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith({ op: 'UPDATE', id: 'q1', title: 'T', status: 'active', pushedAt: null });
  });

  it('always calls the latest callback without re-subscribing', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useQuizBroadcast({ enabled: true, onSignal: cb }), { initialProps: { cb: first } });
    await flush();
    const created = fake.state.created;
    rerender({ cb: second });
    await flush();
    fake.state.handler!({ payload: { op: 'INSERT', id: 'q2' } });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(fake.state.created).toBe(created);
  });

  it('removes the channel on unmount', async () => {
    const { unmount } = renderHook(() => useQuizBroadcast({ enabled: true, onSignal: vi.fn() }));
    await flush();
    unmount();
    expect(fake.state.removed).toBe(1);
  });

  it('does not open a channel if it unmounts before authorisation finishes', async () => {
    let release: () => void = () => {};
    fake.state.setAuthImpl = () => new Promise<void>((r) => { release = r; });
    const { unmount } = renderHook(() => useQuizBroadcast({ enabled: true, onSignal: vi.fn() }));
    unmount();
    release();
    await flush();
    expect(fake.state.channelArgs).toBeNull();
    expect(fake.state.removed).toBe(0);
  });

  it('survives an authorisation failure (the page poll covers it)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.state.setAuthImpl = async () => { throw new Error('no session'); };
    renderHook(() => useQuizBroadcast({ enabled: true, onSignal: vi.fn() }));
    await flush();
    expect(fake.state.channelArgs).toBeNull();
    err.mockRestore();
  });

  it('reports channel errors without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHook(() => useQuizBroadcast({ enabled: true, onSignal: vi.fn() }));
    await flush();
    expect(() => fake.state.statusCb!('CHANNEL_ERROR', new Error('Unauthorized'))).not.toThrow();
    expect(warn).toHaveBeenCalled();
    fake.state.statusCb!('TIMED_OUT');
    expect(warn).toHaveBeenLastCalledWith('[useQuizBroadcast] channel TIMED_OUT', '');
    warn.mockClear();
    fake.state.statusCb!('SUBSCRIBED'); // normal statuses are not logged
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
