import { getAdminDb, notificationDb } from '@/lib/supabase/db';
import { clearQuizListCache } from '@/lib/quiz-cache';
import {
  activateDueQuizzes,
  broadcastQuizLive,
  TEN_MINUTE_WARNING_TITLE,
  upcomingQuizLink,
} from '@/lib/quiz-scheduler';
import logger from '@/lib/logger';

/**
 * All time-based background work, in one place so it can be driven by either:
 *  - the HTTP cron endpoint (`/api/cron/process-scheduled`), or
 *  - the in-process loop started from `instrumentation.ts` (`scheduler-loop.ts`), which
 *    lets a plain Node host (e.g. Hostinger, no cron service) run it with no setup.
 *
 * Every step claims its rows with a conditional UPDATE before acting, so two callers
 * running at once (several server processes, or the loop plus an HTTP call) cannot
 * double-activate a quiz or double-send a notification.
 *
 * Deliberately does NOT call `revalidatePath`: that only works inside a request. The
 * HTTP route does it using the returned `processedQuizzes`.
 */
export interface ScheduledJobsResult {
  processedQuizzes: string[];
  processedNotifications: string[];
  processedStaleDeposits: string[];
}

export async function runScheduledJobs(): Promise<ScheduledJobsResult> {
  const adminDb = getAdminDb();
  const now = new Date().toISOString();

  const processedQuizIds: string[] = [];
  const processedNotifIds: string[] = [];
  const processedStaleIds: string[] = [];

  // 1. Activate scheduled quizzes that are due, then announce them
  const { activated } = await activateDueQuizzes();
  for (const quiz of activated) {
    processedQuizIds.push(quiz.id);
    try {
      await broadcastQuizLive(quiz);
    } catch (notifErr) {
      console.error(`[Jobs] Failed to broadcast notification for quiz ${quiz.id}:`, notifErr);
    }
  }

  // 2. 10-minute warning for quizzes about to start
  const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { data: warningQuizzes } = await adminDb
    .from('Quiz')
    .select('id, title')
    .in('status', ['scheduled', 'upcoming'])
    .lte('startsAt', tenMinutesFromNow)
    .gt('startsAt', now);

  for (const quiz of warningQuizzes || []) {
    try {
      // Same link + title the broadcast below stores; the admin's "upcoming" notice
      // shares the type and link, so the title tells the two apart.
      const { data: alreadySent } = await adminDb
        .from('Notification')
        .select('id')
        .eq('link', upcomingQuizLink(quiz.id))
        .eq('type', 'quiz_starts_soon')
        .eq('title', TEN_MINUTE_WARNING_TITLE)
        .limit(1);

      if (!alreadySent || alreadySent.length === 0) {
        await notificationDb.createBroadcast({
          title: TEN_MINUTE_WARNING_TITLE,
          message: `Get ready! "${quiz.title || 'Challenge'}" starts in 10 minutes. Don't miss out!`,
          type: 'quiz_starts_soon',
          link: upcomingQuizLink(quiz.id),
        });
        logger.log(`[Jobs] Broadcasted 10-minute warning for quiz ${quiz.id}`);
      }
    } catch (warningErr) {
      console.error(`[Jobs] Failed to process warning notification for quiz ${quiz.id}:`, warningErr);
    }
  }

  // 3. Close active quizzes whose answering window (duration from pushedAt) is over
  const { data: activeQuizzes } = await adminDb
    .from('Quiz')
    .select('id, pushedAt, duration')
    .eq('status', 'active');

  const nowMs = Date.now();
  const expiredQuizIds = (activeQuizzes || [])
    .filter((q) => q.pushedAt && q.duration && nowMs >= new Date(q.pushedAt).getTime() + q.duration * 60 * 1000)
    .map((q) => q.id);

  if (expiredQuizIds.length > 0) {
    const { data: paused, error: unpublishError } = await adminDb
      .from('Quiz')
      .update({ status: 'paused', updatedAt: now })
      .in('id', expiredQuizIds)
      .eq('status', 'active')
      .select('id');
    if (unpublishError) {
      console.error('[Jobs] Failed to pause expired quizzes:', unpublishError);
    } else {
      logger.log(`[Jobs] Paused ${paused?.length ?? 0} expired quizzes.`);
      processedQuizIds.push(...(paused || []).map((q) => q.id));
    }
  }

  // 4. Admin-scheduled notifications that are due
  const { data: dueNotifications, error: fetchNotifError } = await adminDb
    .from('ScheduledNotification')
    .select('*')
    .eq('dispatched', false)
    .lte('scheduledAt', now);
  if (fetchNotifError) {
    console.error('[Jobs] Failed to fetch due scheduled notifications:', fetchNotifError);
  }

  for (const notif of dueNotifications || []) {
    // Claim first: only the caller whose UPDATE flips dispatched false -> true sends it
    const { data: claimed, error: updateError } = await adminDb
      .from('ScheduledNotification')
      .update({ dispatched: true })
      .eq('id', notif.id)
      .eq('dispatched', false)
      .select('id');
    if (updateError) {
      console.error(`[Jobs] Failed to claim scheduled notification ${notif.id}:`, updateError);
      continue;
    }
    if (!claimed || claimed.length === 0) continue;

    try {
      if (notif.targetType === 'user' && notif.targetUserId) {
        await notificationDb.create(notif.targetUserId, {
          title: notif.title,
          message: notif.message,
          type: notif.type,
          link: notif.link || undefined,
        });
      } else {
        await notificationDb.createBroadcast({
          title: notif.title,
          message: notif.message,
          type: notif.type,
          link: notif.link || undefined,
        });
      }
      processedNotifIds.push(notif.id);
    } catch (dispatchErr) {
      console.error(`[Jobs] Failed to dispatch scheduled notification ${notif.id}:`, dispatchErr);
    }
  }

  // 5. Reject wallet deposits left pending for over 48 hours
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: staleTransactions, error: staleError } = await adminDb
    .from('WalletTransaction')
    .select('id, userId, amount')
    .eq('status', 'pending')
    .lte('createdAt', fortyEightHoursAgo);

  if (!staleError) {
    for (const tx of staleTransactions || []) {
      const { data: rejected, error: rejectError } = await adminDb
        .from('WalletTransaction')
        .update({
          status: 'rejected',
          adminNotes: 'Automatically expired after 48 hours.',
          processedAt: now,
          processedBy: 'system',
          updatedAt: now,
        })
        .eq('id', tx.id)
        .eq('status', 'pending')
        .select('id');
      if (rejectError || !rejected || rejected.length === 0) continue;

      processedStaleIds.push(tx.id);
      try {
        await notificationDb.create(tx.userId, {
          title: 'Deposit Expired',
          message: `Your deposit request for ${tx.amount} PKR has automatically expired because it could not be verified within 48 hours.`,
          type: 'wallet_deposit',
          link: '/profile/wallet',
        });
      } catch (notifErr) {
        console.error(`[Jobs] Failed to send expiration notification for tx ${tx.id}:`, notifErr);
      }
    }
  }

  if (processedQuizIds.length > 0) clearQuizListCache();

  return {
    processedQuizzes: processedQuizIds,
    processedNotifications: processedNotifIds,
    processedStaleDeposits: processedStaleIds,
  };
}
