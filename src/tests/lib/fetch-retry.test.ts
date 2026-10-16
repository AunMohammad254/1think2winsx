// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRetry } from '@/lib/fetch-retry';

const res = (status: number, headers: Record<string, string> = {}) => new Response('{}', { status, headers });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithRetry', () => {
  it('returns immediately on success without sleeping', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn();
    const r = await fetchWithRetry('/x', undefined, { sleep });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries overload responses and then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(502))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = await fetchWithRetry('/x', undefined, { sleep, random: () => 1 });
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('waits at least Retry-After when the server sends it, and jitters otherwise', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res(503, { 'Retry-After': '4' })).mockResolvedValueOnce(res(200)));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await fetchWithRetry('/x', undefined, { sleep, random: () => 0, baseDelayMs: 800 });
    expect(sleep).toHaveBeenCalledWith(4_000); // floor from Retry-After even with zero jitter
  });

  it('jitter spreads the wait between 0 and the exponential step', async () => {
    const waits: number[] = [];
    for (const rnd of [0, 0.5, 0.999]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200)));
      const sleep = vi.fn().mockResolvedValue(undefined);
      await fetchWithRetry('/x', undefined, { sleep, random: () => rnd, baseDelayMs: 1_000 });
      waits.push(sleep.mock.calls[0][0]);
    }
    expect(waits[0]).toBe(0);
    expect(waits[1]).toBe(500);
    expect(waits[2]).toBeGreaterThan(900);
    expect(waits[2]).toBeLessThanOrEqual(1_000);
  });

  it('gives up after the retry budget and returns the last response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(503));
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchWithRetry('/x', undefined, { retries: 2, sleep: async () => {} });
    expect(r.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 try + 2 retries
  });

  it('does not retry statuses outside retryOn (e.g. a real 429 limit on submit)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(429));
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchWithRetry('/x', undefined, { retryOn: [502, 503, 504], sleep: async () => {} });
    expect(r.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry client errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(400));
    vi.stubGlobal('fetch', fetchMock);
    await fetchWithRetry('/x', undefined, { sleep: async () => {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries network errors and rethrows once the budget is spent', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('/x', undefined, { retries: 2, sleep: async () => {} })).rejects.toThrow('network down');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry when the caller aborted the request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithRetry('/x', { signal: controller.signal }, { sleep: async () => {} })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
