// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const runScheduledJobs = vi.fn();
vi.mock('@/lib/scheduled-jobs', () => ({ runScheduledJobs: (...a: unknown[]) => runScheduledJobs(...a) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const emptyRun = { processedQuizzes: [], processedNotifications: [], processedStaleDeposits: [] };

function req(headers: Record<string, string> = {}, query = '') {
  return new NextRequest(`http://localhost/api/cron/process-scheduled${query}`, { headers });
}

beforeEach(() => {
  vi.resetModules();
  runScheduledJobs.mockReset();
  runScheduledJobs.mockResolvedValue(emptyRun);
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.unstubAllEnvs();
});

describe('GET /api/cron/process-scheduled authorisation', () => {
  it('accepts the Bearer secret', async () => {
    process.env.CRON_SECRET = 's3cret';
    const { GET } = await import('@/app/api/cron/process-scheduled/route');
    const res = await GET(req({ authorization: 'Bearer s3cret' }));
    expect(res.status).toBe(200);
    expect(runScheduledJobs).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing or wrong Bearer secret without running any job', async () => {
    process.env.CRON_SECRET = 's3cret';
    const { GET } = await import('@/app/api/cron/process-scheduled/route');
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ authorization: 'Bearer nope' }))).status).toBe(401);
    expect((await GET(req({ authorization: 's3cret' }))).status).toBe(401); // no "Bearer " prefix
    expect(runScheduledJobs).not.toHaveBeenCalled();
  });

  it('no longer accepts the secret in the URL (it leaks into access logs)', async () => {
    process.env.CRON_SECRET = 's3cret';
    const { GET } = await import('@/app/api/cron/process-scheduled/route');
    const res = await GET(req({}, '?secret=s3cret'));
    expect(res.status).toBe(401);
    expect(runScheduledJobs).not.toHaveBeenCalled();
  });

  it('fails closed in production when CRON_SECRET is not configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { GET } = await import('@/app/api/cron/process-scheduled/route');
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(runScheduledJobs).not.toHaveBeenCalled();
  });

  it('is open in development when no secret is configured (local testing)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { GET } = await import('@/app/api/cron/process-scheduled/route');
    expect((await GET(req())).status).toBe(200);
  });
});
