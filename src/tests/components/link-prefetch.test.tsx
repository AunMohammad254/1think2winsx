import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';

// Which prefetch each <Link> gets (src/lib/link-prefetch.ts). The stand-in renders it as data-prefetch:
// "undefined" is Next's default (prefetch in view), "false" is none at all.
const h = vi.hoisted(() => ({
  auth: { user: null as User | null, isLoading: false, signOut: vi.fn() },
}));
// Like Next's Link it runs the link's onClick and stops the browser's own navigation.
vi.mock('next/link', () => ({
  default: ({ href, prefetch, children, onClick, ...rest }: ComponentProps<'a'> & { href: string; prefetch?: boolean | null }) => (
    <a href={href} data-prefetch={String(prefetch)} onClick={(e) => { onClick?.(e); e.preventDefault(); }} {...rest}>{children}</a>
  ),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [{ id: 'n1', title: 'Quiz live', message: 'Join now', type: 'quiz', link: '/quiz/q1', read: false, createdAt: new Date().toISOString() }],
    unreadCount: 1, loading: false, soundEnabled: true, listLoaded: true, error: null,
    toggleSound: vi.fn(), markAsRead: vi.fn(), markAllAsRead: vi.fn(), deleteNotification: vi.fn(), loadNotifications: vi.fn(),
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: async () => ({}) }));

import Navbar from '@/components/Navbar';
import MobileNav from '@/components/navbar/MobileNav';
import Footer from '@/components/Footer';
import { Button } from '@/components/landing/Primitives';
import type { User } from '@supabase/supabase-js';

const ali = { id: 'u1', email: 'ali@example.com', user_metadata: { name: 'Ali Raza' } } as unknown as User;

/** href → prefetch of every link inside `root` (the first link wins for a repeated href). */
function prefetchByHref(root: ParentNode = document) {
  const out: Record<string, string> = {};
  root.querySelectorAll('a[data-prefetch]').forEach((a) => {
    out[a.getAttribute('href')!] ??= a.getAttribute('data-prefetch')!;
  });
  return out;
}

beforeEach(() => {
  h.auth = { user: null, isLoading: false, signOut: vi.fn() };
});

describe('Navbar prefetch', () => {
  it('signed out: public pages prefetch (Cloudflare caches them); /quizzes, /login and /register do not', () => {
    const { container } = render(<Navbar />);
    expect(prefetchByHref(container.querySelector('header')!)).toEqual({
      '/': 'undefined',
      '/how-to-play': 'undefined',
      '/prizes': 'undefined',
      '/leaderboard': 'undefined',
      '/quizzes': 'false',
      '/login': 'false',
      '/register': 'false',
    });
  });

  it('signed in: nothing prefetches, since the session cookie skips the cache', () => {
    h.auth.user = ali;
    const { container } = render(<Navbar />);
    const header = container.querySelector('header')!;
    // The logo and Home share '/'
    expect(Object.keys(prefetchByHref(header))).toEqual(['/', '/quizzes', '/how-to-play', '/prizes', '/leaderboard', '/profile']);
    expect(Object.values(prefetchByHref(header))).toEqual(Array(6).fill('false'));

    // The account menu's Profile joins the bar's
    fireEvent.click(screen.getByRole('button', { name: /Ali Raza/ }));
    const profileLinks = screen.getAllByRole('link', { name: 'Profile' });
    expect(profileLinks).toHaveLength(2);
    profileLinks.forEach((link) => expect(link).toHaveAttribute('data-prefetch', 'false'));
  });

  it('waits while auth loads, then prefetches the public pages once the visitor is signed out', () => {
    h.auth.isLoading = true;
    const { container, rerender } = render(<Navbar />);
    expect(new Set(Object.values(prefetchByHref(container.querySelector('header')!)))).toEqual(new Set(['false']));

    h.auth = { user: null, isLoading: false, signOut: vi.fn() };
    rerender(<Navbar />);
    expect(prefetchByHref(container.querySelector('header')!)['/prizes']).toBe('undefined');
  });

  it('links still point at their pages, so they navigate without a prefetch', () => {
    render(<Navbar />);
    expect(screen.getByRole('link', { name: /Quizzes/ })).toHaveAttribute('href', '/quizzes');
    expect(screen.getByRole('link', { name: /Sign In/ })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /Get Started/ })).toHaveAttribute('href', '/register');
  });

  it('the notification links of a signed-in user never prefetch', () => {
    h.auth.user = ali;
    render(<Navbar />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByRole('link', { name: /View Details/ })).toHaveAttribute('data-prefetch', 'false');
  });
});

describe('MobileNav prefetch', () => {
  it('signed out: like the desktop bar', () => {
    render(<MobileNav isOpen onClose={vi.fn()} user={null} onSignOut={vi.fn()} />);
    expect(prefetchByHref()).toEqual({
      '/': 'undefined',
      '/quizzes': 'false',
      '/how-to-play': 'undefined',
      '/prizes': 'undefined',
      '/leaderboard': 'undefined',
      '/login': 'false',
      '/register': 'false',
    });
  });

  it('signed in: nothing prefetches, and a tap still closes the menu', () => {
    h.auth.user = ali;
    const onClose = vi.fn();
    render(<MobileNav isOpen onClose={onClose} user={ali} onSignOut={vi.fn()} />);
    expect(Object.values(prefetchByHref())).toEqual(Array(6).fill('false'));
    fireEvent.click(screen.getByRole('link', { name: /Prizes/ }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Footer prefetch', () => {
  it('signed out: every page but /quizzes prefetches', () => {
    render(<Footer />);
    const links = prefetchByHref();
    expect(links['/quizzes']).toBe('false');
    expect(Object.entries(links).filter(([, p]) => p !== 'undefined')).toEqual([['/quizzes', 'false']]);
    expect(Object.keys(links)).toEqual(expect.arrayContaining(['/', '/prizes', '/leaderboard', '/faq', '/contact', '/disclaimer', '/terms', '/privacy']));
  });

  it('signed in: nothing prefetches', () => {
    h.auth.user = ali;
    render(<Footer />);
    expect(new Set(Object.values(prefetchByHref()))).toEqual(new Set(['false']));
  });
});

describe('landing Button prefetch', () => {
  it('no prefetch for /register or /quizzes, the default for public pages, and plain anchors for in-page links', () => {
    render(
      <>
        <Button href="/register">Join</Button>
        <Button href="/quizzes#schedule">Schedule</Button>
        <Button href="/leaderboard">Rankings</Button>
        <Button href="#how">How</Button>
      </>,
    );
    expect(screen.getByRole('link', { name: 'Join' })).toHaveAttribute('data-prefetch', 'false');
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute('data-prefetch', 'false');
    expect(screen.getByRole('link', { name: 'Rankings' })).toHaveAttribute('data-prefetch', 'undefined');
    expect(screen.getByRole('link', { name: 'How' })).not.toHaveAttribute('data-prefetch');
  });
});
