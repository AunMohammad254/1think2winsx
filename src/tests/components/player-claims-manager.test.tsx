import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() }, getCSRFToken: vi.fn() }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/csrf', () => ({ getCSRFToken: () => h.getCSRFToken() }));

import PlayerClaimsManager from '@/components/admin/PlayerClaimsManager';

const user = (name: string | null, email: string) => ({ id: email, name, email, phone: '0300', points: 10 }) as never;
const prize = (name: string) => ({ id: name, name, description: '', imageUrl: `/prizes/${name}.svg`, type: 'watch', pointsRequired: 100 });
const claims = [
  { id: 'c1', pointsUsed: 100, status: 'pending', fullName: 'Ali Raza', whatsappNumber: '+92300', address: 'Karachi', requestedAt: '2026-10-01T10:00:00Z', processedAt: null, notes: null, user: user('Ali', 'ali@x.com'), prize: prize('Watch') },
  { id: 'c2', pointsUsed: 200, status: 'approved', fullName: null, whatsappNumber: null, address: null, requestedAt: '2026-10-02T10:00:00Z', processedAt: '2026-10-03T10:00:00Z', notes: 'Shipping soon', user: user(null, 'sara@x.com'), prize: prize('Phone') },
  { id: 'c3', pointsUsed: 50, status: 'fulfilled', fullName: 'Kamran', whatsappNumber: null, address: null, requestedAt: '2026-10-02T10:00:00Z', processedAt: null, notes: null, user: user('Kamran', 'k@x.com'), prize: prize('Cap') },
  { id: 'c4', pointsUsed: 50, status: 'rejected', fullName: null, whatsappNumber: null, address: null, requestedAt: '2026-10-02T10:00:00Z', processedAt: null, notes: null, user: user('Zed', 'z@x.com'), prize: prize('Mug') },
];

let fetchMock: ReturnType<typeof vi.fn>;
const listResponse = (list = claims, pagination = { page: 1, limit: 20, total: list.length, totalPages: 1 }) => jsonResponse({ claims: list, pagination });
let hrefSetter: ReturnType<typeof vi.fn<(v: string) => void>>;
const realLocation = window.location;

beforeEach(() => {
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  h.getCSRFToken.mockReset().mockResolvedValue('tok');
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? jsonResponse({ ok: true }) : listResponse()));
  vi.stubGlobal('fetch', fetchMock);
  hrefSetter = vi.fn();
  // next/image resolves src against location.href while rendering, so keep the reads working
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', pathname: '/admin/claims', search: '', hash: '', get href() { return 'http://localhost/admin/claims'; }, set href(v: string) { hrefSetter(v); } },
  });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  vi.unstubAllGlobals();
});

const listUrl = () => fetchMock.mock.calls.filter(([, i]) => !i).at(-1)![0] as string;

describe('PlayerClaimsManager', () => {
  it('loads pending claims and lists them with their actions', async () => {
    render(<PlayerClaimsManager />);
    expect(await screen.findByText('Watch')).toBeInTheDocument();
    expect(listUrl()).toBe('/api/admin/claims?page=1&limit=20&status=pending');
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Mark Fulfilled' })).toHaveLength(1);
    expect(screen.getByText('?')).toBeInTheDocument(); // no name: placeholder initial
  });

  it('filters by status from the dropdown and the stat tiles, including all', async () => {
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all' } });
    await waitFor(() => expect(listUrl()).toBe('/api/admin/claims?page=1&limit=20'));
    fireEvent.click(screen.getAllByText('Fulfilled')[0].closest('button')!);
    await waitFor(() => expect(listUrl()).toContain('status=fulfilled'));
  });

  it('searches by player, email, prize or delivery name', async () => {
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    const search = screen.getByPlaceholderText('Search by player name, email, or prize...');
    for (const [term, shown] of [['sara@', 'Phone'], ['mug', 'Mug'], ['kamran', 'Cap'], ['ali raza', 'Watch']] as const) {
      fireEvent.change(search, { target: { value: term } });
      expect(screen.getAllByText(shown).length).toBeGreaterThan(0);
    }
    fireEvent.change(search, { target: { value: 'nobody' } });
    expect(screen.getByText('No claims match "nobody".')).toBeInTheDocument();
  });

  it('explains empty lists for a status and for all claims', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }));
    render(<PlayerClaimsManager />);
    expect(await screen.findByText('No pending claims found.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'all' } });
    expect(await screen.findByText('No prize claims have been submitted yet.')).toBeInTheDocument();
  });

  it('pages through results', async () => {
    fetchMock.mockImplementation(async (url: string) => listResponse(claims, { page: url.includes('page=2') ? 2 : 1, limit: 20, total: 45, totalPages: 3 }));
    render(<PlayerClaimsManager />);
    expect(await screen.findByText('Showing 1 to 20 of 45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 21 to 40 of 45')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(listUrl()).toContain('page=1'));
  });

  it('refreshes on demand, and handles expired sessions and failures', async () => {
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Claims refreshed'));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('/admin/login'));
    expect(h.toast.error).toHaveBeenCalledWith('Session expired. Redirecting to login...');
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    fireEvent.click(screen.getByTitle('Refresh'));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Failed to load claims'));
  });

  it('approves, rejects and fulfils claims from the cards', async () => {
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Claim approved!'));
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(put[1].headers['X-CSRF-Token']).toBe('tok');
    expect(JSON.parse(put[1].body)).toEqual({ claimId: 'c1', status: 'approved' });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Claim rejected!'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark Fulfilled' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Claim fulfilled!'));
  });

  it('reports update failures', async () => {
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    const approve = () => fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    h.getCSRFToken.mockResolvedValueOnce(null);
    approve();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Security token expired. Please refresh the page.'));
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Insufficient stock' }, 409));
    approve();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Insufficient stock'));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    approve();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to update claim'));
    fetchMock.mockRejectedValueOnce(new Error('down'));
    approve();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('An error occurred while updating the claim'));
  });

  it('opens claim details, approves with notes and closes', async () => {
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
    expect(screen.getByText('Claim Details')).toBeInTheDocument();
    expect(screen.getAllByText('Karachi').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Note to the player (optional)'), { target: { value: 'Call first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve Claim' }));
    await waitFor(() => expect(screen.queryByText('Claim Details')).toBeNull());
    expect(JSON.parse(fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')![1].body)).toEqual({ claimId: 'c1', status: 'approved', notes: 'Call first' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Reject Claim' }));
    await waitFor(() => expect(screen.queryByText('Claim Details')).toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[1]);
    expect(screen.getAllByText('Shipping soon').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Mark as Fulfilled/ }));
    await waitFor(() => expect(screen.queryByText('Claim Details')).toBeNull());

    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[2]);
    const modal = screen.getByText('Claim Details').closest('.fixed') as HTMLElement;
    fireEvent.click(within(modal).getByText('Claim Details'));
    expect(screen.getByText('Claim Details')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Claim Details').parentElement!.querySelector('button')!);
    expect(screen.queryByText('Claim Details')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[3]);
    fireEvent.click(screen.getByText('Claim Details').closest('.fixed')!);
    expect(screen.queryByText('Claim Details')).toBeNull();
  });

  it('reissues a delivered claim for re-delivery or a re-claim, sending the mode and the reason', async () => {
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    const reissue = async (button: RegExp) => {
      fireEvent.click(screen.getByRole('button', { name: 'Reissue' }));
      fireEvent.change(screen.getByPlaceholderText(/Enter reason for reissue/), { target: { value: 'Courier lost it' } });
      fireEvent.click(screen.getByRole('button', { name: button }));
      await waitFor(() => expect(screen.queryByText('Claim Details')).toBeNull());
      return JSON.parse(fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT').at(-1)![1].body);
    };

    fetchMock.mockImplementationOnce(async () => jsonResponse({ message: 'Claim reissued for re-delivery successfully' }));
    expect(await reissue(/Reissue for Re-Delivery/)).toEqual({ claimId: 'c3', action: 'reissue', reissueMode: 'redelivery', notes: 'Courier lost it' });
    expect(h.toast.success).toHaveBeenLastCalledWith('Claim reissued for re-delivery successfully');

    // A reply without a message (or JSON) still confirms it
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 200 }));
    expect(await reissue(/Reissue & Allow Re-Claim/)).toEqual({ claimId: 'c3', action: 'reissue', reissueMode: 'reclaim', notes: 'Courier lost it' });
    expect(h.toast.success).toHaveBeenLastCalledWith('Claim reissued');
  });

  it('shows the status totals from the API, not counts of the loaded, filtered page', async () => {
    const statusCounts = { pending: 12, approved: 34, fulfilled: 56, rejected: 78 };
    fetchMock.mockImplementation(async () => jsonResponse({ claims: [claims[0]], pagination: { page: 1, limit: 20, total: 12, totalPages: 1 }, statusCounts }));
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    const tile = (label: string) => screen.getAllByText(label)[0].closest('button')!.textContent;
    await waitFor(() => expect(tile('Approved')).toContain('34'));
    expect([tile('Pending Review'), tile('Fulfilled'), tile('Rejected')]).toEqual([expect.stringContaining('12'), expect.stringContaining('56'), expect.stringContaining('78')]);

    // A response without totals (the server could not count) keeps the last known ones
    fetchMock.mockImplementation(async () => listResponse([claims[1]]));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'approved' } });
    await screen.findByText('Phone');
    expect(tile('Approved')).toContain('34');
  });
});
