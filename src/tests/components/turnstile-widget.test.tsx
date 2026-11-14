import '@/tests/helpers/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import type { TurnstileHandle } from '@/components/auth/TurnstileWidget';

const h = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: (...a: unknown[]) => h.captureMessage(...a) }));

// A stand-in for Cloudflare's window.turnstile: records each render's options so a test can play
// the widget's callbacks (pass, expire, fail).
type Options = { sitekey: string; action: string; theme: string; callback(t: string): void; 'expired-callback'(): void; 'error-callback'(code?: string): void };
const fakeTurnstile = () => {
  const widgets: Options[] = [];
  return {
    widgets,
    render: vi.fn((_el: HTMLElement, options: Options) => { widgets.push(options); return `w${widgets.length}`; }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
};

const scripts = () => [...document.head.querySelectorAll('script[src*="challenges.cloudflare.com"]')] as HTMLScriptElement[];
// A fresh module each time, so the "script already requested" state does not leak between tests
const load = async () => (await import('@/components/auth/TurnstileWidget')).default;

// The clock check's request: fails by default, so only the tests that want a skew get one
let fetchMock: ReturnType<typeof vi.spyOn>;
const serverClock = (offsetMs: number) =>
  fetchMock.mockResolvedValue(new Response(null, { headers: { date: new Date(Date.now() + offsetMs).toUTCString() } }));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  vi.resetModules();
  delete window.turnstile;
  scripts().forEach((s) => s.remove());
  h.captureMessage.mockReset();
  fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// A widget already on the page, rendered once
const mounted = async (props: Partial<{ onToken: (t: string | null) => void }> = {}) => {
  const ts = fakeTurnstile();
  window.turnstile = ts;
  const Widget = await load();
  const onToken = props.onToken ?? vi.fn();
  const view = render(<Widget action="login" onToken={onToken} />);
  await act(async () => {});
  return { ts, onToken, ...view };
};

describe('TurnstileWidget', () => {
  it('loads the script once, renders explicitly and passes the token on', async () => {
    const Widget = await load();
    const onToken = vi.fn();
    render(<Widget action="login" onToken={onToken} />);
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');

    const ts = fakeTurnstile();
    window.turnstile = ts;
    await act(async () => { scripts()[0].onload!(new Event('load')); });
    expect(ts.render).toHaveBeenCalledWith(screen.getByTestId('turnstile'), expect.objectContaining({ sitekey: '0x4AAAAAAFYus6FWoa1eqnrG', action: 'login', theme: 'dark' }));

    act(() => ts.widgets[0].callback('tok-1'));
    expect(onToken).toHaveBeenLastCalledWith('tok-1');
    act(() => ts.widgets[0]['expired-callback']());
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it('explains a failed check until the next one passes', async () => {
    const ts = fakeTurnstile();
    window.turnstile = ts;
    const Widget = await load();
    const onToken = vi.fn();
    render(<Widget action="signup" onToken={onToken} />);
    await act(async () => {});
    expect(scripts()).toHaveLength(0); // already on the page

    act(() => ts.widgets[0]['error-callback']());
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('alert')).toHaveTextContent(/security check couldn.t finish/);
    act(() => ts.widgets[0].callback('tok-2'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('resets for a fresh token, and removes the widget on unmount', async () => {
    const ts = fakeTurnstile();
    window.turnstile = ts;
    const Widget = await load();
    const ref = createRef<TurnstileHandle>();
    const onToken = vi.fn();
    const { unmount } = render(<Widget ref={ref} action="login" onToken={onToken} />);
    await act(async () => {});

    act(() => ref.current!.reset());
    expect(ts.reset).toHaveBeenCalledWith('w1');
    expect(onToken).toHaveBeenLastCalledWith(null);

    const handle = ref.current!;
    unmount();
    expect(ts.remove).toHaveBeenCalledWith('w1');
    // a request that finishes after the form has gone still clears its token, without touching Turnstile
    handle.reset();
    expect(ts.reset).toHaveBeenCalledTimes(1);
  });

  it('reports a script that fails to load, and tries again on the next mount', async () => {
    const Widget = await load();
    const first = render(<Widget action="login" onToken={vi.fn()} />);
    await act(async () => { scripts()[0].onerror!(new Event('error')); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(scripts()).toHaveLength(0);
    first.unmount();

    render(<Widget action="login" onToken={vi.fn()} />);
    expect(scripts()).toHaveLength(1);
  });

  it('does nothing when it unmounts before the script answers', async () => {
    const Widget = await load();
    const ts = fakeTurnstile();
    const loaded = render(<Widget action="login" onToken={vi.fn()} />);
    const script = scripts()[0];
    loaded.unmount();
    window.turnstile = ts;
    await act(async () => { script.onload!(new Event('load')); });
    expect(ts.render).not.toHaveBeenCalled();
    expect(ts.remove).not.toHaveBeenCalled();

    delete window.turnstile;
    vi.resetModules();
    const Again = await load();
    const failed = render(<Again action="login" onToken={vi.fn()} />);
    const next = scripts().at(-1)!;
    failed.unmount();
    await act(async () => { next.onerror!(new Event('error')); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('uses the site key from the environment when one is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '1x00000000000000000000AA');
    const ts = fakeTurnstile();
    window.turnstile = ts;
    const Widget = await load();
    render(<Widget action="login" onToken={vi.fn()} />);
    await act(async () => {});
    expect(ts.widgets[0].sitekey).toBe('1x00000000000000000000AA');
  });
  it('names a wrong device clock from its error code', async () => {
    const { ts } = await mounted();
    act(() => ts.widgets[0]['error-callback']('200100'));
    expect(screen.getByRole('alert')).toHaveTextContent("Your device's date or time is wrong.");
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent("Your device's date or time is wrong.");
  });

  it('checks the clock on any failure and says how far off it is', async () => {
    serverClock(12 * 3_600_000);
    const { ts } = await mounted();
    act(() => ts.widgets[0]['error-callback']('600010'));
    expect(screen.getByRole('alert')).toHaveTextContent("couldn't verify your browser");
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('wrong (about 12 hours behind)');
  });

  it('keeps the original advice when the clock is fine', async () => {
    serverClock(60_000);
    const { ts } = await mounted();
    act(() => ts.widgets[0]['error-callback']('110600'));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('timed out');
  });

  it('ignores a clock result that arrives after the check passed or the form closed', async () => {
    serverClock(-3_600_000);
    const { ts, unmount } = await mounted();
    act(() => ts.widgets[0]['error-callback']('300010'));
    act(() => ts.widgets[0].callback('tok'));
    await flush();
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => ts.widgets[0]['error-callback']('300010'));
    unmount();
    await flush();
  });

  it('reports a broken site key to Sentry without blaming the visitor', async () => {
    const { ts } = await mounted();
    act(() => ts.widgets[0]['error-callback']('110200'));
    expect(screen.getByRole('alert')).toHaveTextContent("isn't working on our side");
    expect(h.captureMessage).toHaveBeenCalledWith('Turnstile configuration error 110200', { level: 'error', tags: { turnstile: '110200' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts a fresh widget on Try again', async () => {
    const { ts, onToken } = await mounted();
    act(() => ts.widgets[0]['error-callback']('110620'));
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await act(async () => {});
    expect(ts.remove).toHaveBeenCalledWith('w1');
    expect(ts.render).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it('when offline, says so and restarts by itself once the connection is back', async () => {
    let online = false;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    const { ts, unmount } = await mounted();
    act(() => ts.widgets[0]['error-callback']('200500'));
    expect(screen.getByRole('alert')).toHaveTextContent("You're offline.");
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    online = true;
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(ts.render).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
  });

  it('explains a blocked script and loads it again on Try again', async () => {
    const Widget = await load();
    render(<Widget action="login" onToken={vi.fn()} />);
    await act(async () => { scripts()[0].onerror!(new Event('error')); });
    expect(screen.getByRole('alert')).toHaveTextContent("couldn't load");
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(scripts()).toHaveLength(1);
  });
});
