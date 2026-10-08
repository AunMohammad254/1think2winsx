// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  withLoadShed,
  isOverloaded,
  getLoadStats,
  __resetLoadShedForTests,
  __setLagForTests,
} from '@/lib/load-shed';
import { createTimeoutFetch } from '@/lib/supabase/timeout-fetch';

const ok = () => new Response('ok', { status: 200 });

beforeEach(() => {
  __resetLoadShedForTests();
});
afterEach(() => {
  __resetLoadShedForTests();
  delete process.env.LOAD_SHED_MAX_INFLIGHT;
  delete process.env.LOAD_SHED_MAX_LAG_MS;
});

describe('withLoadShed', () => {
  it('passes requests through when healthy', async () => {
    const handler = withLoadShed(async () => ok());
    expect((await handler()).status).toBe(200);
    expect(getLoadStats().inflight).toBe(0);
  });

  it('sheds with 503 + a jittered Retry-After once in-flight requests hit the cap', async () => {
    process.env.LOAD_SHED_MAX_INFLIGHT = '2';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const handler = withLoadShed(async () => { await gate; return ok(); });

    const a = handler();
    const b = handler();
    expect(getLoadStats().inflight).toBe(2);

    const shed = await handler();
    expect(shed.status).toBe(503);
    const retryAfter = Number(shed.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(6);
    expect((await shed.json()).code).toBe('OVERLOADED');
    expect(getLoadStats().shedTotal).toBe(1);

    release();
    await Promise.all([a, b]);
    expect(getLoadStats().inflight).toBe(0);
    expect((await handler()).status).toBe(200); // recovers once load drains
  });

  it('sheds while event-loop lag is above the threshold', async () => {
    process.env.LOAD_SHED_MAX_LAG_MS = '500';
    __setLagForTests(1_200);
    expect(isOverloaded()).toBe(true);
    expect((await withLoadShed(async () => ok())()).status).toBe(503);
    __setLagForTests(10);
    expect(isOverloaded()).toBe(false);
  });

  it('can be disabled by setting a limit to 0', async () => {
    process.env.LOAD_SHED_MAX_INFLIGHT = '0';
    process.env.LOAD_SHED_MAX_LAG_MS = '0';
    __setLagForTests(60_000);
    expect(isOverloaded()).toBe(false);
  });

  it('always releases its slot, even when the handler throws', async () => {
    const handler = withLoadShed(async () => { throw new Error('boom'); });
    await expect(handler()).rejects.toThrow('boom');
    expect(getLoadStats().inflight).toBe(0);
  });
});

describe('createTimeoutFetch', () => {
  it('aborts a request that exceeds the budget', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    try {
      await expect(createTimeoutFetch(20)('https://example.test')).rejects.toBeDefined();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('still honours a caller-supplied abort signal', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    try {
      const controller = new AbortController();
      const pending = createTimeoutFetch(60_000)('https://example.test', { signal: controller.signal });
      controller.abort(new Error('cancelled by caller'));
      await expect(pending).rejects.toThrow('cancelled by caller');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('passes a fast response straight through', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('fine')) as typeof fetch;
    try {
      const r = await createTimeoutFetch(1_000)('https://example.test');
      expect(await r.text()).toBe('fine');
    } finally {
      globalThis.fetch = original;
    }
  });
});
