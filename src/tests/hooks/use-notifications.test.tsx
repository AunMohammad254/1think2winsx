import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { UNREAD_COUNT_EVENT } from '@/lib/live-catalog';

const h = vi.hoisted(() => {
  const state = { user: { id: 'u1' } as { id: string } | null, poll: null as null | { task: () => Promise<boolean | void>; opts: { enabled: boolean } } };
  const toast = vi.fn();
  return { state, toast };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.state.user }) }));
vi.mock('@/lib/csrf', () => ({ getCSRFHeaders: async () => ({ 'x-csrf-token': 'tok' }) }));
vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/hooks/useJitteredPolling', () => ({
  useJitteredPolling: (task: () => Promise<boolean | void>, opts: { enabled: boolean }) => { h.state.poll = { task, opts }; },
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;
let mod: typeof import('@/hooks/useNotifications');

class FakeAudio {
  static instances: FakeAudio[] = [];
  state = 'running';
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  oscillators: unknown[] = [];
  constructor() { FakeAudio.instances.push(this); }
  createOscillator() {
    const osc = { type: '', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    this.oscillators.push(osc);
    return osc;
  }
  createGain() { return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }; }
}

async function load(env: { vapid?: string } = {}) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', env.vapid ?? '');
  mod = await import('@/hooks/useNotifications');
}

beforeEach(async () => {
  h.state.user = { id: 'u1' };
  h.state.poll = null;
  h.toast.mockReset();
  localStorage.clear();
  fetchMock = vi.fn(async (url: string) => (String(url).includes('countOnly') ? json({ unreadCount: 2 }) : json({ notifications: [{ id: 'n1', read: false }, { id: 'n2', read: true }], unreadCount: 1 })));
  vi.stubGlobal('fetch', fetchMock);
  FakeAudio.instances = [];
  vi.stubGlobal('AudioContext', FakeAudio);
  // jsdom has no Notification API. Note: the hook reads Notification.permission unguarded, so on a
  // browser without it (iOS Safari outside an installed PWA) the push init rejects unhandled.
  vi.stubGlobal('Notification', { permission: 'default' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await load();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // @ts-expect-error cleanup
  delete navigator.serviceWorker;
  // @ts-expect-error cleanup
  delete window.PushManager;
});

describe('useNotifications: list and badge', () => {
  it('fetches only the unread count on load, and the list when the bell opens (once)', async () => {
    const { result } = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(2));
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications?countOnly=1');
    expect(result.current.listLoaded).toBe(false);

    await act(() => result.current.loadNotifications());
    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.listLoaded).toBe(true);
    await act(() => result.current.loadNotifications());
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/notifications')).toHaveLength(1);
  });

  it('does nothing for signed-out visitors', async () => {
    h.state.user = null;
    const { result } = renderHook(() => mod.useNotifications());
    await act(() => result.current.refresh());
    await act(() => result.current.markAsRead('n1'));
    await act(() => result.current.markAllAsRead());
    await act(() => result.current.deleteNotification('n1'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.unreadCount).toBe(0);
  });

  it('handles a signed-out 401, server errors and network errors', async () => {
    const { result } = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(2));
    fetchMock.mockResolvedValueOnce(json({}, 401));
    await act(() => result.current.refresh());
    expect(result.current.unreadCount).toBe(0);
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await act(() => result.current.refresh());
    expect(result.current.error).toBe('Failed to fetch notifications (Status 500)');
    fetchMock.mockRejectedValueOnce('odd');
    await act(() => result.current.refresh());
    expect(result.current.error).toBe('Unknown error');
    fetchMock.mockResolvedValueOnce(json({}));
    await act(() => result.current.refresh());
    expect(result.current).toMatchObject({ notifications: [], unreadCount: 0, error: null });
  });

  it('ignores a failed badge count', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    const first = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(first.result.current.unreadCount).toBe(0);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    renderHook(() => mod.useNotifications());
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('[useNotifications] unread count fetch error:', expect.any(Error)));
    fetchMock.mockResolvedValueOnce(json({}));
    const third = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(third.result.current.unreadCount).toBe(0);
  });

  it('marks one or all as read optimistically, re-fetching if the server refuses', async () => {
    const { result } = renderHook(() => mod.useNotifications());
    await act(() => result.current.loadNotifications());
    await act(() => result.current.markAsRead('n1'));
    expect(result.current.notifications[0].read).toBe(true);
    expect(result.current.unreadCount).toBe(0);
    const put = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')!;
    expect(put[1].headers['x-csrf-token']).toBe('tok');
    expect(JSON.parse(put[1].body)).toEqual({ notificationId: 'n1' });

    fetchMock.mockImplementationOnce(async () => json({}, 500));
    await act(() => result.current.markAllAsRead());
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Mark all read error:', expect.any(Error)));
    fetchMock.mockImplementationOnce(async () => json({}, 500));
    await act(() => result.current.markAsRead('n2'));
    expect(console.error).toHaveBeenCalledWith('Mark read error:', expect.any(Error));
    await act(() => result.current.markAllAsRead());
    expect(result.current.unreadCount).toBe(0);
  });

  it('lowers the badge count when an unread notification is deleted', async () => {
    const { result } = renderHook(() => mod.useNotifications());
    await act(() => result.current.loadNotifications());
    expect(result.current.unreadCount).toBe(1);
    await act(() => result.current.deleteNotification('n1'));
    expect(result.current.notifications.map((n) => n.id)).toEqual(['n2']);
    expect(result.current.unreadCount).toBe(0);
  });

  it('deletes a notification, re-fetching if the server refuses', async () => {
    const { result } = renderHook(() => mod.useNotifications());
    await act(() => result.current.loadNotifications());
    await act(() => result.current.deleteNotification('n2'));
    expect(result.current.notifications.map((n) => n.id)).toEqual(['n1']);
    const del = fetchMock.mock.calls.find((c) => c[1]?.method === 'DELETE')!;
    expect(JSON.parse(del[1].body)).toEqual({ notificationId: 'n2' });
    fetchMock.mockImplementationOnce(async () => json({}, 500));
    await act(() => result.current.deleteNotification('n1'));
    expect(console.error).toHaveBeenCalledWith('Delete notification error:', expect.any(Error));
  });

  it('remembers the sound setting', async () => {
    localStorage.setItem('notifications_sound_enabled', 'false');
    const { result } = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(result.current.soundEnabled).toBe(false));
    act(() => result.current.toggleSound(true));
    expect(localStorage.getItem('notifications_sound_enabled')).toBe('true');

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const blocked = renderHook(() => mod.useNotifications());
    act(() => blocked.result.current.toggleSound(false));
    expect(blocked.result.current.soundEnabled).toBe(false);
    expect(console.warn).toHaveBeenCalledWith('LocalStorage not available', expect.any(Error));
    expect(console.warn).toHaveBeenCalledWith('Could not save sound setting', expect.any(Error));
  });
});

describe('useNotifications: badge updates without a Realtime connection', () => {
  it('polls the count every 5 minutes, announcing increases only after the first count', async () => {
    const { result } = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(2));
    // The count on load is the baseline, not news
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.state.poll!.opts).toMatchObject({ enabled: true, intervalMs: 300_000, jitterMs: 60_000 });

    // A poll right after a fresh count does not ask again
    let ok: unknown;
    const calls = fetchMock.mock.calls.length;
    await act(async () => { ok = await h.state.poll!.task(); });
    expect(ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(calls);

    let now = Date.now();
    const later = () => { now += 300_000; vi.spyOn(Date, 'now').mockReturnValue(now); };
    later();
    fetchMock.mockResolvedValueOnce(json({ unreadCount: 5 }));
    await act(async () => { ok = await h.state.poll!.task(); });
    expect(ok).toBe(true);
    expect(result.current.unreadCount).toBe(5);
    expect(h.toast).toHaveBeenCalledWith('You have new notifications', { duration: 4000 });
    expect(FakeAudio.instances[0].oscillators).toHaveLength(2);

    later();
    fetchMock.mockResolvedValueOnce(json({}));
    await act(async () => { await h.state.poll!.task(); });
    expect(result.current.unreadCount).toBe(0);
    expect(h.toast).toHaveBeenCalledTimes(1);

    act(() => result.current.toggleSound(false));
    later();
    fetchMock.mockResolvedValueOnce(json({ unreadCount: 1 }));
    await act(async () => { await h.state.poll!.task(); });
    expect(h.toast).toHaveBeenCalledTimes(2);
    expect(FakeAudio.instances[0].oscillators).toHaveLength(2);

    later();
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await act(async () => { ok = await h.state.poll!.task(); });
    expect(ok).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { ok = await h.state.poll!.task(); });
    expect(ok).toBe(false);
  });

  it('takes the count the quiz page delivers, and then skips its own poll', async () => {
    const { result } = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(result.current.unreadCount).toBe(2));
    act(() => { window.dispatchEvent(new CustomEvent(UNREAD_COUNT_EVENT, { detail: 4 })); });
    expect(result.current.unreadCount).toBe(4);
    expect(h.toast).toHaveBeenCalledWith('You have new notifications', { duration: 4000 });
    act(() => { window.dispatchEvent(new CustomEvent(UNREAD_COUNT_EVENT, { detail: 'not a count' })); });
    expect(result.current.unreadCount).toBe(4);
    const calls = fetchMock.mock.calls.length;
    await act(async () => { await h.state.poll!.task(); });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('stays idle for signed-out visitors', async () => {
    h.state.user = null;
    const { result } = renderHook(() => mod.useNotifications());
    expect(h.state.poll!.opts).toMatchObject({ enabled: false });
    expect(await h.state.poll!.task()).toBe(true);
    act(() => { window.dispatchEvent(new CustomEvent(UNREAD_COUNT_EVENT, { detail: 3 })); });
    expect(result.current.unreadCount).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('playChime', () => {
  it('plays two tones, resumes a suspended context, and survives errors', async () => {
    mod.playChime();
    expect(FakeAudio.instances[0].oscillators).toHaveLength(2);
    FakeAudio.instances[0].state = 'suspended';
    mod.playChime();
    expect(FakeAudio.instances[0].resume).toHaveBeenCalled();
    // A refused resume (autoplay policy) is swallowed
    FakeAudio.instances[0].resume.mockRejectedValueOnce(new Error('NotAllowedError'));
    mod.playChime();
    await Promise.resolve();
    FakeAudio.instances[0].state = 'closed';
    mod.playChime();
    expect(FakeAudio.instances).toHaveLength(2);
    FakeAudio.instances[1].createOscillator = () => { throw new Error('no audio'); };
    mod.playChime();
    expect(console.error).toHaveBeenCalledWith('AudioContext chime failed', expect.any(Error));
  });

  it('does nothing without Web Audio', async () => {
    vi.stubGlobal('AudioContext', undefined);
    await load();
    expect(() => mod.playChime()).not.toThrow();
  });
});

describe('web push', () => {
  const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
  let registration: { pushManager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } };
  let subscription: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn> } | null;
  const support = (permission: NotificationPermission = 'default', request: NotificationPermission = 'granted') => {
    subscription = null;
    registration = { pushManager: { getSubscription: vi.fn(async () => subscription), subscribe: vi.fn(async () => ({ endpoint: 'https://push/1' })) } };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: vi.fn(async () => registration), ready: Promise.resolve(registration) } });
    // @ts-expect-error minimal stub
    window.PushManager = function PushManager() {};
    vi.stubGlobal('Notification', { permission, requestPermission: vi.fn(async () => request) });
  };

  it('reports unsupported browsers', async () => {
    vi.stubGlobal('Notification', { permission: 'default' });
    const { result } = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(result.current.permissionState).toBe('default'));
    expect(result.current.pushSupported).toBe(false);
    expect(await result.current.subscribeToPush()).toBe(false);
    expect(await result.current.unsubscribeFromPush()).toBe(false);
  });

  it('subscribes after permission and saves the subscription', async () => {
    await load({ vapid: VAPID });
    support();
    const { result } = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(result.current.pushSupported).toBe(true));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.subscribeToPush(); });
    expect(ok).toBe(true);
    expect(result.current.pushSubscribed).toBe(true);
    const opts = registration.pushManager.subscribe.mock.calls[0][0];
    expect(opts.userVisibleOnly).toBe(true);
    expect(opts.applicationServerKey).toBeInstanceOf(Uint8Array);
    const post = fetchMock.mock.calls.find((c) => c[0] === '/api/notifications/subscribe')!;
    expect(JSON.parse(post[1].body)).toEqual({ subscription: { endpoint: 'https://push/1' } });
  });

  it('auto-subscribes when permission was already granted', async () => {
    await load({ vapid: VAPID });
    support('granted');
    const { result } = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(result.current.pushSubscribed).toBe(true));
  });

  it('notices an existing subscription and can unsubscribe', async () => {
    support();
    subscription = { endpoint: 'https://push/old', unsubscribe: vi.fn(async () => true) };
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    const { result } = renderHook(() => mod.useNotifications());
    await waitFor(() => expect(result.current.pushSubscribed).toBe(true));
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.unsubscribeFromPush(); });
    expect(ok).toBe(true);
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(result.current.pushSubscribed).toBe(false);
    const del = fetchMock.mock.calls.find((c) => c[1]?.method === 'DELETE')!;
    expect(JSON.parse(del[1].body)).toEqual({ endpoint: 'https://push/old' });

    registration.pushManager.getSubscription.mockResolvedValue(null);
    expect(await result.current.unsubscribeFromPush()).toBe(true);
    registration.pushManager.getSubscription.mockRejectedValue(new Error('x'));
    expect(await result.current.unsubscribeFromPush()).toBe(false);
  });

  it('refuses without a user, a VAPID key or permission, and when the server or browser fails', async () => {
    support();
    let hook = renderHook(() => mod.useNotifications());
    expect(await hook.result.current.subscribeToPush()).toBe(false);
    expect(console.error).toHaveBeenCalledWith('VAPID public key is missing.');

    await load({ vapid: VAPID });
    support('default', 'denied');
    hook = renderHook(() => mod.useNotifications());
    let ok: boolean | undefined;
    await act(async () => { ok = await hook.result.current.subscribeToPush(); });
    expect(ok).toBe(false);
    expect(hook.result.current.permissionState).toBe('denied');

    support();
    hook = renderHook(() => mod.useNotifications());
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await act(async () => { ok = await hook.result.current.subscribeToPush(); });
    expect(ok).toBe(false);

    h.state.user = null;
    hook = renderHook(() => mod.useNotifications());
    expect(await hook.result.current.subscribeToPush()).toBe(false);
  });

  it('logs a failed push initialisation', async () => {
    support();
    (navigator.serviceWorker.register as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('sw failed'));
    renderHook(() => mod.useNotifications());
    await waitFor(() => expect(console.error).toHaveBeenCalledWith('Error initializing web push subscription:', expect.any(Error)));
  });
});
