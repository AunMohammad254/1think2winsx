// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { fetchAllByKeyset, mapWithConcurrency } from '@/lib/supabase/db-modules/shared';

// shared.ts pulls in the Next cookies-based server client; it is not exercised here
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

/** In-memory table behind a PostgREST-like paged endpoint (keyset on id, optional hard row cap). */
function fakeTable(total: number, serverMaxRows = Infinity) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: String(i).padStart(6, '0') }));
  const calls: Array<{ after: string | null; limit: number }> = [];
  const fetchPage = async (after: string | null, limit: number) => {
    calls.push({ after, limit });
    const page = rows.filter((r) => after === null || r.id > after).slice(0, Math.min(limit, serverMaxRows));
    return { data: page, error: null };
  };
  return { rows, calls, fetchPage };
}

describe('fetchAllByKeyset', () => {
  it('returns every row, not just the first 1,000 (the PostgREST cap)', async () => {
    const t = fakeTable(2_537);
    const all = await fetchAllByKeyset(t.fetchPage, (r) => r.id);
    expect(all).toHaveLength(2_537);
    expect(new Set(all.map((r) => r.id)).size).toBe(2_537); // no duplicates
    expect(all[0].id).toBe('000000');
    expect(all[all.length - 1].id).toBe('002536');
  });

  it('pages with a keyset cursor, not offsets', async () => {
    const t = fakeTable(2_100);
    await fetchAllByKeyset(t.fetchPage, (r) => r.id);
    expect(t.calls[0].after).toBeNull();
    expect(t.calls[1].after).toBe('000999');
    expect(t.calls[2].after).toBe('001999');
  });

  it('stays correct when the server cap is lower than the requested page size', async () => {
    // A short page must not be mistaken for the last page
    const t = fakeTable(1_250, 500);
    const all = await fetchAllByKeyset(t.fetchPage, (r) => r.id, 1_000);
    expect(all).toHaveLength(1_250);
  });

  it('handles an empty table', async () => {
    const t = fakeTable(0);
    expect(await fetchAllByKeyset(t.fetchPage, (r) => r.id)).toEqual([]);
  });

  it('propagates a page error instead of returning a truncated list', async () => {
    let n = 0;
    const failing = async () => {
      n++;
      return n === 1 ? { data: [{ id: 'a' }], error: null } : { data: null, error: new Error('boom') };
    };
    await expect(fetchAllByKeyset(failing, (r: { id: string }) => r.id, 1)).rejects.toThrow('boom');
  });
});

describe('mapWithConcurrency', () => {
  it('never exceeds the concurrency limit and keeps result order', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 6, 7, 8], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70, 80]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('handles an empty list and a limit larger than the list', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 50, async (x) => x + 1)).toEqual([2, 3]);
  });
});
