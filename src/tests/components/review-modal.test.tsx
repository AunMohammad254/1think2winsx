import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import type { OwnReview } from '@/lib/reviews';

const h = vi.hoisted(() => ({
  auth: { user: null as null | { id: string; user_metadata?: Record<string, unknown> }, isLoading: false },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: async () => ({ 'x-csrf-token': 'tok' }) }));
vi.mock('sonner', () => ({ toast: h.toast }));

import ReviewModal from '@/components/reviews/ReviewModal';
import { StarDisplay, StarInput } from '@/components/reviews/StarRating';

const own = (over: Partial<OwnReview> = {}): OwnReview => ({
  id: 'r1', rating: 4, comment: 'Great quizzes every week', displayName: 'Areeba K.', city: 'Karachi', status: 'pending', moderationNote: null, updatedAt: '2026-11-06T10:00:00Z', ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
/** Answers GET /api/reviews/mine with `mine`, and POST /api/reviews with `post` */
const serve = (mine: OwnReview | null | 'error', post: () => Promise<Response> = async () => jsonResponse({ review: own(), message: 'ok' }, 201)) => {
  fetchMock = vi.fn((url: string) => {
    if (url === '/api/reviews/mine') return Promise.resolve(mine === 'error' ? jsonResponse({}, 500) : jsonResponse({ review: mine }));
    return post();
  });
  vi.stubGlobal('fetch', fetchMock);
};
const field = (name: RegExp) => screen.getByRole('textbox', { name });
const signIn = (metadata: Record<string, unknown> = { full_name: 'Areeba Khan' }) => {
  h.auth = { user: { id: 'user-1', user_metadata: metadata }, isLoading: false };
};

beforeEach(() => {
  h.auth = { user: null, isLoading: false };
  h.toast.success.mockReset();
  serve(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('ReviewModal', () => {
  it('asks a signed-out visitor to sign in, and closes on the way', () => {
    const onClose = vi.fn();
    render(<ReviewModal open onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Write a review' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    fireEvent.click(screen.getByRole('link', { name: 'Create an account' }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits while the session loads', () => {
    h.auth = { user: null, isLoading: true };
    render(<ReviewModal open onClose={vi.fn()} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('fills the name from the account and sends a new review', async () => {
    signIn();
    const onSubmitted = vi.fn();
    render(<ReviewModal open onClose={vi.fn()} onSubmitted={onSubmitted} />);
    expect(await screen.findByRole('textbox', { name: 'Name to show' })).toHaveValue('Areeba K.');
    expect(screen.getByRole('button', { name: 'Send review' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /5 stars, Excellent/ }));
    fireEvent.change(field(/Your review/), { target: { value: 'Brilliant quizzes!' } });
    expect(screen.getByText('18/500')).toBeInTheDocument();
    fireEvent.change(field(/City/), { target: { value: 'Karachi' } });
    fireEvent.change(field(/Name to show/), { target: { value: 'Areeba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send review' }));

    expect(await screen.findByText(/Our team checks every review/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/reviews');
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-csrf-token': 'tok' });
    expect(JSON.parse(init.body)).toEqual({ rating: 5, comment: 'Brilliant quizzes!', displayName: 'Areeba', city: 'Karachi' });
    expect(h.toast.success).toHaveBeenCalledWith('Thanks for your review!');
    expect(onSubmitted).toHaveBeenCalledWith(own());
  });

  it('checks the form before sending', async () => {
    signIn({ name: 'Ali' });
    render(<ReviewModal open onClose={vi.fn()} />);
    await screen.findByRole('textbox', { name: 'Name to show' });
    fireEvent.click(screen.getByRole('button', { name: 'Send review' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a star rating');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('loads an existing review with its status, and updates it', async () => {
    signIn({});
    serve(own({ status: 'rejected', moderationNote: 'No phone numbers', city: null }));
    render(<ReviewModal open onClose={vi.fn()} />);
    expect(await screen.findByRole('dialog', { name: 'Your review' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your review: Not approved');
    expect(screen.getByRole('status')).toHaveTextContent('Reason: No phone numbers');
    expect(field(/Your review/)).toHaveValue('Great quizzes every week');
    expect(screen.getByRole('radio', { name: /4 stars/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Update my review' }));
    expect(await screen.findByText('Thanks for your review!', { selector: 'p' })).toBeInTheDocument();
  });

  it.each([
    ['pending', 'Waiting for approval'],
    ['approved', 'Approved'],
  ] as const)('explains a %s review', async (status, label) => {
    signIn();
    serve(own({ status, moderationNote: 'ignored' }));
    render(<ReviewModal open onClose={vi.fn()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(`Your review: ${label}`);
    expect(screen.getByRole('status')).not.toHaveTextContent('Reason');
  });

  it('says so when the review cannot be loaded', async () => {
    signIn();
    serve('error');
    render(<ReviewModal open onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load your review");
  });

  it('shows what the server refused, a refusal without a reason, and a lost connection', async () => {
    signIn();
    const answers = [
      async () => jsonResponse({ error: 'Too many reviews' }, 429),
      async () => new Response('oops', { status: 500 }),
      async () => { throw new Error('offline'); },
    ];
    serve(own(), () => answers.shift()!());
    render(<ReviewModal open onClose={vi.fn()} />);
    const send = await screen.findByRole('button', { name: 'Update my review' });
    fireEvent.click(send);
    expect(await screen.findByText('Too many reviews')).toBeInTheDocument();
    fireEvent.click(send);
    expect(await screen.findByText('Could not save your review. Please try again.')).toBeInTheDocument();
    fireEvent.click(send);
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument();
  });

  it('ignores a load that finishes after it closed, and closes from the thank-you screen', async () => {
    signIn();
    let answer!: (r: Response) => void;
    fetchMock = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<ReviewModal open onClose={vi.fn()} />);
    rerender(<ReviewModal open={false} onClose={vi.fn()} />);
    await act(async () => answer(jsonResponse({ review: own() })));
    expect(screen.queryByRole('dialog')).toBeNull();

    // A load failure after closing is ignored too
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('late')));
    rerender(<ReviewModal open onClose={vi.fn()} />);
    rerender(<ReviewModal open={false} onClose={vi.fn()} />);
    await act(async () => {});

    serve(own());
    const onClose = vi.fn();
    rerender(<ReviewModal open onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update my review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('StarRating', () => {
  it('shows a read-only rating', () => {
    render(<StarDisplay rating={3} />);
    expect(screen.getByRole('img', { name: '3 out of 5 stars' })).toBeInTheDocument();
  });

  it('picks a rating by click, hover preview and arrow keys', () => {
    const onChange = vi.fn();
    const { rerender } = render(<StarInput value={0} onChange={onChange} />);
    const star = (n: number) => screen.getByRole('radio', { name: new RegExp(`^${n} star`) });
    expect(star(1)).toHaveAttribute('tabindex', '0');
    fireEvent.mouseEnter(star(3));
    expect(screen.getByText('Good')).toBeInTheDocument();
    fireEvent.mouseLeave(screen.getByRole('radiogroup'));
    expect(screen.queryByText('Good')).toBeNull();

    fireEvent.keyDown(star(1), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(star(1), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(1);

    rerender(<StarInput value={5} onChange={onChange} />);
    expect(star(5)).toHaveAttribute('tabindex', '0');
    expect(star(1)).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(star(5), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.keyDown(star(5), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(star(5), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(4);
    fireEvent.click(star(2));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it('can be disabled', async () => {
    render(<StarInput value={2} onChange={vi.fn()} disabled />);
    await waitFor(() => expect(screen.getAllByRole('radio').every((b) => (b as HTMLButtonElement).disabled)).toBe(true));
  });
});
