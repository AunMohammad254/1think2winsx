import { NextRequest, NextResponse } from 'next/server';
import { getAdminDb, notificationDb } from '@/lib/supabase/db';
import { clearQuizListCache } from '@/lib/quiz-cache';
import { revalidatePath } from 'next/cache';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const { searchParams } = new URL(request.url);
    const secretParam = searchParams.get('secret');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret) {
      const isAuthorized =
        authHeader === `Bearer ${cronSecret}` || secretParam === cronSecret;

      if (!isAuthorized) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'CRON_SECRET is not configured in production env.' },
        { status: 500 }
      );
    }

    const adminDb = getAdminDb();
    const now = new Date().toISOString();

    // 1. Fetch scheduled quizzes that are due
    const { data: dueQuizzes, error: fetchError } = await adminDb
      .from('Quiz')
      .select('*')
      .eq('status', 'scheduled')
      .lte('startsAt', now);

    if (fetchError) {
      console.error('[Cron] Failed to fetch due quizzes:', fetchError);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    // 2. Fetch scheduled notifications that are due
    const { data: dueNotifications, error: fetchNotifError } = await adminDb
      .from('ScheduledNotification')
      .select('*')
      .eq('dispatched', false)
      .lte('scheduledAt', now);

    if (fetchNotifError) {
      console.error('[Cron] Failed to fetch due scheduled notifications:', fetchNotifError);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    const quizzesEmpty = !dueQuizzes || dueQuizzes.length === 0;
    const notifsEmpty = !dueNotifications || dueNotifications.length === 0;

    if (quizzesEmpty && notifsEmpty) {
      return NextResponse.json({
        success: true,
        message: 'No scheduled quizzes or notifications are due at this time.',
        processedQuizzes: [],
        processedNotifications: []
      }, { status: 200 });
    }

    const processedQuizIds: string[] = [];
    const processedNotifIds: string[] = [];

    // 3. Process due scheduled quizzes
    if (!quizzesEmpty) {
      console.log(`[Cron] Found ${dueQuizzes.length} due scheduled quizzes. Processing...`);
      for (const quiz of dueQuizzes) {
        const { error: updateError } = await adminDb
          .from('Quiz')
          .update({ status: 'active', updatedAt: now })
          .eq('id', quiz.id);

        if (updateError) {
          console.error(`[Cron] Failed to update quiz ${quiz.id} status:`, updateError);
          continue;
        }

        try {
          await notificationDb.createBroadcast({
            title: '🎮 New Quiz is Live!',
            message: `"${quiz.title || 'Challenge'}" is now active. Play now and win points!`,
            type: 'quiz_deadline',
            link: `/quiz/${quiz.id}`
          });
          processedQuizIds.push(quiz.id);
          console.log(`[Cron] Activated quiz ${quiz.id} and sent notification broadcast.`);
        } catch (notifErr) {
          console.error(`[Cron] Failed to broadcast notification for quiz ${quiz.id}:`, notifErr);
        }
      }
    }

    // 3b. Process warning notifications for quizzes starting in the next 10 minutes
    const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: warningQuizzes } = await adminDb
      .from('Quiz')
      .select('*')
      .eq('status', 'scheduled')
      .lte('startsAt', tenMinutesFromNow)
      .gt('startsAt', now);

    if (warningQuizzes && warningQuizzes.length > 0) {
      console.log(`[Cron] Found ${warningQuizzes.length} quizzes starting in the next 10 minutes. Checking warnings...`);
      for (const quiz of warningQuizzes) {
        try {
          const { data: alreadySent } = await adminDb
            .from('Notification')
            .select('id')
            .eq('link', `/quiz/${quiz.id}`)
            .eq('type', 'quiz_starts_soon')
            .limit(1);

          if (!alreadySent || alreadySent.length === 0) {
            await notificationDb.createBroadcast({
              title: '⏰ Cricket Quiz Starts in 10 Min!',
              message: `Get ready! "${quiz.title || 'Challenge'}" starts in 10 minutes. Don't miss out!`,
              type: 'quiz_starts_soon',
              link: `/quiz/${quiz.id}`
            });
            console.log(`[Cron] Broadcasted 10-minute warning notification for quiz ${quiz.id}`);
          }
        } catch (warningErr) {
          console.error(`[Cron] Failed to process warning notification for quiz ${quiz.id}:`, warningErr);
        }
      }
    }

    // 4. Process due scheduled notifications
    if (!notifsEmpty) {
      console.log(`[Cron] Found ${dueNotifications.length} due scheduled notifications. Processing...`);
      for (const notif of dueNotifications) {
        const { error: updateError } = await adminDb
          .from('ScheduledNotification')
          .update({ dispatched: true })
          .eq('id', notif.id);

        if (updateError) {
          console.error(`[Cron] Failed to mark scheduled notification ${notif.id} as dispatched:`, updateError);
          continue;
        }

        try {
          if (notif.targetType === 'user' && notif.targetUserId) {
            await notificationDb.create(notif.targetUserId, {
              title: notif.title,
              message: notif.message,
              type: notif.type,
              link: notif.link || undefined,
            });
            console.log(`[Cron] Sent targeted scheduled notification ${notif.id} to user ${notif.targetUserId}`);
          } else {
            await notificationDb.createBroadcast({
              title: notif.title,
              message: notif.message,
              type: notif.type,
              link: notif.link || undefined,
            });
            console.log(`[Cron] Broadcasted scheduled notification ${notif.id}`);
          }
          processedNotifIds.push(notif.id);
        } catch (dispatchErr) {
          console.error(`[Cron] Failed to dispatch scheduled notification ${notif.id}:`, dispatchErr);
        }
      }
    }

    // 5. Revalidate cache if quizzes were processed
    if (processedQuizIds.length > 0) {
      clearQuizListCache();
      revalidatePath('/quizzes');
      revalidatePath('/admin/quiz');
      for (const id of processedQuizIds) {
        revalidatePath(`/quiz/${id}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${processedQuizIds.length} quizzes and ${processedNotifIds.length} scheduled notifications.`,
      processedQuizzes: processedQuizIds,
      processedNotifications: processedNotifIds
    }, { status: 200 });

  } catch (error) {
    console.error('[Cron] Unexpected error during scheduled quiz processing:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
