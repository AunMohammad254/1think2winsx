import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runScheduledJobs = vi.fn();
vi.mock('@/lib/scheduled-jobs', () => ({ runScheduledJobs: (...a: unknown[]) => runScheduledJobs(...a) }));

const globalState = globalThis as typeof globalThis & { __quizSchedulerStarted?: boolean };
const ENV_KEYS = ['SCHEDULER_ENABLED', 'VERCEL', 'NODE_ENV'] as const;
const saved: Record<string, string | undefined> = {};

async function start() {
  const { startScheduler } = await import('@/lib/scheduler-loop');
  startScheduler();
}

describe('startScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    runScheduledJobs.mockReset().mockResolvedValue({});
    delete globalState.__quizSchedulerStarted;
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    delete process.env.SCHEDULER_ENABLED;
    delete process.env.VERCEL;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else (process.env as Record<string, string>)[k] = saved[k]!;
    }
  });

  it('runs 10 s after start and then every minute in production', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    await start();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(runScheduledJobs).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runScheduledJobs).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runScheduledJobs).toHaveBeenCalledTimes(2);
  });

  it('does not start twice in the same process', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    await start();
    await start();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(runScheduledJobs).toHaveBeenCalledTimes(1);
  });

  it('stays off in development unless SCHEDULER_ENABLED=true', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'development';
    await start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runScheduledJobs).not.toHaveBeenCalled();

    delete globalState.__quizSchedulerStarted;
    process.env.SCHEDULER_ENABLED = 'true';
    await start();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(runScheduledJobs).toHaveBeenCalledTimes(1);
  });

  it('stays off on Vercel and when SCHEDULER_ENABLED=false', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.VERCEL = '1';
    await start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runScheduledJobs).not.toHaveBeenCalled();

    delete process.env.VERCEL;
    process.env.SCHEDULER_ENABLED = 'false';
    await start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runScheduledJobs).not.toHaveBeenCalled();
  });

  it('never overlaps ticks and survives a failing tick', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let release!: () => void;
    runScheduledJobs.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    await start();
    await vi.advanceTimersByTimeAsync(11_000); // first tick starts and hangs
    await vi.advanceTimersByTimeAsync(60_000); // next interval fires while still running -> skipped
    expect(runScheduledJobs).toHaveBeenCalledTimes(1);
    release();
    runScheduledJobs.mockRejectedValueOnce(new Error('db down'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runScheduledJobs).toHaveBeenCalledTimes(2); // ran again, error swallowed
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runScheduledJobs).toHaveBeenCalledTimes(3); // and keeps going
  });
});
