import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry-options';

// Sentry in the browser: crashes and failed requests on players' devices, which otherwise only reach
// their own console. Off until NEXT_PUBLIC_SENTRY_DSN is set (see src/lib/sentry-options.ts).
Sentry.init({
  ...sentryOptions(),
  integrations: [
    // A replay of the moments before an error, with all text, inputs and media masked (the defaults)
    Sentry.replayIntegration(),
    // Console warnings and errors (e.g. a quiz that failed to load) become Sentry logs
    Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
  ],
  // Replays only for sessions that hit an error: the free plan has 50 a month
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});

// Traces client-side navigations
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
