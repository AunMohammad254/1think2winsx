// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, eqValue, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => db.client }));

import { __resetEventModeForTests, isEventMode, liveModeFor, LIVE_MODE, LIVE_MODE_MIN_ENTRIES } from '@/lib/live-mode';

const T0 = Date.parse('2026-11-04T15:00:00Z');
const reads = () => db.calls.filter((c) => c.table === 'AppSettings');

beforeEach(() => {
  db = createSupabaseMock();
  __resetEventModeForTests();
  vi.useFakeTimers({ now: T0, toFake: ['Date'] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('liveModeFor', () => {
  it('is on for a quiz admitting more than 5,000 players, or in event mode, and off otherwise', () => {
    expect(LIVE_MODE_MIN_ENTRIES).toBe(5000);
    expect(liveModeFor(0, false)).toBeUndefined();
    expect(liveModeFor(5000, false)).toBeUndefined();
    expect(liveModeFor(5001, false)).toBe(LIVE_MODE);
    expect(liveModeFor(0, true)).toBe(LIVE_MODE);
    // Each player's personal requests every 30 minutes
    expect(LIVE_MODE).toEqual({ personalPollS: 1800 });
  });
});

describe('isEventMode', () => {
  it("reads AppSettings event_mode, on only for 'true', at most once a minute however many ask", async () => {
    db.setTable('AppSettings', { data: { value: 'true' }, error: null });
    const [a, b] = await Promise.all([isEventMode(), isEventMode()]);
    expect([a, b]).toEqual([true, true]);
    expect(reads()).toHaveLength(1);
    expect(eqValue(reads()[0], 'key')).toBe('event_mode');

    db.setTable('AppSettings', { data: { value: 'false' }, error: null });
    vi.setSystemTime(T0 + 59_000);
    expect(await isEventMode()).toBe(true);
    expect(reads()).toHaveLength(1);
    vi.setSystemTime(T0 + 61_000);
    expect(await isEventMode()).toBe(false);
    expect(reads()).toHaveLength(2);

    // No row: off
    db.setTable('AppSettings', { data: null, error: null });
    vi.setSystemTime(T0 + 122_000);
    expect(await isEventMode()).toBe(false);
  });

  it('keeps the last value when the read fails (off if it never had one), logs it, and tries again a minute later', async () => {
    db.setTable('AppSettings', { data: null, error: new Error('timeout') });
    expect(await isEventMode()).toBe(false);
    expect(console.error).toHaveBeenCalledWith('[LiveMode] Reading event_mode failed:', expect.any(Error));

    db.setTable('AppSettings', { data: { value: 'true' }, error: null });
    vi.setSystemTime(T0 + 61_000);
    expect(await isEventMode()).toBe(true);
    db.setTable('AppSettings', { data: null, error: new Error('timeout') });
    vi.setSystemTime(T0 + 122_000);
    expect(await isEventMode()).toBe(true);
    expect(reads()).toHaveLength(3);
  });
});
