import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AdminReview } from '@/lib/supabase/db-modules/review.db';

const h = vi.hoisted(() => ({
  list: vi.fn(),
  moderate: vi.fn(),
  remove: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/actions/review-actions', () => ({
  listReviewsAction: (...a: unknown[]) => h.list(...a),
  moderateReviewAction: (...a: unknown[]) => h.moderate(...a),
  deleteReviewAction: (...a: unknown[]) => h.remove(...a),
}));
vi.mock('sonner', () => ({ toast: h.toast }));

import ReviewsManager from '@/components/admin/ReviewsManager';

const review = (overrides: Partial<AdminReview> = {}): AdminReview => ({
  id: 'r1',
  userId: 'user-1',
  rating: 4,
  comment: 'Great quizzes,\nfast results',
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
const counts = { pending: 2, approved: 5, rejected: 1 };
const page = (reviews: AdminReview[], extra: Record<string, unknown> = {}) => ({ success: true, reviews, total: reviews.length, counts, page: 1, pageSize: 20, ...extra });
const click = (name: string | RegExp, scope?: HTMLElement) => fireEvent.click((scope ? within(scope) : screen).getByRole('button', { name }));
const item = (text: string) => screen.getByText(text).closest('li') as HTMLElement;

beforeEach(() => {
  for (const fn of [h.list, h.moderate, h.remove, h.toast.success, h.toast.error]) fn.mockReset();
  h.list.mockResolvedValue(page([
    review(),
    review({ id: 'r2', displayName: 'Ali R.', city: null, status: 'approved', comment: 'Love it', user: null, moderatedBy: 'boss@example.test', moderatedAt: '2026-11-06T11:00:00Z' }),
    review({ id: 'r3', displayName: 'Sana', status: 'rejected', comment: 'Call me', moderationNote: 'No phone numbers', user: { name: null, email: 's@example.test' } }),
  ]));
  h.moderate.mockResolvedValue({ success: true, review: review(), notified: true });
  h.remove.mockResolvedValue({ success: true });
});

describe('ReviewsManager', () => {
  it('lists pending reviews first, with totals per status and who wrote each', async () => {
    render(<ReviewsManager />);
    expect(screen.getByText('Loading reviews…')).toBeInTheDocument();
    expect(await screen.findByText('Areeba K.')).toBeInTheDocument();
    expect(h.list).toHaveBeenCalledWith({ status: 'pending', page: 1 });
    expect(screen.getByRole('button', { name: 'Pending 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Account: Areeba Khan · areeba@example.test')).toBeInTheDocument();
    expect(screen.getByText('Player account deleted')).toBeInTheDocument();
    expect(screen.getByText('Account: No name · s@example.test')).toBeInTheDocument();
    expect(screen.getByText('Note to the player: No phone numbers')).toBeInTheDocument();
    expect(screen.getByText(/Last decision by boss@example.test/)).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: '4 out of 5 stars' })).toHaveLength(3);
    // Approved reviews can be unpublished, rejected ones approved again
    expect(within(item('Love it')).queryByRole('button', { name: /Approve/ })).toBeNull();
    expect(within(item('Love it')).getByRole('button', { name: /Unpublish/ })).toBeInTheDocument();
    expect(within(item('Call me')).queryByRole('button', { name: /Reject/ })).toBeNull();
  });

  it('switches status and refreshes', async () => {
    render(<ReviewsManager />);
    await screen.findByText('Areeba K.');
    click('All');
    await waitFor(() => expect(h.list).toHaveBeenLastCalledWith({ status: undefined, page: 1 }));
    click('Approved 5');
    await waitFor(() => expect(h.list).toHaveBeenLastCalledWith({ status: 'approved', page: 1 }));
    click('Refresh');
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(4));
  });

  it('approves a review and reloads the list', async () => {
    render(<ReviewsManager />);
    await screen.findByText('Areeba K.');
    click(/Approve/, item('Areeba K.'));
    await waitFor(() => expect(h.moderate).toHaveBeenCalledWith({ id: 'r1', status: 'approved', note: '' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Review approved: it now shows on the home page. The player has been notified.'));
    expect(h.list).toHaveBeenCalledTimes(2);
  });

  it('rejects with a note, or cancels', async () => {
    h.moderate.mockResolvedValue({ success: true, review: review(), notified: false });
    render(<ReviewsManager />);
    await screen.findByText('Areeba K.');
    const card = item('Love it');
    click(/Unpublish/, card);
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'Off-topic' } });
    expect(within(card).getByText('9/300')).toBeInTheDocument();
    click('Cancel', card);
    expect(within(card).queryByRole('textbox')).toBeNull();

    click(/Unpublish/, card);
    click(/Reject review/, card);
    await waitFor(() => expect(h.moderate).toHaveBeenCalledWith({ id: 'r2', status: 'rejected', note: 'Off-topic' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Review rejected.'));
  });

  it('shows a refused or failed decision', async () => {
    h.moderate.mockResolvedValueOnce({ success: false, error: 'Review not found' }).mockRejectedValueOnce(new Error('network'));
    render(<ReviewsManager />);
    await screen.findByText('Areeba K.');
    const card = screen.getByText('Areeba K.').closest('li') as HTMLElement;
    click(/Approve/, card);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Review not found'));
    click(/Approve/, card);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to update the review'));
    expect(h.list).toHaveBeenCalledTimes(1);
  });

  it('deletes only on a second click, and a blur cancels', async () => {
    render(<ReviewsManager />);
    await screen.findByText('Areeba K.');
    const card = screen.getByText('Areeba K.').closest('li') as HTMLElement;
    click('Delete', card);
    expect(within(card).getByRole('button', { name: 'Click again to delete' })).toBeInTheDocument();
    fireEvent.blur(within(card).getByRole('button', { name: 'Click again to delete' }));
    click('Delete', card);
    click('Click again to delete', card);
    await waitFor(() => expect(h.remove).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Review deleted'));
  });

  it('shows a failed delete', async () => {
    h.remove.mockResolvedValueOnce({ success: false, error: 'Failed to delete the review' }).mockRejectedValueOnce(new Error('network'));
    render(<ReviewsManager />);
    await screen.findByText('Areeba K.');
    const card = screen.getByText('Areeba K.').closest('li') as HTMLElement;
    click('Delete', card);
    click('Click again to delete', card);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
    click('Click again to delete', card);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(2));
    expect(h.toast.error).toHaveBeenLastCalledWith('Failed to delete the review');
  });

  it('shows an empty list, a load error with a retry, and a thrown load', async () => {
    h.list.mockResolvedValueOnce(page([])).mockResolvedValueOnce({ success: false, error: 'Failed to load reviews' }).mockRejectedValueOnce(new Error('x'));
    render(<ReviewsManager />);
    expect(await screen.findByText('No reviews here.')).toBeInTheDocument();
    click('Refresh');
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load reviews');
    click('Try again');
    await waitFor(() => expect(h.list).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load reviews');
  });

  it('pages through long lists', async () => {
    h.list.mockResolvedValue(page([review()], { total: 45 }));
    render(<ReviewsManager />);
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    click('Next');
    await waitFor(() => expect(h.list).toHaveBeenLastCalledWith({ status: 'pending', page: 2 }));
    click('Previous');
    await waitFor(() => expect(h.list).toHaveBeenLastCalledWith({ status: 'pending', page: 1 }));
  });
});
