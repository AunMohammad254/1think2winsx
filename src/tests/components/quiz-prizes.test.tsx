import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: async () => ({ 'x-csrf-token': 'tok' }) }));

import QuizPrizes from '@/components/profile/QuizPrizes';

const WATCH = { id: 'p1', name: 'Smartwatch', imageUrl: null, type: 'gadget', category: 'electronics' };
const prize = (winnerId: string, claim: Record<string, unknown> | null, over: Record<string, unknown> = {}) => ({
  winnerId, quizId: 'q1', quizTitle: 'Cricket night', rank: 1, wonAt: '2026-10-20', prize: WATCH,
  claim: claim && { id: `c-${winnerId}`, requestedAt: '2026-10-21', processedAt: null, notes: null, ...claim },
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('QuizPrizes', () => {
  it('shows nothing for a player who never won a prize, or when the list fails to load', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ prizes: [] }));
    const { container, unmount } = render(<QuizPrizes />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/quiz-prizes'));
    expect(container).toBeEmptyDOMElement();
    unmount();

    fetchMock.mockResolvedValue(jsonResponse({}));
    render(<QuizPrizes />).unmount();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'no' }, 500));
    render(<QuizPrizes />).unmount();
    fetchMock.mockRejectedValue(new Error('offline'));
    const last = render(<QuizPrizes />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(last.container).toBeEmptyDOMElement();
  });

  it('shows where each delivery stands, offering the form only where details are needed', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      prizes: [
        prize('new', null, { rank: 2 }),
        prize('pending', { status: 'pending' }),
        prize('approved', { status: 'approved' }),
        prize('fulfilled', { status: 'fulfilled' }),
        prize('rejected', { status: 'rejected', notes: 'Wrong address' }),
        prize('rejected-plain', { status: 'rejected' }),
      ],
    }));
    render(<QuizPrizes />);
    const list = await screen.findByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items[0]).toHaveTextContent('2nd place in “Cricket night”');
    expect(items[0]).toHaveTextContent('Send your delivery details so we can get it to you.');
    expect(within(items[0]).getByRole('button', { name: 'Add delivery details' })).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("Details received. We'll contact you on WhatsApp.");
    expect(items[2]).toHaveTextContent('Approved: your prize is on its way soon.');
    expect(items[3]).toHaveTextContent('Delivered.');
    for (const i of [1, 2, 3]) expect(within(items[i]).queryByRole('button')).toBeNull();
    expect(items[4]).toHaveTextContent("We couldn't use those details: Wrong address Please send them again.");
    expect(items[5]).toHaveTextContent("We couldn't use those details. Please send them again.");
    expect(within(items[5]).getByRole('button', { name: 'Send details again' })).toBeInTheDocument();
  });

  it('sends the details, then shows the thanks and the updated list', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ prizes: [prize('w1', null)] }))
      .mockResolvedValueOnce(jsonResponse({ claimId: 'pr_1', message: 'Thanks! We will be in touch.' }, 201))
      .mockResolvedValueOnce(jsonResponse({ prizes: [prize('w1', { status: 'pending' })] }));
    render(<QuizPrizes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add delivery details' }));

    const dialog = screen.getByRole('dialog', { name: 'Delivery details for Smartwatch' });
    fireEvent.change(within(dialog).getByLabelText('Full name'), { target: { value: 'Ali Raza' } });
    fireEvent.change(within(dialog).getByLabelText('WhatsApp number'), { target: { value: '+92 300 1234567' } });
    fireEvent.change(within(dialog).getByLabelText('Delivery address'), { target: { value: 'House 12, Street 4, Lahore' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send details' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Thanks! We will be in touch.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText("Details received. We'll contact you on WhatsApp.")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('/api/quiz-prizes/w1/claim');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'tok' } });
    expect(JSON.parse(init.body)).toEqual({ fullName: 'Ali Raza', whatsappNumber: '+92 300 1234567', address: 'House 12, Street 4, Lahore' });
  });

  it('thanks the player even when the reply carries no message', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ prizes: [prize('w1', null)] }))
      .mockResolvedValueOnce(jsonResponse({}, 201))
      .mockResolvedValueOnce(jsonResponse({ prizes: [prize('w1', { status: 'pending' })] }));
    render(<QuizPrizes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add delivery details' }));
    fireEvent.submit(screen.getByRole('dialog'));
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks! We have your delivery details.');
  });

  it('keeps the form open with the reason when sending fails, and closes on Cancel', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ prizes: [prize('w1', null)] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Enter a valid WhatsApp number' }, 400))
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockRejectedValueOnce(new Error('offline'));
    render(<QuizPrizes />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add delivery details' }));
    const dialog = screen.getByRole('dialog');

    fireEvent.submit(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter a valid WhatsApp number');
    fireEvent.submit(dialog);
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not save your delivery details. Please try again.'));
    fireEvent.submit(dialog);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not save your delivery details. Please try again.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Opening it again starts with an empty form and no error
    fireEvent.click(screen.getByRole('button', { name: 'Add delivery details' }));
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).toBeNull();
    expect(within(screen.getByRole('dialog')).getByLabelText('Full name')).toHaveValue('');
  });
});
