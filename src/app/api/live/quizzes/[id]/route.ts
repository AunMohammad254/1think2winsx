/* v8 ignore next -- an import line has no logic; Vitest's rewrite of it reports a phantom branch */
import { NextResponse } from 'next/server';
import { getCatalogQuiz } from '@/lib/quiz-catalog';
import { computeQuizEndsAt } from '@/lib/quiz-clock';
import { isWalletEnabled } from '@/lib/wallet/service';
import { createSecureJsonResponse } from '@/lib/security-headers';

// Like /api/live: browsers always ask again, Cloudflare keeps the answer 10 s (needs the Cache Rule)
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=10' };
// Refusals are never cached: without a Cache-Control, Cloudflare would keep a 404 for minutes
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/live/quizzes/[id] - a quiz's questions (never the answer key), the same for every player
 * who has not answered it yet, so Cloudflare serves one copy to the whole crowd that opens a quiz the
 * moment it goes live. The personal route (/api/quizzes/[id]) costs several database round trips per
 * player; this costs none at the edge and an in-memory catalogue read on a miss.
 *
 * Only while the wallet is off: with it on, opening a quiz needs a day pass, which only the personal
 * route can check. The page uses this copy only for quizzes its list shows as unanswered and falls
 * back to the personal route on any refusal. Submitting still goes through the signed-in route, which
 * enforces the answering window, the payment and one answer per question.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const [walletEnabled, quiz] = await Promise.all([isWalletEnabled(), getCatalogQuiz(id)]);
    if (walletEnabled) {
      return NextResponse.json({ error: 'Open this quiz from your account', personal: true }, { status: 403, headers: NO_STORE });
    }
    if (!quiz) {
      return NextResponse.json({ error: 'Quiz not found or inactive' }, { status: 404, headers: NO_STORE });
    }
    // Same rule as the personal route: no questions before the scheduler makes the quiz active
    if (quiz.status === 'upcoming') {
      return NextResponse.json(
        { error: "This quiz hasn't started yet.", upcoming: true, startsAt: quiz.startsAt },
        { status: 409, headers: NO_STORE }
      );
    }

    const questions = quiz.questions.map((question) => ({ id: question.id, text: question.text, options: question.options }));
    // The personal route's shape for a first attempt. No `serverNow`: a cached copy's clock would be
    // stale, and without it the quiz clock simply trusts the device
    return createSecureJsonResponse({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration,
        pushedAt: quiz.pushedAt,
        endsAt: computeQuizEndsAt(quiz.pushedAt, quiz.duration),
        passingScore: quiz.passingScore,
        questionCount: questions.length,
        totalQuestions: questions.length,
        questions,
        isReattempt: false,
        newQuestionsCount: 0,
        previousAttempt: null,
      },
    }, { status: 200, headers: CACHE_HEADERS });
  } catch (error) {
    console.error('Shared quiz copy error:', error);
    return NextResponse.json(
      { error: 'This quiz is unavailable, please retry shortly' },
      { status: 503, headers: { ...NO_STORE, 'Retry-After': '5' } }
    );
  }
}
