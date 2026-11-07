// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminReview } from '@/lib/supabase/db-modules/review.db';

const h = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  reviews: { list: vi.fn(), countByStatus: vi.fn(), findById: vi.fn(), moderate: vi.fn(), remove: vi.fn() },
  notify: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@/lib/admin-session', () => ({ requireAdminSession: () => h.requireAdminSession() }));
vi.mock('@/lib/supabase/db', () => ({ reviewDb: h.reviews, notificationDb: { create: (...a: unknown[]) => h.notify(...a) } }));
vi.mock('@/lib/review-service', () => ({ invalidatePublicReviews: () => h.invalidate() }));

import { deleteReviewAction, listReviewsAction, moderateReviewAction } from '@/actions/review-actions';

const ID = '7f1c2a9e-3b4d-4c5e-8f6a-1b2c3d4e5f60';
const counts = { pending: 2, approved: 5, rejected: 1 };
const review = (overrides: Partial<AdminReview> = {}): AdminReview => ({
  id: ID,
  userId: 'user-1',
  rating: 5,
  comment: 'Brilliant quizzes!',
  displayName: 'Areeba K.',
  city: 'Karachi',
  status: 'pending',
  moderationNote: null,
  moderatedAt: null,
  moderatedBy: null,
  createdAt: '2026-11-06T10:00:00Z',
  updatedAt: '2026-11-06T10:00:00Z',
  user: { name: 'Areeba Khan', email: 'areeba@example.test' },
  ...overrides,
});

beforeEach(() => {
  h.requireAdminSession.mockReset().mockResolvedValue('boss@example.test');
  for (const fn of [...Object.values(h.reviews), h.notify, h.invalidate]) fn.mockReset();
  h.reviews.list.mockResolvedValue({ reviews: [review()], total: 1 });
  h.reviews.countByStatus.mockResolvedValue(counts);
  h.reviews.findById.mockResolvedValue(review());
  h.reviews.moderate.mockImplementation(async (_id: string, changes: Partial<AdminReview>) => review(changes));
  h.reviews.remove.mockResolvedValue(undefined);
  h.notify.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('review actions need an admin session', () => {
  it.each([
    ['listReviewsAction', () => listReviewsAction({})],
    ['moderateReviewAction', () => moderateReviewAction({ id: ID, status: 'approved' })],
    ['deleteReviewAction', () => deleteReviewAction(ID)],
  ])('%s lets the login redirect through and touches nothing', async (_name, call) => {
    h.requireAdminSession.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(call()).rejects.toThrow('NEXT_REDIRECT');
    expect(Object.values(h.reviews).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });
});

describe('listReviewsAction', () => {
  it('returns one page of reviews with the totals per status', async () => {
    expect(await listReviewsAction({ status: 'pending', page: 2 })).toEqual({ success: true, reviews: [review()], total: 1, counts, page: 2, pageSize: 20 });
    expect(h.reviews.list).toHaveBeenCalledWith({ status: 'pending', page: 2, limit: 20 });
    await listReviewsAction({});
    expect(h.reviews.list).toHaveBeenLastCalledWith({ status: undefined, page: 1, limit: 20 });
  });

  it('refuses a bad filter and reports a database failure', async () => {
    expect(await listReviewsAction({ status: 'spam' as never })).toEqual({ success: false, error: 'Invalid filter' });
    h.reviews.list.mockRejectedValue(new Error('down'));
    expect(await listReviewsAction({})).toEqual({ success: false, error: 'Failed to load reviews' });
  });
});

describe('moderateReviewAction', () => {
  it('approves a review, empties the public cache and tells the player', async () => {
    const result = await moderateReviewAction({ id: ID, status: 'approved' });
    expect(result).toEqual({ success: true, review: review({ status: 'approved', moderatedBy: 'boss@example.test' }), notified: true });
    expect(h.reviews.moderate).toHaveBeenCalledWith(ID, { status: 'approved', moderationNote: null, moderatedBy: 'boss@example.test' });
    expect(h.invalidate).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith('user-1', {
      title: 'Your review is live',
      message: 'Thanks for reviewing 1Think 2Win! It now shows on our home page.',
      type: 'review',
      link: '/#reviews',
    });
  });

  it('passes a note on with an approval', async () => {
    await moderateReviewAction({ id: ID, status: 'approved', note: '  Thanks!  ' });
    expect(h.notify.mock.calls[0][1].message).toContain('Our team says: "Thanks!"');
  });

  it('rejects a review with or without a reason', async () => {
    await moderateReviewAction({ id: ID, status: 'rejected', note: 'No phone numbers please' });
    expect(h.reviews.moderate).toHaveBeenCalledWith(ID, { status: 'rejected', moderationNote: 'No phone numbers please', moderatedBy: 'boss@example.test' });
    expect(h.notify.mock.calls[0][1]).toEqual({
      title: 'Your review was not approved',
      message: 'Our team didn\'t publish your review: "No phone numbers please" You can edit it and send it again.',
      type: 'review',
    });
    await moderateReviewAction({ id: ID, status: 'rejected' });
    expect(h.notify.mock.calls[1][1].message).toBe("Our team didn't publish your review. You can edit it and send it again.");
  });

  it('changes nothing when the decision and note are already the same', async () => {
    h.reviews.findById.mockResolvedValue(review({ status: 'rejected', moderationNote: 'Spam' }));
    expect(await moderateReviewAction({ id: ID, status: 'rejected', note: 'Spam' })).toEqual({
      success: true,
      review: review({ status: 'rejected', moderationNote: 'Spam' }),
      notified: false,
    });
    expect(h.reviews.moderate).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it('keeps the decision when the notification fails', async () => {
    h.notify.mockRejectedValue(new Error('push down'));
    expect(await moderateReviewAction({ id: ID, status: 'approved' })).toMatchObject({ success: true, notified: false });
  });

  it('refuses bad input, a missing review and a database failure', async () => {
    expect(await moderateReviewAction({ id: 'nope', status: 'approved' })).toMatchObject({ success: false });
    expect(await moderateReviewAction({ id: ID, status: 'rejected', note: 'x'.repeat(301) })).toEqual({ success: false, error: 'The note can be at most 300 characters' });
    h.reviews.findById.mockResolvedValueOnce(null);
    expect(await moderateReviewAction({ id: ID, status: 'approved' })).toEqual({ success: false, error: 'Review not found' });
    h.reviews.moderate.mockRejectedValue(new Error('down'));
    expect(await moderateReviewAction({ id: ID, status: 'approved' })).toEqual({ success: false, error: 'Failed to update the review' });
  });
});

describe('deleteReviewAction', () => {
  it('deletes the review and empties the public cache', async () => {
    expect(await deleteReviewAction(ID)).toEqual({ success: true });
    expect(h.reviews.remove).toHaveBeenCalledWith(ID);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
  });

  it('refuses a bad id and reports a database failure', async () => {
    expect(await deleteReviewAction('nope')).toEqual({ success: false, error: 'Invalid review' });
    h.reviews.remove.mockRejectedValue(new Error('down'));
    expect(await deleteReviewAction(ID)).toEqual({ success: false, error: 'Failed to delete the review' });
  });
});
