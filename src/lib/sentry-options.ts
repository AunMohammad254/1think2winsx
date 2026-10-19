/**
 * Settings shared by every Sentry.init (browser: src/instrumentation-client.ts, server and edge:
 * src/sentry.server.config.ts, src/sentry.edge.config.ts).
 *
 * Sentry stays off until NEXT_PUBLIC_SENTRY_DSN is set (Sentry → Settings → Projects → Client Keys).
 * The DSN only lets an app send events, so it is public by design; set it in hPanel's environment
 * variables, which Hostinger passes to the build (the browser bundle reads it at build time).
 */
export function sentryOptions() {
  const isDev = process.env.NODE_ENV === 'development';
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // Keeps local testing apart from the live site in Sentry
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    // Every trace while developing; 10% in production stays well inside the free plan
    tracesSampleRate: isDev ? 1.0 : 0.1,
    // Sentry Logs, fed by consoleLoggingIntegration in each init
    enableLogs: true,
  };
}
