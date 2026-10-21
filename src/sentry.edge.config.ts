import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry-options';

// Sentry in the edge runtime, loaded by src/instrumentation.ts (same settings as the Node server)
Sentry.init({
  ...sentryOptions(),
  integrations: [Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })],
});
