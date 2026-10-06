import { runScheduledJobs } from '@/lib/scheduled-jobs';

/**
 * Runs the scheduled jobs on a timer inside the server process, so scheduled quizzes,
 * 10-minute warnings and auto-pause work on a plain Node host (Hostinger) with no cron
 * service configured. Started once from instrumentation.ts.
 *
 *  - Skipped on Vercel (serverless: timers don't survive between requests; use the
 *    vercel.json cron there) and in `next dev` unless SCHEDULER_ENABLED=true, so a
 *    developer's machine never runs jobs against a shared database by accident.
 *  - SCHEDULER_ENABLED=false turns it off anywhere (e.g. if an external cron is used).
 *  - Safe alongside other instances or the HTTP endpoint: jobs claim rows atomically.
 */
const INTERVAL_MS = 60_000;
const FIRST_RUN_DELAY_MS = 10_000;

const globalState = globalThis as typeof globalThis & { __quizSchedulerStarted?: boolean };

export function startScheduler() {
  if (globalState.__quizSchedulerStarted) return;

  const flag = process.env.SCHEDULER_ENABLED;
  const enabled = flag
    ? flag === 'true'
    : process.env.NODE_ENV === 'production' && !process.env.VERCEL;
  if (!enabled) return;

  globalState.__quizSchedulerStarted = true;

  let running = false;
  const tick = async () => {
    if (running) return; // a slow tick (big broadcast) must not overlap the next one
    running = true;
    try {
      await runScheduledJobs();
    } catch (err) {
      console.error('[Scheduler] Tick failed:', err);
    } finally {
      running = false;
    }
  };

  // unref: the timers must never keep the process alive on shutdown
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref();
  setInterval(tick, INTERVAL_MS).unref();
  console.log(`[Scheduler] Started: scheduled quizzes and notifications are checked every ${INTERVAL_MS / 1000}s.`);
}
