import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getDb, getAdminDb } from '@/lib/supabase/db';
import { z } from 'zod';
import { rateLimiters, applyRateLimit } from '@/lib/rate-limiter';
import { requireCSRFToken } from '@/lib/csrf-protection';
import { recordSecurityEvent } from '@/lib/security-monitoring';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { UNANSWERED } from '@/lib/quiz-answers';
import { QUIZ_ENDED_MESSAGE } from '@/lib/quiz-catalog';

const submitQuizSchema = z.object({
  answers: z.array(z.object({
    questionId: z.string().min(1).max(100),
    selectedOption: z.number().int().min(0).max(9),
  })).min(1).max(200),
});

const NOTE_FIRST =
  'Your predictions have been submitted. The admin will review all submissions and add correct answers. Points will be allocated to top performers based on accuracy.';
const NOTE_REATTEMPT =
  'Your predictions for the new questions have been submitted. The admin will review all submissions and add correct answers. Points will be allocated to top performers based on accuracy.';

const RPC_ERROR_STATUS: Record<string, number> = {
  payment_required: 402,
  not_found: 404,
  invalid: 400,
  forbidden: 403,
  closed: 403, // answering window over
  entries_closed: 403, // the quiz already has as many players as its entry limit
};

// Late or full: normal player behaviour, not a security event
const EXPECTED_REFUSALS = new Set(['closed', 'entries_closed']);

const SOME_CLOSED_MESSAGE =
  'Some of these questions already have their result, so they no longer take answers. Reopen the quiz to answer the rest.';

// The database may be a moment ahead of this server's clock: a question that closed just now counts as closed
const CLOCK_SLACK_MS = 5_000;

/** A live match's questions that closed before the answers arrived (each closes on its own, over by over). */
function matchClosedMessage(overs: number[], all: boolean): string {
  const which = overs.length === 1 ? `over ${overs[0]}` : `overs ${overs.join(', ')}`;
  return `Too late for ${which}: answers closed before yours arrived.${all ? '' : ' Nothing was saved, so send your other answers again.'}`;
}

/**
 * The submitted questions of this quiz that no longer take answers: their result is saved, or (a live
 * match's) they closed or their over was voided. The server reads them: players can't read when a
 * question closes.
 */
async function closedQuestions(quizId: string, questionIds: string[]): Promise<Array<{ id: string; matchOver: number | null }>> {
  const { data } = await getAdminDb().from('Question').select('id, status, hasCorrectAnswer, closesAt, matchOver')
    .eq('quizId', quizId).in('id', questionIds);
  const now = Date.now() + CLOCK_SLACK_MS;
  return ((data || []) as Array<{ id: string; status: string; hasCorrectAnswer: boolean; closesAt: string | null; matchOver: number | null }>)
    .filter((q) => q.hasCorrectAnswer || (q.closesAt !== null && Date.parse(q.closesAt) <= now) || (q.matchOver !== null && q.status === 'paused'));
}

/**
 * POST /api/quizzes/[id]/submit — Submit quiz answers
 *
 * PERFORMANCE: previously ~8 sequential Supabase round-trips per submission
 * (auth, 3x rate-limit table, payment lookup twice, quiz+questions fetch, RPC) and
 * a non-atomic fallback path doing 2 inserts per answer. All business rules
 * (quiz active, active payment, valid/unrevealed questions, one attempt per user,
 * predictions final) are now enforced inside the `submit_quiz_attempt` database
 * function in a single transaction, so this handler is: auth + 1 RPC.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: quizId } = await params;

  try {
    const csrfResult = await requireCSRFToken(request);
    if (csrfResult) return csrfResult;

    const authResult = await requireAuth({ context: 'quiz_submission' });
    if (authResult instanceof NextResponse) return authResult;
    const userId = authResult.session.user.id;

    const rateLimitResponse = await applyRateLimit(rateLimiters.quiz, request, userId, '/api/quizzes/[id]/submit');
    if (rateLimitResponse) {
      recordSecurityEvent('RATE_LIMIT_EXCEEDED', request, userId, { endpoint: '/api/quizzes/[id]/submit', rateLimiter: 'quiz' });
      return rateLimitResponse;
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    // A page loaded before the fix sends unanswered questions as -1 when time runs out: drop them, so the
    // answered ones are saved instead of the whole submission being refused
    const sent = (body as { answers?: unknown } | null)?.answers;
    if (Array.isArray(sent)) {
      const answered = sent.filter((a) => (a as { selectedOption?: unknown } | null)?.selectedOption !== UNANSWERED);
      if (sent.length > 0 && answered.length === 0) {
        return NextResponse.json({ error: 'Answer at least one question before submitting' }, { status: 400 });
      }
      body = { ...(body as object), answers: answered };
    }
    const validation = submitQuizSchema.safeParse(body);
    if (!validation.success) {
      recordSecurityEvent('INVALID_INPUT', request, userId, { endpoint: '/api/quizzes/[id]/submit' });
      return NextResponse.json(
        { error: 'Invalid answers', details: validation.error.issues },
        { status: 400 }
      );
    }

    const supabase = await getDb();
    const { data, error } = await supabase.rpc('submit_quiz_attempt', {
      p_user_id: userId,
      p_quiz_id: quizId,
      p_answers: validation.data.answers,
      p_daily_payment_id: null,
    });

    if (error || !data) {
      console.error('submit_quiz_attempt RPC error:', error);
      recordSecurityEvent('QUIZ_SUBMISSION_ERROR', request, userId, { quizId });
      return NextResponse.json({ error: 'Failed to submit quiz' }, { status: 500 });
    }

    const r = data as {
      success: boolean; code?: string; error?: string; attemptId?: string;
      answersSubmitted?: number; isReattempt?: boolean; totalQuestions?: number;
    };

    if (!r.success) {
      // "invalid" also covers a question whose result was saved, or (a match's) that closed, while the player
      // answered: say so, as normal late-player behaviour rather than a security event
      if (r.code === 'invalid') {
        const closed = await closedQuestions(quizId, validation.data.answers.map((a) => a.questionId));
        if (closed.length > 0) {
          const all = closed.length === validation.data.answers.length;
          const overs = [...new Set(closed.flatMap((q) => (q.matchOver === null ? [] : [q.matchOver])))];
          // The match screen drops the closed ones and sends the rest again
          if (overs.length > 0) {
            return NextResponse.json({
              error: matchClosedMessage(overs, all), code: 'questions_closed', closed: closed.map((q) => q.id),
            }, { status: 409 });
          }
          return NextResponse.json({
            error: all ? QUIZ_ENDED_MESSAGE : SOME_CLOSED_MESSAGE,
            code: all ? 'quiz_ended' : 'questions_closed',
          }, { status: 409 });
        }
      }
      const status = RPC_ERROR_STATUS[r.code || ''] ?? 500;
      // 400 and 403 only come from a known code, so r.code is set here
      if ((status === 400 || status === 403) && !EXPECTED_REFUSALS.has(r.code as string)) {
        recordSecurityEvent('INVALID_INPUT', request, userId, { endpoint: '/api/quizzes/[id]/submit', code: r.code });
      }
      return NextResponse.json(
        { error: r.error || 'Failed to submit quiz', ...(status === 402 ? { requiresPayment: true } : {}) },
        { status }
      );
    }

    recordSecurityEvent('QUIZ_SUBMITTED', request, userId, {
      quizId,
      attemptId: r.attemptId,
      answersSubmitted: r.answersSubmitted,
      isReattempt: r.isReattempt,
    });

    return createSecureJsonResponse({
      message: r.isReattempt
        ? 'New quiz predictions submitted successfully'
        : 'Quiz predictions submitted successfully',
      results: {
        attemptId: r.attemptId,
        score: null,
        points: null,
        totalQuestions: r.totalQuestions ?? validation.data.answers.length,
        submittedAnswers: r.answersSubmitted,
        status: 'pending_evaluation',
        isReattempt: r.isReattempt,
        note: r.isReattempt ? NOTE_REATTEMPT : NOTE_FIRST,
      },
    }, { status: 200 });
  } catch (error) {
    console.error('Quiz submission error:', error);
    recordSecurityEvent('QUIZ_SUBMISSION_ERROR', request, undefined, {
      error: error instanceof Error ? error.message : 'Unknown error',
      quizId,
    });
    return NextResponse.json({ error: 'Failed to submit quiz' }, { status: 500 });
  }
}
