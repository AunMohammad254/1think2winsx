import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

const h = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({
  init: (...a: unknown[]) => h.init(...a),
  captureException: (...a: unknown[]) => h.captureException(...a),
  captureRouterTransitionStart: h.captureRouterTransitionStart,
  replayIntegration: () => ({ name: 'Replay' }),
  consoleLoggingIntegration: (options: unknown) => ({ name: 'ConsoleLogs', options }),
}));

beforeEach(() => {
  vi.resetModules();
  h.init.mockReset();
  h.captureException.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const lastInit = () => h.init.mock.calls.at(-1)![0];

describe('sentryOptions', () => {
  it('is off without a DSN, and samples every trace while developing but 10% in production', async () => {
    const { sentryOptions } = await import('@/lib/sentry-options');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(sentryOptions()).toEqual({ dsn: '', environment: 'development', tracesSampleRate: 1, enableLogs: true });
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://key@o1.ingest.us.sentry.io/2');
    vi.stubEnv('NODE_ENV', 'production');
    expect(sentryOptions()).toMatchObject({ dsn: 'https://key@o1.ingest.us.sentry.io/2', environment: 'production', tracesSampleRate: 0.1 });
    // A named environment (e.g. staging) wins over NODE_ENV
    vi.stubEnv('NEXT_PUBLIC_SENTRY_ENVIRONMENT', 'staging');
    expect(sentryOptions().environment).toBe('staging');
  });
});

describe('Sentry init', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://key@o1.ingest.us.sentry.io/2'));

  it('in the browser: replays only sessions that hit an error, and forwards console warnings and errors', async () => {
    const client = await import('@/instrumentation-client');
    expect(lastInit()).toMatchObject({
      dsn: 'https://key@o1.ingest.us.sentry.io/2',
      enableLogs: true,
      tunnel: '/monitoring',
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
      integrations: [{ name: 'Replay' }, { name: 'ConsoleLogs', options: { levels: ['warn', 'error'] } }],
    });
    // Client-side navigations are traced
    expect(client.onRouterTransitionStart).toBe(h.captureRouterTransitionStart);
  });

  it.each([
    ['server', () => import('@/sentry.server.config')],
    ['edge', () => import('@/sentry.edge.config')],
  ])('on the %s: sends console warnings and errors as logs (actions that catch their own errors)', async (_runtime, load) => {
    await load();
    expect(lastInit()).toMatchObject({
      dsn: 'https://key@o1.ingest.us.sentry.io/2',
      enableLogs: true,
      integrations: [{ name: 'ConsoleLogs', options: { levels: ['warn', 'error'] } }],
    });
    expect(lastInit()).not.toHaveProperty('replaysOnErrorSampleRate');
    // The server talks to Sentry directly
    expect(lastInit()).not.toHaveProperty('tunnel');
  });
});

describe('global error page', () => {
  it('reports a root-layout crash to Sentry and shows the generic error page', async () => {
    // It renders its own <html>, which React warns about inside the test's <div>
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { default: GlobalError } = await import('@/app/global-error');
    const error = Object.assign(new Error('layout exploded'), { digest: 'd9' });
    const { container } = render(<GlobalError error={error} />);
    expect(h.captureException).toHaveBeenCalledWith(error);
    expect(container.textContent).toMatch(/error/i);
  });
});
