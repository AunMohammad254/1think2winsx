import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => {
  type Listener = (event: string, session: unknown) => void;
  const state: { listener: Listener | null } = { listener: null };
  const auth = {
    getSession: vi.fn(),
    signOut: vi.fn(),
    onAuthStateChange: vi.fn((cb: Listener) => {
      state.listener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
  };
  return { auth, state };
});
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: h.auth }) }));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { PWAProvider, usePWA } from '@/contexts/PWAContext';

const ali = { id: 'u1', email: 'ali@example.test', updated_at: 't1' };
const authWrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;
let hrefSetter: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.auth.getSession.mockReset().mockResolvedValue({ data: { session: { user: ali } }, error: null });
  h.auth.signOut.mockReset().mockResolvedValue({ error: null });
  h.state.listener = null;
  hrefSetter = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { set href(v: string) { hrefSetter(v); }, get href() { return 'http://localhost/'; } } });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('AuthProvider', () => {
  it('loads the initial session', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: authWrapper });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toEqual(ali);
    expect(result.current.session).toEqual({ user: ali });
  });

  it('signs out a dead refresh token instead of looping on it', async () => {
    h.auth.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'Invalid Refresh Token: Not Found' } });
    const { result } = renderHook(() => useAuth(), { wrapper: authWrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(h.auth.signOut).toHaveBeenCalled();
    expect(result.current.user).toBeNull();

    h.auth.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'x', code: 'refresh_token_not_found' } });
    const second = renderHook(() => useAuth(), { wrapper: authWrapper });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(h.auth.signOut).toHaveBeenCalledTimes(2);
  });

  it('keeps going on other session errors and clears state on exceptions', async () => {
    h.auth.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'network' } });
    const { result } = renderHook(() => useAuth(), { wrapper: authWrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(h.auth.signOut).not.toHaveBeenCalled();
    expect(result.current.user).toBeNull();

    h.auth.getSession.mockRejectedValue(new Error('offline'));
    const second = renderHook(() => useAuth(), { wrapper: authWrapper });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(second.result.current.session).toBeNull();
  });

  it('follows auth events, keeping the same user object for the same person', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: authWrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const first = result.current.user;

    act(() => { void h.state.listener!('TOKEN_REFRESHED', { user: { ...ali } }); });
    expect(result.current.user).toBe(first);

    act(() => { void h.state.listener!('USER_UPDATED', { user: { ...ali, updated_at: 't2' } }); });
    expect(result.current.user).not.toBe(first);

    act(() => { void h.state.listener!('TOKEN_REFRESHED', null); });
    expect(result.current.user).toBeNull();

    act(() => { void h.state.listener!('SIGNED_IN', { user: ali }); });
    expect(result.current.user).toEqual(ali);
    act(() => { void h.state.listener!('SIGNED_OUT', null); });
    expect(result.current.session).toBeNull();
    act(() => { void h.state.listener!('INITIAL_SESSION', null); });
    expect(result.current.user).toBeNull();
  });

  it('signOut clears state and goes to /login, even when Supabase fails', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: authWrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(() => result.current.signOut());
    expect(hrefSetter).toHaveBeenCalledWith('/login');
    expect(result.current.user).toBeNull();

    h.auth.signOut.mockRejectedValueOnce(new Error('down'));
    await act(() => result.current.signOut());
    expect(hrefSetter).toHaveBeenCalledTimes(2);
  });

  it('has safe defaults outside a provider', async () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current).toMatchObject({ user: null, session: null, isLoading: true });
    await expect(result.current.signOut()).resolves.toBeUndefined();
  });
});

describe('PWAProvider', () => {
  const pwaWrapper = ({ children }: { children: ReactNode }) => <PWAProvider>{children}</PWAProvider>;
  let register: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    register = vi.fn().mockResolvedValue({ scope: '/' });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
  });
  afterEach(() => {
    // @ts-expect-error test cleanup
    delete navigator.serviceWorker;
    // @ts-expect-error test cleanup
    delete (navigator as { standalone?: boolean }).standalone;
  });

  it('registers the service worker and shows the banner on first visit', async () => {
    const { result } = renderHook(() => usePWA(), { wrapper: pwaWrapper });
    await waitFor(() => expect(register).toHaveBeenCalledWith('/sw.js'));
    expect(result.current).toMatchObject({ isInstalled: false, isInstallable: false, isBannerDismissed: false });
  });

  it('logs a failed service-worker registration', async () => {
    register.mockRejectedValue(new Error('no https'));
    renderHook(() => usePWA(), { wrapper: pwaWrapper });
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('[PWA Context] Service Worker registration failed:', expect.any(Error)));
  });

  it('respects a dismissal for 7 days, then shows the banner again', () => {
    localStorage.setItem('pwa_banner_dismissed', String(Date.now() + 60_000));
    expect(renderHook(() => usePWA(), { wrapper: pwaWrapper }).result.current.isBannerDismissed).toBe(true);
    localStorage.setItem('pwa_banner_dismissed', String(Date.now() - 1));
    expect(renderHook(() => usePWA(), { wrapper: pwaWrapper }).result.current.isBannerDismissed).toBe(false);
    expect(localStorage.getItem('pwa_banner_dismissed')).toBeNull();

    const { result } = renderHook(() => usePWA(), { wrapper: pwaWrapper });
    act(() => result.current.dismissBanner());
    expect(result.current.isBannerDismissed).toBe(true);
    expect(Number(localStorage.getItem('pwa_banner_dismissed')) - Date.now()).toBeGreaterThan(6 * 86_400_000);
  });

  it('detects an installed (standalone) app', () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    expect(renderHook(() => usePWA(), { wrapper: pwaWrapper }).result.current.isInstalled).toBe(true);
  });

  it('captures the install prompt and reports the outcome', async () => {
    const { result } = renderHook(() => usePWA(), { wrapper: pwaWrapper });
    expect(await result.current.installApp()).toBeNull();

    const prompt = vi.fn();
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }) });
    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.isInstallable).toBe(true);

    let outcome: string | null = null;
    await act(async () => { outcome = await result.current.installApp(); });
    expect(prompt).toHaveBeenCalled();
    expect(outcome).toBe('accepted');
    expect(result.current.isInstallable).toBe(false);
  });

  it('handles a failing prompt and the appinstalled event', async () => {
    const { result } = renderHook(() => usePWA(), { wrapper: pwaWrapper });
    const event = Object.assign(new Event('beforeinstallprompt'), { prompt: () => { throw new Error('blocked'); }, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    act(() => void window.dispatchEvent(event));
    let outcome: string | null = 'x';
    await act(async () => { outcome = await result.current.installApp(); });
    expect(outcome).toBeNull();
    act(() => void window.dispatchEvent(new Event('appinstalled')));
    expect(result.current).toMatchObject({ isInstalled: true, isInstallable: false, deferredPrompt: null });
  });

  it('works without service-worker support and must be used inside the provider', () => {
    // @ts-expect-error simulate an old browser
    delete navigator.serviceWorker;
    expect(renderHook(() => usePWA(), { wrapper: pwaWrapper }).result.current.isInstalled).toBe(false);
    function Outside() {
      usePWA();
      return null;
    }
    expect(() => render(<Outside />)).toThrow('usePWA must be used within a PWAProvider');
  });
});
