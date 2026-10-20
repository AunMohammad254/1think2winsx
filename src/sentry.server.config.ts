import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry-options';

// Sentry on the Node server, loaded by src/instrumentation.ts. Errors thrown while rendering, in route
// handlers and in server actions arrive through onRequestError there. Most actions here catch their own
// errors and only console.error them (a failed prize insert did exactly that), so console warnings and
// errors are sent as Sentry logs too.
Sentry.init({
  ...sentryOptions(),
  integrations: [Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] })],
});
