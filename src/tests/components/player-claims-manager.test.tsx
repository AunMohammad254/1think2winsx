import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// The list's own requests (the details screen also loads a claim's timeline)
const listUrl = () => fetchMock.mock.calls.filter(([url, i]) => !i && String(url).startsWith('/api/admin/claims?')).at(-1)![0] as string;
/** Answers PUTs with `put` from now on, and everything else as usual */
const answerPuts = (put: () => Response) =>
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? put() : listResponse()));
const lastPut = () => JSON.parse(fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT').at(-1)![1].body);

describe('PlayerClaimsManager', () => {
  it('loads pending claims and lists them with their actions', async () => {
    render(<PlayerClaimsManager />);
    expect(await screen.findByText('Watch')).toBeInTheDocument();
    expect(listUrl()).toBe('/api/admin/claims?page=1&limit=20&status=pending');
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Confirm Delivery' })).toHaveLength(1);
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
    const search = screen.getByPlaceholderText('Search by player, email, prize or tracking ID...');
    for (const [term, shown] of [['sara@', 'Phone'], ['mug', 'Mug'], ['kamran', 'Cap'], ['ali raza', 'Watch']] as const) {
      fireEvent.change(search, { target: { value: term } });
      expect(screen.getAllByText(shown).length).toBeGreaterThan(0);
    }
    fireEvent.change(search, { target: { value: 'nobody' } });
    expect(screen.getByText('No claims match "nobody".')).toBeInTheDocument();
  });

  it('looks a full tracking ID up on the server, whatever the status filter', async () => {
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    fireEvent.change(screen.getByPlaceholderText('Search by player, email, prize or tracking ID...'), { target: { value: '1t2w 7k3m qx97' } });
    await waitFor(() => expect(listUrl()).toBe('/api/admin/claims?page=1&limit=20&status=pending&tracking=1T2W-7K3M-QX97'));
    // The server's answer is shown as is, not filtered again by the typed text
    expect(screen.getByText('Watch')).toBeInTheDocument();
  });

  it('keeps the lookup when the list requested before it answers late', async () => {
    let answerFirst!: () => void;
    const first = new Promise<Response>((resolve) => { answerFirst = () => resolve(listResponse()); });
    fetchMock.mockImplementationOnce(() => first);
    render(<PlayerClaimsManager />);
    fetchMock.mockImplementation(async (url: string) => (url.includes('tracking=') ? listResponse([claims[1]]) : listResponse()));
    fireEvent.change(screen.getByPlaceholderText('Search by player, email, prize or tracking ID...'), { target: { value: '1T2W-7K3M-QX97' } });
    expect(await screen.findByText('Phone')).toBeInTheDocument();

    await act(async () => { answerFirst(); await first; });
    expect(screen.getByText('Phone')).toBeInTheDocument();
    expect(screen.queryByText('Watch')).toBeNull();
  });

  it("doesn't report a failure of a list request that a newer one replaced", async () => {
    let failFirst!: () => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { failFirst = () => reject(new Error('offline')); }));
    render(<PlayerClaimsManager />);
    fireEvent.change(screen.getByPlaceholderText('Search by player, email, prize or tracking ID...'), { target: { value: '1T2W-7K3M-QX97' } });
    expect(await screen.findByText('Watch')).toBeInTheDocument();
    await act(async () => { failFirst(); });
    expect(h.toast.error).not.toHaveBeenCalled();
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
    // Delivery needs the winner's handover code, so the card opens the details
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delivery' }));
    fireEvent.change(screen.getByLabelText("Winner's handover code"), { target: { value: '482913' } });
    fireEvent.click(within(screen.getByText('Claim Details').closest('.fixed') as HTMLElement).getByRole('button', { name: 'Confirm Delivery' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Claim delivered!'));
    expect(lastPut()).toEqual({ claimId: 'c2', action: 'deliver', handoverCode: '482913' });
  });

  it('keeps the details open on a wrong handover code, showing the tries used, and resets the code', async () => {
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delivery' }));
    answerPuts(() => jsonResponse({ message: 'Wrong handover code (3 of 5 tries used). Check it with the winner.', code: 'wrong_code', failures: 3 }, 400));
    fireEvent.change(screen.getByLabelText("Winner's handover code"), { target: { value: '111 111' } });
    fireEvent.click(within(screen.getByText('Claim Details').closest('.fixed') as HTMLElement).getByRole('button', { name: 'Confirm Delivery' }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Wrong handover code (3 of 5 tries used). Check it with the winner.'));
    expect(screen.getByText('Claim Details')).toBeInTheDocument();
    expect(screen.getByText(/3 of 5 wrong tries used/)).toBeInTheDocument();

    answerPuts(() => jsonResponse({ message: 'New handover code issued. The winner sees it on their profile.' }));
    fireEvent.click(screen.getByText('Reset the handover code'));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('New handover code issued. The winner sees it on their profile.'));
    expect(lastPut()).toEqual({ claimId: 'c2', action: 'reset_code' });

    // A reply without a message still confirms it
    answerPuts(() => new Response('', { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delivery' }));
    fireEvent.click(screen.getByText('Reset the handover code'));
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('New handover code issued'));
  });

  it('leaves the details closed when a wrong code is answered after they were closed', async () => {
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    let answer!: () => void;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => (init?.method === 'PUT'
      ? new Promise<Response>((resolve) => { answer = () => resolve(jsonResponse({ message: 'Wrong handover code', failures: 1 }, 400)); })
      : Promise.resolve(listResponse())));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delivery' }));
    fireEvent.change(screen.getByLabelText("Winner's handover code"), { target: { value: '111111' } });
    fireEvent.click(within(screen.getByText('Claim Details').closest('.fixed') as HTMLElement).getByRole('button', { name: 'Confirm Delivery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // The request goes out once the CSRF token is in
    await waitFor(() => expect(typeof answer).toBe('function'));
    await act(async () => { answer(); });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Wrong handover code'));
    expect(screen.queryByText('Claim Details')).toBeNull();
  });

  it('approves a high-risk claim from its details with the reason', async () => {
    const risky = { ...claims[0], trackingId: '1T2W-7K3M-QX97', risk: { score: 70, level: 'high', flags: [{ code: 'shared_phone', weight: 40 }] } };
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === 'PUT' ? jsonResponse({ ok: true }) : listResponse([risky])));
    render(<PlayerClaimsManager />);
    await screen.findByText('Watch');
    // The card sends a high-risk approval to the details, which ask why
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByLabelText(/Why approve despite the flags/), { target: { value: 'Brothers in one house, CNICs checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve Claim' }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Claim approved!'));
    expect(lastPut()).toEqual({ claimId: 'c1', status: 'approved', notes: '', overrideReason: 'Brothers in one house, CNICs checked' });
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
    fireEvent.click(screen.getByText('Delivered without the code?'));
    fireEvent.change(screen.getByLabelText(/Why there is no code/), { target: { value: 'Winner lost their phone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark Delivered Without Code' }));
    await waitFor(() => expect(screen.queryByText('Claim Details')).toBeNull());
    expect(lastPut()).toEqual({ claimId: 'c2', action: 'deliver', overrideReason: 'Winner lost their phone' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[2]);
    const modal = screen.getByText('Claim Details').closest('.fixed') as HTMLElement;
    fireEvent.click(within(modal).getByText('Claim Details'));
    expect(screen.getByText('Claim Details')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
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

    answerPuts(() => jsonResponse({ message: 'Claim reissued for re-delivery successfully' }));
    expect(await reissue(/Reissue for Re-Delivery/)).toEqual({ claimId: 'c3', action: 'reissue', reissueMode: 'redelivery', notes: 'Courier lost it' });
    expect(h.toast.success).toHaveBeenLastCalledWith('Claim reissued for re-delivery successfully');

    // A reply without a message (or JSON) still confirms it
    answerPuts(() => new Response('', { status: 200 }));
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
