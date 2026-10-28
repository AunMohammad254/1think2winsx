// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { makeRequest, routeParams } from '@/tests/helpers/supabase-mock';

const guard = vi.fn();
const adminTimeline = vi.fn();
vi.mock('@/lib/admin-api-guard', () => ({ adminApiGuard: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/claim-tracking', () => ({ adminTimeline: (...a: unknown[]) => adminTimeline(...a) }));

const route = await import('@/app/api/admin/claims/[id]/timeline/route');
const get = () => route.GET(makeRequest('/api/admin/claims/pr_1/timeline'), routeParams({ id: 'pr_1' }));

beforeEach(() => {
  guard.mockReset().mockResolvedValue({ id: 'admin-1', email: 'boss@example.test' });
  adminTimeline.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/admin/claims/[id]/timeline', () => {
  it("returns the claim's timeline to a reading admin", async () => {
    adminTimeline.mockResolvedValue([{ id: 'e1', event: 'submitted' }]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [{ id: 'e1', event: 'submitted' }] });
    expect(adminTimeline).toHaveBeenCalledWith('pr_1');
    expect(guard).toHaveBeenCalledWith(expect.anything(), '/api/admin/claims/[id]/timeline', { write: false });
  });

  it('passes the guard response through, and answers 500 when reading fails', async () => {
    guard.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await get()).status).toBe(403);
    expect(adminTimeline).not.toHaveBeenCalled();
    adminTimeline.mockRejectedValue(new Error('down'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load the timeline' });
  });
});
