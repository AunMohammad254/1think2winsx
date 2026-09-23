import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { getAdminDb } from '@/lib/supabase/db';
import { quizWinnerDb } from '@/lib/supabase/db-modules/winner.db';

/**
 * GET /api/admin/lucky-winner/[quizId]
 *
 * Returns the leaderboard for a prize-linked quiz:
 * - The quiz details (title, prizeId, isBumperPrize)
 * - All completed attempts ordered by score DESC, completedAt ASC (tiebreaker)
 * - The top scorer(s) and how many are tied
 * - Whether a winner has already been drawn
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ quizId: string }> }
) {
    const adminSession = await validateAdminSession();
    if (!adminSession.valid) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { quizId } = await params;
    if (!quizId) {
        return NextResponse.json({ error: 'quizId is required' }, { status: 400 });
    }

    try {
        const adminDb = getAdminDb();

        // Fetch quiz info
        const { data: quiz, error: quizError } = await adminDb
            .from('Quiz')
            .select('id, title, prizeId, isBumperPrize, status')
            .eq('id', quizId)
            .single();

        if (quizError || !quiz) {
            return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
        }

        if (!quiz.prizeId) {
            return NextResponse.json(
                { error: 'This quiz is not linked to a prize. Link a prize first.' },
                { status: 422 }
            );
        }

        // Fetch prize info
        const { data: prize } = await adminDb
            .from('Prize')
            .select('id, name, description, imageUrl')
            .eq('id', quiz.prizeId as string)
            .maybeSingle();

        // Fetch all completed attempts, ordered by score DESC then completedAt ASC (tiebreaker)
        const { data: attempts, error: attemptsError } = await adminDb
            .from('QuizAttempt')
            .select(`
                id,
                userId,
                score,
                completedAt,
                user:userId (id, name, email, phone)
            `)
            .eq('quizId', quizId)
            .eq('isCompleted', true)
            .not('completedAt', 'is', null)
            .order('score', { ascending: false })
            .order('completedAt', { ascending: true });

        if (attemptsError) throw attemptsError;

        const attemptsData = attempts || [];
        const maxScore = attemptsData.length > 0 ? attemptsData[0].score : 0;
        const tiedTopAttempts = attemptsData.filter((a: any) => a.score === maxScore);

        // Check if a winner was already drawn
        const existingWinner = await quizWinnerDb.findByQuizId(quizId);

        return NextResponse.json({
            quiz,
            prize,
            totalAttempts: attemptsData.length,
            maxScore,
            tiedCount: tiedTopAttempts.length,
            leaderboard: attemptsData.slice(0, 50), // return top 50 for display
            tiedTopAttempts,
            existingWinner: existingWinner ?? null,
            winnerAlreadyDrawn: !!existingWinner,
        });
    } catch (err) {
        console.error('[admin/lucky-winner] GET error:', err);
        return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
    }
}
