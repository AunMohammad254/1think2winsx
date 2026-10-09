// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRetry } from '@/lib/fetch-retry';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fetch that never answers on its own, but rejects when its signal aborts (like the real one). */
function hangingFetch() {
  return vi.fn((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    }),
  );
}

describe('fetchWithRetry timeoutMs', () => {
  it('aborts a hung attempt instead of waiting forever', async () => {
    const f = hangingFetch();
    vi.stubGlobal('fetch', f);
    await expect(fetchWithRetry('/x', undefined, { timeoutMs: 20, retries: 0 })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('gives every attempt its own fresh timer', async () => {
    const signals: AbortSignal[] = [];
    const f = vi.fn(async (_input: unknown, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Response('{}', { status: signals.length === 1 ? 503 : 200 });
    });
    vi.stubGlobal('fetch', f);
    const r = await fetchWithRetry('/x', undefined, { timeoutMs: 5_000, sleep: async () => {} });
    expect(r.status).toBe(200);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it('retries a timed-out attempt by default', async () => {
    let n = 0;
    const f = vi.fn((_input: unknown, init?: RequestInit) => {
      n++;
      if (n === 1) {
        return new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', f);
    const r = await fetchWithRetry('/x', undefined, { timeoutMs: 20, retries: 1, sleep: async () => {} });
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a timeout when retryOnTimeout is false (the request may have been processed)', async () => {
    const f = hangingFetch();
    vi.stubGlobal('fetch', f);
    await expect(
      fetchWithRetry('/x', undefined, { timeoutMs: 20, retries: 3, retryOnTimeout: false, sleep: async () => {} }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('still retries overload statuses when timeouts are not retried', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const r = await fetchWithRetry('/x', undefined, { timeoutMs: 5_000, retryOnTimeout: false, sleep: async () => {} });
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('honours the caller\'s own abort as well as the timeout', async () => {
    const f = hangingFetch();
    vi.stubGlobal('fetch', f);
    const controller = new AbortController();
    const p = fetchWithRetry('/x', { signal: controller.signal }, { timeoutMs: 10_000, retries: 3, sleep: async () => {} });
    controller.abort(new Error('cancelled by caller'));
    await expect(p).rejects.toThrow('cancelled by caller');
    expect(f).toHaveBeenCalledTimes(1);
  });
});
