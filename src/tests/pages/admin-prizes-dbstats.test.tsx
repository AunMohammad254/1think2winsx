import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';
import { CLOUDINARY_CLOUD_NAME } from '@/lib/cloudinary';

const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  actions: { getAllPrizesAdmin: vi.fn(), createPrize: vi.fn(), updatePrize: vi.fn(), deletePrize: vi.fn(), togglePrizeStatus: vi.fn(), togglePrizeActive: vi.fn() },
  auth: { user: { id: 'u1', email: 'boss@x.com' } as Record<string, unknown> | null, isLoading: false },
  router: { push: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/actions/prizes', () => ({
  getAllPrizesAdmin: (...a: unknown[]) => h.actions.getAllPrizesAdmin(...a),
  createPrize: (...a: unknown[]) => h.actions.createPrize(...a),
  updatePrize: (...a: unknown[]) => h.actions.updatePrize(...a),
  deletePrize: (...a: unknown[]) => h.actions.deletePrize(...a),
  togglePrizeStatus: (...a: unknown[]) => h.actions.togglePrizeStatus(...a),
  togglePrizeActive: (...a: unknown[]) => h.actions.togglePrizeActive(...a),
}));
// eslint-disable-next-line @next/next/no-img-element -- stand-in for CldImage
vi.mock('next-cloudinary', () => ({ CldImage: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => h.router, usePathname: () => '/admin', useSearchParams: () => new URLSearchParams() }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  ...(await import('@/tests/helpers/motion-mock')).motionPassthrough,
}));

import AdminPrizesPage from '@/app/admin/(protected)/prizes/page';
import DatabaseStatsPage from '@/app/admin/(protected)/db-stats/page';

const prize = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Prize ${id}`, description: 'd', imageUrl: `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${id}.png`, modelUrl: null, type: 'phone',
  pointsRequired: 100, isActive: true, category: 'electronics', stock: 3, status: 'published', value: 0, createdAt: new Date(), updatedAt: new Date(), ...over,
});

beforeEach(() => {
  h.toast.success.mockReset();
  h.toast.error.mockReset();
  for (const f of Object.values(h.actions)) f.mockReset();
  h.actions.getAllPrizesAdmin.mockResolvedValue({ success: true, data: [prize('a'), prize('b', { status: 'draft', stock: 0 })] });
  h.actions.createPrize.mockResolvedValue({ success: true });
  h.actions.updatePrize.mockResolvedValue({ success: true });
  h.actions.deletePrize.mockResolvedValue({ success: true });
  h.actions.togglePrizeStatus.mockResolvedValue({ success: true, data: { status: 'published' } });
  h.actions.togglePrizeActive.mockResolvedValue({ success: true, data: { isActive: false } });
  h.auth = { user: { id: 'u1', email: 'boss@x.com' }, isLoading: false };
  h.router.push.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const loaded = async () => (await screen.findAllByText('Prize a'))[0];
const row = (name: string) => screen.getAllByText(name)[0].closest('tr') as HTMLElement;

describe('admin prizes page', () => {
  it('loads prizes with stats and refilters', async () => {
    render(<AdminPrizesPage />);
    await loaded();
    const stat = (label: string) => screen.getByText(label).nextElementSibling!.textContent;
    expect(stat('Total Prizes')).toBe('2');
    expect(stat('Drafts')).toBe('1');
    expect(stat('Out of Stock')).toBe('1');
    expect(h.actions.getAllPrizesAdmin).toHaveBeenCalledWith({ category: undefined, status: undefined, search: undefined });
    const [category, status] = screen.getAllByRole('combobox');
    fireEvent.change(category, { target: { value: 'vehicles' } });
    fireEvent.change(status, { target: { value: 'draft' } });
    fireEvent.change(screen.getByPlaceholderText('Search prizes...'), { target: { value: 'bike' } });
    await waitFor(() => expect(h.actions.getAllPrizesAdmin).toHaveBeenLastCalledWith({ category: 'vehicles', status: 'draft', search: 'bike' }));
  });

  it('reports load failures', async () => {
    h.actions.getAllPrizesAdmin.mockResolvedValueOnce({ success: false, error: 'Not admin' }).mockResolvedValueOnce({ success: false }).mockRejectedValueOnce(new Error('x'));
    render(<AdminPrizesPage />);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith('Not admin'));
    fireEvent.change(screen.getByPlaceholderText('Search prizes...'), { target: { value: 'a' } });
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to load prizes'));
    fireEvent.change(screen.getByPlaceholderText('Search prizes...'), { target: { value: 'ab' } });
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(3));
  });

  it('creates a prize, and reports create failures', async () => {
    h.actions.createPrize.mockResolvedValueOnce({ success: false, error: 'Duplicate name' }).mockResolvedValueOnce({ success: false }).mockRejectedValueOnce(new Error('x'));
    render(<AdminPrizesPage />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /Add New Prize/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g., iPhone 15 Pro'), { target: { value: 'Smart Watch' } });
    const save = () => fireEvent.click(screen.getByRole('button', { name: /Create Prize|Saving/ }));
    save();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Duplicate name'));
    save();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to create prize'));
    save();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('An error occurred'));
    save();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Prize created successfully!'));
    expect(h.actions.createPrize).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Smart Watch' }));
    expect(screen.queryByText('Create New Prize')).toBeNull();
  });

  it('edits a prize, and reports update failures', async () => {
    h.actions.updatePrize.mockResolvedValueOnce({ success: false, error: 'Stale' }).mockResolvedValueOnce({ success: false });
    render(<AdminPrizesPage />);
    await loaded();
    fireEvent.click(within(row('Prize a')).getByTitle('Edit'));
    expect(screen.getByText('Edit Prize')).toBeInTheDocument();
    const save = () => fireEvent.click(screen.getByRole('button', { name: /Update Prize/ }));
    save();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Stale'));
    save();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to update prize'));
    save();
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith('Prize updated successfully!'));
    expect(h.actions.updatePrize).toHaveBeenLastCalledWith('a', expect.objectContaining({ name: 'Prize a' }));
    fireEvent.click(within(row('Prize b')).getByTitle('Edit'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Edit Prize')).toBeNull();
  });

  it('deletes after confirmation, and toggles status and visibility', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValueOnce(false).mockReturnValue(true));
    h.actions.deletePrize.mockResolvedValueOnce({ success: false, error: 'Has claims' }).mockResolvedValueOnce({ success: false });
    h.actions.togglePrizeStatus.mockResolvedValueOnce({ success: true, data: { status: 'draft' } }).mockResolvedValueOnce({ success: false, error: 'No' }).mockResolvedValueOnce({ success: false });
    h.actions.togglePrizeActive.mockResolvedValueOnce({ success: true, data: { isActive: true } }).mockResolvedValueOnce({ success: false, error: 'Nope' }).mockResolvedValueOnce({ success: false });
    render(<AdminPrizesPage />);
    await loaded();
    const del = () => fireEvent.click(within(row('Prize a')).getByTitle('Delete'));
    del();
    expect(h.actions.deletePrize).not.toHaveBeenCalled();
    del();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Has claims'));
    del();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to delete prize'));
    del();
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('Prize deleted successfully!'));

    const status = () => fireEvent.click(within(row('Prize a')).getByRole('button', { name: 'published' }));
    status();
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('Prize set to draft!'));
    status();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('No'));
    status();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to update status'));
    status();
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('Prize published!'));

    const active = () => fireEvent.click(within(row('Prize a')).getAllByRole('button')[1]);
    active();
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('Prize activated!'));
    active();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Nope'));
    active();
    await waitFor(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to update active state'));
    active();
    await waitFor(() => expect(h.toast.success).toHaveBeenLastCalledWith('Prize deactivated!'));
  });
});

describe('admin database stats page', () => {
  const stats = {
    overview: { totalUsers: 1200, totalQuizzes: 9, totalQuestions: 90, totalAttempts: 500, totalPayments: 300, totalWinnings: 12, averageScore: 71.456, completionRate: 88 },
    recentActivity: { newUsers: 40, newAttempts: 120, newPayments: 60, newWinnings: 3 },
    topQuizzes: [{ id: 'z1', title: 'Cricket Cup', attemptCount: 250 }],
    prizeDistribution: [{ prizeId: 'p1', prizeName: 'Bike', prizeType: 'vehicle', count: 1 }],
  };

  it('shows the overview, activity, top quizzes and prizes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(stats)));
    render(<DatabaseStatsPage />);
    expect(screen.getByText('Loading database statistics...')).toBeInTheDocument();
    expect(await screen.findByText('1200')).toBeInTheDocument();
    expect(screen.getByText('71.46%')).toBeInTheDocument();
    expect(screen.getByText('Cricket Cup')).toBeInTheDocument();
    expect(screen.getByText('Type: vehicle')).toBeInTheDocument();
    expect(screen.getByText(/Logged in as: boss@x.com/)).toBeInTheDocument();
  });

  it('shows empty lists and a missing email', async () => {
    h.auth = { user: { id: 'u1' }, isLoading: false };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...stats, topQuizzes: [], prizeDistribution: [] })));
    render(<DatabaseStatsPage />);
    expect(await screen.findByText('No quiz data available')).toBeInTheDocument();
    expect(screen.getByText('No prize data available')).toBeInTheDocument();
    expect(screen.queryByText(/Logged in as/)).toBeNull();
  });

  it('reports access and load errors, and an empty response', async () => {
    const cases: [() => Response | Promise<Response>, string][] = [
      [() => jsonResponse({}, 403), 'Access denied. Admin privileges required.'],
      [() => jsonResponse({}, 500), 'Failed to fetch database statistics'],
      [() => { throw 'odd'; }, 'An error occurred'],
      [() => jsonResponse(null), 'No statistics available'],
    ];
    for (const [response, message] of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => response()));
      const { unmount } = render(<DatabaseStatsPage />);
      expect(await screen.findByText(message)).toBeInTheDocument();
      unmount();
    }
  });

  it('KNOWN BUG: also requires a player session, sending admins without one to /login', () => {
    h.auth = { user: null, isLoading: true };
    const { rerender } = render(<DatabaseStatsPage />);
    expect(h.router.push).not.toHaveBeenCalled();
    h.auth = { user: null, isLoading: false };
    rerender(<DatabaseStatsPage />);
    expect(h.router.push).toHaveBeenCalledWith('/login');
  });
});
