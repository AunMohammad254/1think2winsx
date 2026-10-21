import * as Sentry from '@sentry/nextjs';

export async function register() {
  // Node runtime only: the scheduler needs timers and the service-role DB client
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
    const { startScheduler } = await import('@/lib/scheduler-loop');
    startScheduler();
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Errors thrown while rendering, in route handlers, server actions and the proxy go to Sentry
export const onRequestError = Sentry.captureRequestError;
