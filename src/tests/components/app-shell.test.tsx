import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { jsonResponse } from '@/tests/helpers/ui';

const h = vi.hoisted(() => ({
  auth: { user: null as Record<string, unknown> | null, isLoading: false, signOut: vi.fn() },
  notif: {} as Record<string, unknown>,
  pwa: { isInstallable: true, isBannerDismissed: false, installApp: vi.fn(), dismissBanner: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  log: vi.fn(),
  vitals: null as null | ((m: unknown) => void),
  loaders: [] as (() => Promise<unknown>)[],
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/hooks/useNotifications', () => ({ useNotifications: () => h.notif }));
vi.mock('@/contexts/PWAContext', () => ({ usePWA: () => h.pwa }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: async () => ({ 'x-csrf-token': 'tok' }) }));
vi.mock('@/lib/logger', () => ({ default: { log: h.log } }));
vi.mock('next/web-vitals', () => ({ useReportWebVitals: (cb: (m: unknown) => void) => { h.vitals = cb; } }));
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<unknown>) => {
    h.loaders.push(loader);
    return function Dynamic() { return <div data-testid="dynamic" />; };
  },
}));
vi.mock('@/components/chatbot/ChatbotWidget', () => ({ default: () => null }));

import Navbar from '@/components/Navbar';
import MobileNav from '@/components/navbar/MobileNav';
import UserProfileDropdown from '@/components/navbar/UserProfileDropdown';
import NotificationsDropdown from '@/components/navbar/NotificationsDropdown';
import Footer from '@/components/Footer';
import InstallPromptBanner from '@/components/InstallPromptBanner';
import LazySection from '@/components/LazySection';
import { WebVitals } from '@/components/analytics/WebVitals';
import ChatbotLoader from '@/components/chatbot/ChatbotLoader';
import type { User } from '@supabase/supabase-js';

const ali = { id: 'u1', email: 'ali@example.com', user_metadata: { name: 'Ali Raza' } } as unknown as User;

const notifState = (over: Record<string, unknown> = {}) => {
  Object.assign(h.notif, {
    notifications: [], unreadCount: 0, loading: false, soundEnabled: true, listLoaded: true, error: null,
    toggleSound: vi.fn(), markAsRead: vi.fn(), markAllAsRead: vi.fn(), deleteNotification: vi.fn(), loadNotifications: vi.fn(),
    ...over,
  });
};

beforeEach(() => {
  h.auth = { user: null, isLoading: false, signOut: vi.fn() };
  notifState();
  h.toast.success.mockReset();
  h.toast.error.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Navbar', () => {
  it('shows sign-in links to visitors and the mobile menu', async () => {
    render(<Navbar />);
    expect(screen.getByRole('link', { name: /Sign In/ })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: /Profile/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(await screen.findByText('Menu')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Menu')).toBeNull());
  });

  it('shows a skeleton while auth loads', () => {
    h.auth.isLoading = true;
    const { container } = render(<Navbar />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('link', { name: /Sign In/ })).toBeNull();
  });

  it('shows the bell, the profile menu and a Profile link to players', () => {
    h.auth.user = ali as unknown as Record<string, unknown>;
    render(<Navbar />);
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Profile/ })[0]).toHaveAttribute('href', '/profile');
    expect(screen.getByText('Ali Raza')).toBeInTheDocument();
  });

  it('darkens once the page scrolls', () => {
    const { container } = render(<Navbar />);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 50 });
    act(() => void window.dispatchEvent(new Event('scroll')));
    expect(container.querySelector('header')!.className).toContain('bg-black/60');
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
});

describe('MobileNav', () => {
  it('closes from the X, the backdrop, Escape and any link', async () => {
    const onClose = vi.fn();
    const { rerender, container, unmount } = render(<MobileNav isOpen onClose={onClose} user={null} onSignOut={vi.fn()} />);
    const header = screen.getByText('Menu').parentElement!;
    fireEvent.click(within(header).getByRole('button'));
    fireEvent.click(container.querySelector('.backdrop-blur-sm')!);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.click(screen.getByRole('link', { name: /Get Started/ }));
    expect(onClose).toHaveBeenCalledTimes(4);
    rerender(<MobileNav isOpen={false} onClose={onClose} user={null} onSignOut={vi.fn()} />);
    // Stays mounted in its closing state while the slide-out plays
    expect(container.querySelector('.menu-panel')).toHaveAttribute('data-state', 'closed');
    await waitFor(() => expect(screen.queryByText('Menu')).toBeNull());
    expect(document.body.style.overflow).toBe('');
    unmount();
  });

  it('offers Profile and Sign Out to players', () => {
    const onClose = vi.fn();
    const onSignOut = vi.fn();
    render(<MobileNav isOpen onClose={onClose} user={ali} onSignOut={onSignOut} />);
    expect(screen.getByRole('link', { name: /Profile/ })).toHaveAttribute('href', '/profile');
    fireEvent.click(screen.getByRole('button', { name: /Sign Out/ }));
    expect(onSignOut).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('UserProfileDropdown', () => {
  it('opens, links to the profile and signs out', async () => {
    const onSignOut = vi.fn();
    render(<div><span>outside</span><UserProfileDropdown user={ali} onSignOut={onSignOut} /></div>);
    const toggle = screen.getByRole('button', { name: /Ali Raza/ });
    expect(toggle).toHaveTextContent('A');
    expect(toggle.querySelector('.rotate-180')).toBeNull();
    fireEvent.click(toggle);
    expect(await screen.findByText('ali@example.com')).toBeInTheDocument();
    expect(toggle.querySelector('.rotate-180')).not.toBeNull();
    fireEvent.click(screen.getByRole('link', { name: /Profile/ }));
    await waitFor(() => expect(screen.queryByText('ali@example.com')).toBeNull());
    fireEvent.click(toggle);
    fireEvent.click(await screen.findByRole('button', { name: /Sign Out/ }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('closes on outside click and Escape', async () => {
    render(<div><span>outside</span><UserProfileDropdown user={ali} onSignOut={vi.fn()} /></div>);
    const toggle = screen.getByRole('button', { name: /Ali Raza/ });
    fireEvent.click(toggle);
    fireEvent.mouseDown(screen.getByText('ali@example.com'));
    expect(screen.getByText('ali@example.com')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('outside'));
    await waitFor(() => expect(screen.queryByText('ali@example.com')).toBeNull());
    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('ali@example.com')).toBeNull());
  });

  it('falls back to full_name, the email name, then "User"', () => {
    const { rerender } = render(<UserProfileDropdown user={{ ...ali, user_metadata: { full_name: 'Sara F' } }} onSignOut={vi.fn()} />);
    expect(screen.getByText('Sara F')).toBeInTheDocument();
    rerender(<UserProfileDropdown user={{ ...ali, user_metadata: {} }} onSignOut={vi.fn()} />);
    expect(screen.getByText('ali')).toBeInTheDocument();
    rerender(<UserProfileDropdown user={{ ...ali, email: undefined, user_metadata: undefined } as unknown as User} onSignOut={vi.fn()} />);
    expect(screen.getByText('User')).toBeInTheDocument();
  });
});

describe('NotificationsDropdown', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const items = [
    { id: 'n1', type: 'live_stream', title: 'Live now', message: 'Stream', link: '/quiz/abc', read: false, createdAt: ago(10_000) },
    { id: 'n2', type: 'quiz_deadline', title: 'Results', message: 'R', link: '/quiz/abc/results', read: true, createdAt: ago(5 * 60_000) },
    { id: 'n3', type: 'streak_reminder', title: 'Streak', message: 'S', link: '/prizes', read: true, createdAt: ago(3 * 3600_000) },
    { id: 'n4', type: 'mystery', title: 'Unread no link', message: 'M', link: null, read: false, createdAt: ago(2 * 86_400_000) },
    { id: 'n5', type: 'general', title: 'Old', message: 'O', link: null, read: true, createdAt: '2026-01-05T10:00:00Z' },
  ];
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));

  it('loads the list on first open and shows the loading and empty states', async () => {
    notifState({ listLoaded: false });
    const { rerender } = render(<NotificationsDropdown />);
    open();
    expect(await screen.findByText('Loading notifications...')).toBeInTheDocument();
    expect(h.notif.loadNotifications).toHaveBeenCalled();
    notifState({ listLoaded: true });
    rerender(<NotificationsDropdown />);
    expect(screen.getByText('All caught up!')).toBeInTheDocument();
    notifState({ listLoaded: false, error: 'boom' });
    rerender(<NotificationsDropdown />);
    expect(screen.getByText('All caught up!')).toBeInTheDocument();
    notifState({ loading: true });
    rerender(<NotificationsDropdown />);
    expect(screen.getByText('Loading notifications...')).toBeInTheDocument();
  });

  it('leaves the time blank for an unparseable date', async () => {
    notifState({ notifications: [{ ...items[4], createdAt: 'not a date' }], unreadCount: 0 });
    render(<NotificationsDropdown />);
    open();
    expect(await screen.findByText('Old')).toBeInTheDocument();
    expect(screen.queryByText('Invalid Date')).toBeNull();
  });

  it('lists notifications with times, links and actions', async () => {
    notifState({ notifications: items, unreadCount: 12, soundEnabled: false });
    render(<NotificationsDropdown />);
    expect(screen.getByText('9+')).toBeInTheDocument();
    open();
    expect(await screen.findByText('12 new')).toBeInTheDocument();
    expect(screen.getByText('Just now')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expect(screen.getByText('2d ago')).toBeInTheDocument();
    expect(screen.getByText(/^(Jan 5|5 Jan)$/)).toBeInTheDocument(); // locale-dependent order

    const links = screen.getAllByRole('link', { name: /View Details/ });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/quizzes?openQuiz=abc', '/quiz/abc/results', '/prizes']);
    fireEvent.click(screen.getByTitle('Unmute sound'));
    expect(h.notif.toggleSound).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: /Read all/ }));
    expect(h.notif.markAllAsRead).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Mark as read/ }));
    expect(h.notif.markAsRead).toHaveBeenCalledWith('n4');
    fireEvent.click(screen.getAllByTitle('Delete notification')[4]);
    expect(h.notif.deleteNotification).toHaveBeenCalledWith('n5');

    fireEvent.click(links[1]); // already read: just closes
    expect(h.notif.markAsRead).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('12 new')).toBeNull());
    open();
    fireEvent.click(screen.getAllByRole('link', { name: /View Details/ })[0]);
    expect(h.notif.markAsRead).toHaveBeenCalledWith('n1');
  });

  it('closes from its X, outside clicks and Escape', async () => {
    notifState({ unreadCount: 1, soundEnabled: true });
    render(<div><span>outside</span><NotificationsDropdown /></div>);
    const isOpen = () => screen.queryByText('1 new') !== null;
    open();
    expect(screen.getByTitle('Mute sound')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close notifications' }));
    await waitFor(() => expect(isOpen()).toBe(false));
    open();
    fireEvent.mouseDown(screen.getByText('1 new'));
    fireEvent.mouseDown(screen.getByText('outside'));
    await waitFor(() => expect(isOpen()).toBe(false));
    open();
    fireEvent.keyDown(document, { key: 'a' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(isOpen()).toBe(false));
  });
});

describe('Footer newsletter', () => {
  const input = () => screen.getByPlaceholderText('Enter your email');
  const submit = () => fireEvent.submit(input().closest('form')!);

  it('validates the email before calling the API', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Footer />);
    submit();
    expect(h.toast.error).toHaveBeenLastCalledWith('Please enter your email address');
    fireEvent.change(input(), { target: { value: 'not-an-email' } });
    submit();
    expect(h.toast.error).toHaveBeenLastCalledWith('Please enter a valid email address');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /Privacy Policy/ })).toHaveAttribute('href', '/privacy');
  });

  it('subscribes, and reports refusals and network errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, message: 'Check your inbox' }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Already subscribed' }, 409))
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    render(<Footer />);
    const go = async (expectFn: () => void) => {
      fireEvent.change(input(), { target: { value: ' ali@example.com ' } });
      submit();
      await waitFor(expectFn);
    };
    await go(() => expect(h.toast.success).toHaveBeenLastCalledWith('Check your inbox'));
    expect(input()).toHaveValue('');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/newsletter/subscribe');
    expect(init.headers['x-csrf-token']).toBe('tok');
    expect(JSON.parse(init.body)).toEqual({ email: 'ali@example.com' });
    await go(() => expect(h.toast.success).toHaveBeenLastCalledWith('Subscribed successfully!'));
    await go(() => expect(h.toast.error).toHaveBeenLastCalledWith('Already subscribed'));
    await go(() => expect(h.toast.error).toHaveBeenLastCalledWith('Failed to subscribe'));
    await go(() => expect(h.toast.error).toHaveBeenLastCalledWith('An error occurred. Please try again.'));
  });

  it('disables the form while subscribing', async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (release = r))));
    render(<Footer />);
    fireEvent.change(input(), { target: { value: 'ali@example.com' } });
    submit();
    await waitFor(() => expect(input()).toBeDisabled());
    await act(async () => release(jsonResponse({ success: true })));
    expect(input()).toBeEnabled();
  });
});

describe('InstallPromptBanner', () => {
  it('installs, logs the outcome and can be dismissed', async () => {
    h.pwa.installApp.mockResolvedValue('accepted');
    render(<InstallPromptBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Install Now/ }));
    await waitFor(() => expect(h.log).toHaveBeenCalledWith('PWA installation outcome: accepted'));
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss banner' }));
    expect(h.pwa.dismissBanner).toHaveBeenCalledTimes(2);
  });

  it('stays hidden when not installable or dismissed', () => {
    h.pwa.isInstallable = false;
    const { container, rerender } = render(<InstallPromptBanner />);
    expect(container).toBeEmptyDOMElement();
    h.pwa.isInstallable = true;
    h.pwa.isBannerDismissed = true;
    rerender(<InstallPromptBanner />);
    expect(container).toBeEmptyDOMElement();
    h.pwa.isBannerDismissed = false;
  });
});

describe('LazySection', () => {
  type Cb = (entries: { isIntersecting: boolean }[]) => void;
  let cbs: Cb[];
  const realIO = window.IntersectionObserver;
  beforeEach(() => {
    cbs = [];
    window.IntersectionObserver = class {
      constructor(cb: Cb) { cbs.push(cb); }
      observe() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
  });
  afterEach(() => { window.IntersectionObserver = realIO; });

  it('shows a placeholder until the section nears the viewport, then fades in', async () => {
    render(<LazySection id="s" className="c"><p>content</p></LazySection>);
    expect(screen.queryByText('content')).toBeNull();
    act(() => cbs[0]([{ isIntersecting: false }]));
    expect(screen.queryByText('content')).toBeNull();
    act(() => cbs[0]([{ isIntersecting: true }]));
    expect(screen.getByText('content')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('content').parentElement!.className).toContain('opacity-100'));
  });

  it('honours a delay and a custom fallback', () => {
    vi.useFakeTimers();
    render(<LazySection delay={300} fallback={<span>wait</span>}><p>late</p></LazySection>);
    expect(screen.getByText('wait')).toBeInTheDocument();
    act(() => cbs[0]([{ isIntersecting: true }]));
    expect(screen.queryByText('late')).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('late')).toBeInTheDocument();
  });
});

describe('WebVitals and ChatbotLoader', () => {
  it('logs vitals only in development', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    render(<WebVitals />);
    vi.stubEnv('NODE_ENV', 'production');
    h.vitals!({ name: 'LCP' });
    expect(log).not.toHaveBeenCalled();
    vi.stubEnv('NODE_ENV', 'development');
    h.vitals!({ name: 'LCP' });
    expect(log).toHaveBeenCalledWith('Web Vital:', { name: 'LCP' });
    vi.unstubAllEnvs();
  });

  it('lazy-loads the chatbot widget', async () => {
    render(<ChatbotLoader />);
    expect(screen.getByTestId('dynamic')).toBeInTheDocument();
    await expect(h.loaders.at(-1)!()).resolves.toBeTruthy();
  });
});
