// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';
import { makeRequest, routeParams } from '@/tests/helpers/supabase-mock';

const guard = vi.fn();
const listQuizActions = vi.fn();
vi.mock('@/lib/admin-api-guard', () => ({ adminApiGuard: (...a: unknown[]) => guard(...a) }));
vi.mock('@/lib/admin-action-log', () => ({ listQuizActions: (...a: unknown[]) => listQuizActions(...a) }));

const route = await import('@/app/api/admin/quizzes/[id]/history/route');
const get = () => route.GET(makeRequest('/api/admin/quizzes/q1/history'), routeParams({ id: 'q1' }));

beforeEach(() => {
  guard.mockReset().mockResolvedValue({ id: 'admin-1', email: 'boss@example.test' });
  listQuizActions.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/admin/quizzes/[id]/history', () => {
  it("returns the quiz's actions to a reading admin", async () => {
    listQuizActions.mockResolvedValue([{ id: 'l1' }]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ actions: [{ id: 'l1' }] });
    expect(listQuizActions).toHaveBeenCalledWith('q1');
    expect(guard).toHaveBeenCalledWith(expect.anything(), '/api/admin/quizzes/[id]/history', { write: false });
  });

  it('passes the guard response through, and answers 500 when reading fails', async () => {
    guard.mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
    expect((await get()).status).toBe(403);
    listQuizActions.mockRejectedValue(new Error('down'));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to load the history' });
  });
});
