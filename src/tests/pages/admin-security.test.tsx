import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  auth: { user: { id: 'admin' } as { id: string } | null, isLoading: false },
  router: { push: vi.fn() },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('next/navigation', () => ({ useRouter: () => h.router }));

import SecurityPage from '@/app/admin/(protected)/security/page';

const stats = {
  totalEvents: 321,
  eventsByType: { RATE_LIMIT_EXCEEDED: 9, AUTHENTICATION_FAILURE: 8, SUSPICIOUS_ACTIVITY: 7, UNAUTHORIZED_ACCESS: 6, DATA_BREACH_ATTEMPT: 5, OTHER_THING: 4 },
  eventsBySeverity: {},
  recentEvents: [],
  topEndpoints: [{ endpoint: '/api/quiz/submit', count: 42 }],
  rateLimitViolations: 11,
  authenticationFailures: 22,
  suspiciousActivities: 33,
};
const event = (id: string, severity: string, type = 'RATE_LIMIT_EXCEEDED') => ({
  id, type, severity, userId: `user-${id}`, endpoint: `/api/${id}`, details: { ip: '1.2.3.4' }, timestamp: '2026-10-01T10:00:00Z',
});
const events = [event('e1', 'CRITICAL'), event('e2', 'HIGH', 'AUTHENTICATION_FAILURE'), event('e3', 'MEDIUM'), event('e4', 'LOW'), event('e5', 'UNKNOWN')];
const alerts = [
  {
    id: 'a1', type: 'FAST_ATTEMPT', severity: 'CRITICAL', title: 'Speed run', description: 'Too fast', timestamp: '2026-10-01T10:00:00Z',
    details: { userName: 'Ali', userEmail: 'ali@x.com', quizTitle: 'Cricket', durationSeconds: 12.345, questionsCount: 10, secondsPerQuestion: 1.2345, score: 100 },
  },
  {
    id: 'a2', type: 'MULTI_ACCOUNT', severity: 'HIGH', title: 'Shared IP', description: 'Many accounts', timestamp: '2026-10-01T10:00:00Z',
    details: { ip: '9.9.9.9', accountsCount: 2, accounts: [{ name: 'Sara', email: 'sara@x.com' }, { email: 'anon@x.com' }] },
  },
  {
    id: 'a3', type: 'BULK_REDEMPTION', severity: 'MEDIUM', title: 'Prize hoarding', description: 'Many claims', timestamp: '2026-10-01T10:00:00Z',
    details: { userName: 'Omar', userEmail: 'omar@x.com', redemptionsCount: 5, redemptions: [{ prizeName: 'Phone', status: 'pending', requestedAt: '2026-10-01T10:00:00Z' }] },
  },
  // Detail fields missing entirely: the optional chains must not crash.
  { id: 'a4', type: 'FAST_ATTEMPT', severity: 'MEDIUM', title: 'Bare fast', description: '-', timestamp: '2026-10-01T10:00:00Z', details: {} },
  { id: 'a5', type: 'MULTI_ACCOUNT', severity: 'MEDIUM', title: 'Bare multi', description: '-', timestamp: '2026-10-01T10:00:00Z', details: {} },
  { id: 'a6', type: 'BULK_REDEMPTION', severity: 'MEDIUM', title: 'Bare bulk', description: '-', timestamp: '2026-10-01T10:00:00Z', details: {} },
];

type Bodies = { stats?: unknown; events?: unknown; alerts?: unknown; status?: number };
const routes = (b: Bodies = {}) =>
  vi.fn(async (url: string) => {
    if (url.includes('/stats')) return jsonResponse(b.stats === undefined ? stats : b.stats, b.status ?? 200);
    if (url.includes('/events')) return jsonResponse(b.events ?? { events }, 200);
    return jsonResponse(b.alerts ?? { alerts }, 200);
  });

let fetchMock: ReturnType<typeof routes>;
beforeEach(() => {
  h.auth = { user: { id: 'admin' }, isLoading: false };
  h.router.push.mockReset();
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const loaded = () => screen.findByText('Security Dashboard');

describe('admin security page', () => {
  it('shows stats, fraud alerts, event breakdowns and recent events', async () => {
    render(<SecurityPage />);
    expect(screen.getByText('Loading security dashboard...')).toBeInTheDocument();
    await loaded();
    for (const n of ['321', '11', '22', '33']) expect(screen.getByText(n)).toBeInTheDocument();
    expect(screen.getByText('6 Active')).toBeInTheDocument();
    expect(screen.getByText('Speed run').closest('.rounded-lg')!.className).toContain('bg-red-50');
    expect(screen.getByText('Shared IP').closest('.rounded-lg')!.className).toContain('bg-orange-50');
    expect(screen.getByText('Prize hoarding').closest('.rounded-lg')!.className).toContain('bg-yellow-50');
    expect(screen.getByText(/12\.3s for 10 questions/)).toBeInTheDocument();
    expect(screen.getByText(/1\.23s per question/)).toBeInTheDocument();
    expect(screen.getByText('Sara (sara@x.com)')).toBeInTheDocument();
    expect(screen.getByText('No Name (anon@x.com)')).toBeInTheDocument();
    expect(screen.getByText(/Phone - pending/)).toBeInTheDocument();
    expect(screen.getByText('OTHER THING')).toBeInTheDocument();
    expect(screen.getByText('/api/quiz/submit')).toBeInTheDocument();

    const row = screen.getByText('user-e1').closest('tr')!;
    expect(within(row).getByText('CRITICAL').className).toContain('text-red-600');
    const colour = (id: string, severity: string) => within(screen.getByText(`user-${id}`).closest('tr')!).getByText(severity).className;
    expect(colour('e2', 'HIGH')).toContain('text-orange-600');
    expect(colour('e3', 'MEDIUM')).toContain('text-yellow-600');
    expect(colour('e4', 'LOW')).toContain('text-blue-600');
    expect(colour('e5', 'UNKNOWN')).toContain('text-gray-600');
    expect(screen.getByText('User: user-e1')).toBeInTheDocument(); // mobile card layout
    expect(screen.queryByText('No security events found for the selected criteria.')).toBeNull();
  });

  it('refetches when the filters change', async () => {
    render(<SecurityPage />);
    await loaded();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '7d' } });
    await loaded();
    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'HIGH' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u.includes('timeframe=7d&severity=HIGH'))).toBe(true));
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/admin/security/stats?timeframe=7d')).toBe(true);
  });

  it('copes with empty responses', async () => {
    vi.stubGlobal('fetch', routes({ stats: null, events: {}, alerts: {} }));
    render(<SecurityPage />);
    await loaded();
    expect(screen.getByText('0 Active')).toBeInTheDocument();
    expect(screen.getByText(/No fraud or suspicious bot activity/)).toBeInTheDocument();
    expect(screen.getByText('No security events found for the selected criteria.')).toBeInTheDocument();
    expect(screen.queryByText('Total Events')).toBeNull();
  });

  it('needs only the admin login: loads for an admin who is not signed in as a player', async () => {
    // The (protected) layout checks the admin session; the page must not ask for a player one
    h.auth = { user: null, isLoading: false };
    render(<SecurityPage />);
    await loaded();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(h.router.push).not.toHaveBeenCalled();
  });

  it('shows load errors', async () => {
    vi.stubGlobal('fetch', routes({ status: 500 }));
    render(<SecurityPage />);
    expect(await screen.findByText('Failed to fetch security data')).toBeInTheDocument();
  });

  it('shows a generic message for non-Error failures', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject('offline')));
    render(<SecurityPage />);
    expect(await screen.findByText('Failed to load security data')).toBeInTheDocument();
  });

  it('clears the error after a successful retry', async () => {
    const healthy = routes();
    vi.stubGlobal('fetch', routes({ status: 500 }));
    render(<SecurityPage />);
    await screen.findByText('Failed to fetch security data');
    vi.stubGlobal('fetch', healthy);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(healthy).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('Security Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch security data')).toBeNull();
  });
});
