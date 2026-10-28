import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ requireAdminSession: vi.fn() }));
vi.mock('@/lib/admin-session', () => ({ requireAdminSession: () => h.requireAdminSession() }));
vi.mock('@/components/admin/matches/MatchList', () => ({ default: () => <div>match list</div> }));
vi.mock('@/components/admin/matches/MatchConsole', () => ({ default: ({ matchId }: { matchId: string }) => <div>console for {matchId}</div> }));

const MatchesPage = (await import('@/app/admin/(protected)/matches/page')).default;
const ConsolePage = (await import('@/app/admin/(protected)/matches/[id]/page')).default;

beforeEach(() => {
  h.requireAdminSession.mockReset().mockResolvedValue({ valid: true });
});

describe('Live Matches pages', () => {
  it('lists the matches behind the admin session', async () => {
    render(await MatchesPage());
    expect(screen.getByRole('heading', { name: 'Live Matches' })).toBeInTheDocument();
    expect(screen.getByText('match list')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute('href', '/admin/dashboard');
    expect(h.requireAdminSession).toHaveBeenCalled();
  });

  it("opens a match's scorer console behind the admin session", async () => {
    render(await ConsolePage({ params: Promise.resolve({ id: 'm1' }) }));
    expect(screen.getByRole('heading', { name: 'Scorer console' })).toBeInTheDocument();
    expect(screen.getByText('console for m1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the matches' })).toHaveAttribute('href', '/admin/matches');
  });

  it('stops when the admin session check refuses', async () => {
    h.requireAdminSession.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(MatchesPage()).rejects.toThrow('NEXT_REDIRECT');
    await expect(ConsolePage({ params: Promise.resolve({ id: 'm1' }) })).rejects.toThrow('NEXT_REDIRECT');
  });
});
