export async function register() {
  // Node runtime only: the scheduler needs timers and the service-role DB client
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScheduler } = await import('@/lib/scheduler-loop');
    startScheduler();
  }
}
