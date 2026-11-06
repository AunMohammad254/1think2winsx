// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defaultDisplayName, reviewInputSchema, toOwnReview, type Review } from '@/lib/reviews';

const listApproved = vi.fn();
const approvedSummary = vi.fn();
vi.mock('@/lib/supabase/db', () => ({ reviewDb: { listApproved: (...a: unknown[]) => listApproved(...a), approvedSummary: () => approvedSummary() } }));

describe('reviewInputSchema', () => {
  const valid = { rating: 4, comment: 'Great quizzes, fast results.', displayName: '  Ali R. ', city: ' Lahore ' };

  it('trims the text and turns an empty city into none', () => {
    expect(reviewInputSchema.parse(valid)).toEqual({ rating: 4, comment: 'Great quizzes, fast results.', displayName: 'Ali R.', city: 'Lahore' });
    expect(reviewInputSchema.parse({ ...valid, city: '   ' }).city).toBeNull();
  });

  it.each([
    [{ rating: 0 }, 'Choose a star rating'],
    [{ rating: 6 }, 'Choose a star rating'],
    [{ comment: 'Too short' }, 'Write at least 10 characters'],
    [{ comment: 'x'.repeat(501) }, 'Keep it under 500 characters'],
    [{ displayName: 'A' }, 'Enter the name to show (at least 2 characters)'],
    [{ displayName: 'x'.repeat(41) }, 'The name can be at most 40 characters'],
    [{ city: 'K' }, 'Enter a city of at least 2 characters, or leave it empty'],
    [{ city: 'x'.repeat(41) }, 'The city can be at most 40 characters'],
  ])('refuses %o', (change, message) => {
    const result = reviewInputSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toBe(message);
  });
});

describe('defaultDisplayName', () => {
  it('shows a first name and a last initial', () => {
    expect(defaultDisplayName('Areeba Khan')).toBe('Areeba K.');
    expect(defaultDisplayName('  muhammad ali raza ')).toBe('muhammad R.');
    expect(defaultDisplayName('Danish')).toBe('Danish');
    expect(defaultDisplayName('')).toBe('');
    expect(defaultDisplayName(null)).toBe('');
    expect(defaultDisplayName(undefined)).toBe('');
    expect(defaultDisplayName(`${'x'.repeat(45)} Khan`)).toHaveLength(40);
  });
});

describe('toOwnReview', () => {
  it('leaves out the user id and who moderated it', () => {
    const row: Review = {
      id: 'r1', userId: 'u1', rating: 3, comment: 'Okay', displayName: 'Ali', city: null, status: 'rejected',
      moderationNote: 'Too short', moderatedAt: '2026-11-06T10:00:00Z', moderatedBy: 'boss@example.test', createdAt: 'c', updatedAt: 'u',
    };
    expect(toOwnReview(row)).toEqual({ id: 'r1', rating: 3, comment: 'Okay', displayName: 'Ali', city: null, status: 'rejected', moderationNote: 'Too short', updatedAt: 'u' });
  });
});

describe('getPublicReviews', () => {
  beforeEach(() => {
    vi.resetModules();
    listApproved.mockReset().mockResolvedValue([{ id: 'r1' }]);
    approvedSummary.mockReset().mockResolvedValue({ count: 1, average: 5 });
  });
  afterEach(() => vi.useRealTimers());

  it('reads the database once a minute, and shares one read between callers', async () => {
    vi.useFakeTimers();
    const { getPublicReviews, PUBLIC_REVIEW_LIMIT, PUBLIC_REVIEWS_TTL_MS } = await import('@/lib/review-service');
    const [a, b] = await Promise.all([getPublicReviews(), getPublicReviews()]);
    expect(a).toEqual({ reviews: [{ id: 'r1' }], summary: { count: 1, average: 5 } });
    expect(b).toBe(a);
    expect(listApproved).toHaveBeenCalledTimes(1);
    expect(listApproved).toHaveBeenCalledWith(PUBLIC_REVIEW_LIMIT);
    await getPublicReviews();
    expect(listApproved).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PUBLIC_REVIEWS_TTL_MS);
    await getPublicReviews();
    expect(listApproved).toHaveBeenCalledTimes(2);
  });

  it('reads again after the cache is emptied, and does not cache a failure', async () => {
    const { getPublicReviews, invalidatePublicReviews } = await import('@/lib/review-service');
    await getPublicReviews();
    invalidatePublicReviews();
    await getPublicReviews();
    expect(listApproved).toHaveBeenCalledTimes(2);

    invalidatePublicReviews();
    approvedSummary.mockRejectedValueOnce(new Error('down'));
    await expect(getPublicReviews()).rejects.toThrow('down');
    expect(await getPublicReviews()).toEqual({ reviews: [{ id: 'r1' }], summary: { count: 1, average: 5 } });
  });
});
