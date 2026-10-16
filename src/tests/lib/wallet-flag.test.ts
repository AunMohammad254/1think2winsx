// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fake AppSettings table behind a chainable Supabase-like client
const store = { value: 'true' as string | null, failReads: false };
const calls = { selects: 0, upserts: 0 };

function fakeAdminDb() {
  return {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            calls.selects++;
            if (store.failReads) return { data: null, error: new Error('db down') };
            return { data: store.value === null ? null : { value: store.value }, error: null };
          },
        }),
      }),
      upsert: async (row: { value: string }) => {
        calls.upserts++;
        store.value = row.value;
        return { error: null };
      },
    }),
  };
}

vi.mock('@/lib/supabase/db', () => ({
  getAdminDb: () => fakeAdminDb(),
  userDb: {},
  quizDb: {},
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { isWalletEnabled, __resetWalletFlagStateForTests } from '@/lib/wallet/service';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  __resetWalletFlagStateForTests();
  store.value = 'true';
  store.failReads = false;
  calls.selects = 0;
  calls.upserts = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.WALLET_FEATURE_ENABLED;
});

describe('isWalletEnabled with WALLET_FEATURE_ENABLED set (the old per-request write storm)', () => {
  it('does at most one read and one write no matter how many requests arrive', async () => {
    process.env.WALLET_FEATURE_ENABLED = 'false';
    for (let i = 0; i < 5_000; i++) expect(await isWalletEnabled()).toBe(false);
    await flush();
    expect(calls.selects).toBe(1);
    expect(calls.upserts).toBe(1); // DB said 'true', env says 'false' -> mirrored once
    expect(store.value).toBe('false');
  });

  it('writes nothing when the database already matches the env value', async () => {
    process.env.WALLET_FEATURE_ENABLED = 'false';
    store.value = 'false';
    for (let i = 0; i < 100; i++) await isWalletEnabled();
    await flush();
    expect(calls.upserts).toBe(0);
  });

  it('re-checks once a minute, so an admin toggle cannot drift away from the env value', async () => {
    process.env.WALLET_FEATURE_ENABLED = 'false';
    store.value = 'false';
    await isWalletEnabled();
    await flush();
    store.value = 'true'; // someone flips it in the admin UI
    await isWalletEnabled();
    await flush();
    expect(store.value).toBe('true'); // still inside the 60 s window: untouched
    vi.setSystemTime(Date.now() + 61_000);
    await isWalletEnabled();
    await flush();
    expect(store.value).toBe('false'); // next window mirrors the env value again
    expect(calls.upserts).toBe(1);
  });
});

describe('isWalletEnabled reading the database flag', () => {
  it('shares one query between concurrent callers (single-flight) and caches it', async () => {
    store.value = 'false';
    const results = await Promise.all(Array.from({ length: 200 }, () => isWalletEnabled()));
    expect(results.every((r) => r === false)).toBe(true);
    expect(calls.selects).toBe(1);
    await isWalletEnabled();
    expect(calls.selects).toBe(1); // served from the 60 s cache
  });

  it('defaults to enabled when the row is missing', async () => {
    store.value = null;
    expect(await isWalletEnabled()).toBe(true);
  });

  it('keeps the last known value on a database error instead of flipping to enabled', async () => {
    store.value = 'false';
    expect(await isWalletEnabled()).toBe(false);
    vi.setSystemTime(Date.now() + 61_000); // cache expired
    store.failReads = true;
    expect(await isWalletEnabled()).toBe(false); // used to silently become true
  });

  it('only defaults to enabled on error when it has never read the flag', async () => {
    store.failReads = true;
    expect(await isWalletEnabled()).toBe(true);
  });
});
