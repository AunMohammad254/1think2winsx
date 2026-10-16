import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { runScheduledJobs } from '@/lib/scheduled-jobs';
import { hasValidCronSecret } from '@/lib/cron-auth';

/**
 * HTTP trigger for the scheduled jobs (go-live of scheduled quizzes, 10-minute
 * warnings, auto-pause, scheduled notifications, stale deposits).
 *
 * The work itself lives in lib/scheduled-jobs. On a Node host it also runs by itself
 * every minute (see instrumentation.ts), so this endpoint is just a manual/extra
 * trigger (Vercel cron, an external scheduler, or a curl for testing).
 */
export async function GET(request: NextRequest) {
  try {
    // Header only (`Authorization: Bearer <CRON_SECRET>`), compared in constant time. The old
    // `?secret=` form leaked the secret into access logs and is no longer accepted.
    if (process.env.CRON_SECRET) {
      if (!hasValidCronSecret(request.headers.get('authorization'))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'CRON_SECRET is not configured in production env.' },
        { status: 500 }
      );
    }

    const result = await runScheduledJobs();

    // revalidatePath only works inside a request, so it is done here and not in the shared job
    if (result.processedQuizzes.length > 0) {
      revalidatePath('/quizzes');
      revalidatePath('/admin/quiz');
      for (const id of result.processedQuizzes) {
        revalidatePath(`/quiz/${id}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${result.processedQuizzes.length} quizzes, ${result.processedNotifications.length} scheduled notifications, and ${result.processedStaleDeposits.length} stale deposits.`,
      ...result,
    }, { status: 200 });

  } catch (error) {
    console.error('[Cron] Unexpected error during scheduled processing:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
