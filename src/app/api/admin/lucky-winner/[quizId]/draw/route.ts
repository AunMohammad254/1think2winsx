import { NextRequest, NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-session';
import { getAdminDb, notificationDb } from '@/lib/supabase/db';
import { quizWinnerDb } from '@/lib/supabase/db-modules/winner.db';
import { randomBytes } from 'crypto';

/**
 * POST /api/admin/lucky-winner/[quizId]/draw
 *
 * Fair random draw from the tied top scorers of a prize-linked quiz.
 *
 * Algorithm:
 *   1. Verify quiz has a prizeId
 *   2. Idempotency check — fail fast if winner already recorded
 *   3. Fetch all completed attempts
 *   4. Find max score
 *   5. Filter tied top scorers
 *   6. If 1 tied: auto-winner (no randomness needed)
 *   7. If N tied: generate crypto random seed → use it to select winner
 *   8. Insert QuizWinner row with seed (auditable)
 *   9. Create winner notification
 *  10. Return winner details
 *
 * The seed is stored so the draw can be independently verified.
 */
export async function POST(
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

        // 1. Verify quiz exists and has a prize
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
                { error: 'Quiz is not linked to a prize. Link a prize before running the draw.' },
                { status: 422 }
            );
        }

        // 2. Idempotency — if already drawn, return existing winner
        const alreadyDrawn = await quizWinnerDb.existsForQuiz(quizId);
        if (alreadyDrawn) {
            const existing = await quizWinnerDb.findByQuizId(quizId);
            return NextResponse.json(
                {
                    error: 'A winner has already been drawn for this quiz.',
                    code: 'WINNER_ALREADY_DRAWN',
                    existingWinner: existing,
                },
                { status: 409 }
            );
        }

        // 3. Fetch all completed attempts
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

        if (attemptsData.length === 0) {
            return NextResponse.json(
                { error: 'No completed attempts found for this quiz. Cannot run draw.' },
                { status: 422 }
            );
        }

        let numberOfWinners = 1;
        let consolationPoints = 0;
        try {
            const body = await _request.json();
            numberOfWinners = Math.max(1, body.numberOfWinners || 1);
            consolationPoints = Math.max(0, body.consolationPoints || 0);
        } catch (e) {}

        // 4. Find max score
        const maxScore = attemptsData[0].score;

        // 5. Tied top scorers (all with max score, ordered by completedAt ASC = earliest first)
        const tiedCandidates = attemptsData.filter((a: any) => a.score === maxScore);

        // 6. Generate crypto random seed (32 bytes = 64 hex chars)
        const seed = randomBytes(32).toString('hex');

        // 7. Select winners
        // For multiple winners or randomization, we'll use a deterministic shuffle of indices
        const indices = tiedCandidates.map((_: any, i: number) => i);
        let selectionMethod: 'auto_single_winner' | 'random_draw' = 'auto_single_winner';
        
        if (tiedCandidates.length > numberOfWinners || tiedCandidates.length > 1) {
            selectionMethod = 'random_draw';
            // Seeded shuffle logic (Fisher-Yates with crypto seed)
            let seedInt = parseInt(seed.slice(0, 12), 16);
            for (let i = indices.length - 1; i > 0; i--) {
                const j = seedInt % (i + 1);
                [indices[i], indices[j]] = [indices[j], indices[i]];
                seedInt = Math.floor(seedInt / 2) || parseInt(seed.slice(12, 24), 16); // rudimentary bitshift for next random
            }
        }

        const actualWinnerCount = Math.min(numberOfWinners, tiedCandidates.length);
        const winners = indices.slice(0, actualWinnerCount).map((idx: any) => tiedCandidates[idx]);
        const losers = indices.slice(actualWinnerCount).map((idx: any) => tiedCandidates[idx]);

        // 8. Insert QuizWinner records and Consolation Points
        const winnerRecords = [];
        for (const winner of winners) {
            const winnerRecord = await quizWinnerDb.create({
                quizId,
                prizeId: quiz.prizeId as string,
                userId: winner.userId,
                score: winner.score,
                completedAt: winner.completedAt,
                selectionMethod,
                selectedBy: adminSession.email ?? 'admin',
                seed,
                selectedAt: new Date().toISOString(),
            });
            winnerRecords.push({ ...winnerRecord, user: winner.user });
        }

        // Add Consolation Points
        if (consolationPoints > 0 && losers.length > 0) {
            // Give points to losers via user update (we need to be careful with direct adminDb updates on User table)
            const userIds = losers.map((l: any) => l.userId);
            await adminDb.rpc('increment_users_points', { 
                user_ids: userIds, 
                amount: consolationPoints 
            });
        }

        // 9. Send winner notification (best-effort — don't fail draw if notification fails)
        for (const record of winnerRecords) {
            try {
                await notificationDb.create(record.userId, {
                    title: '🏆 Congratulations! You Won a Prize!',
                    message: `You have won the prize for quiz "${quiz.title}"! Our team will contact you shortly.`,
                    type: 'prize_won' as any,
                    link: '/prizes',
                });
                await quizWinnerDb.markNotificationSent(record.id);
            } catch (notifErr) {
                console.error('[lucky-winner/draw] Failed to send winner notification:', notifErr);
            }
        }

        return NextResponse.json({
            success: true,
            message: tiedCandidates.length === 1
                ? `Single winner selected — no draw needed.`
                : `Fair draw complete. ${winnerRecords.length} winner(s) selected from ${tiedCandidates.length} tied candidates.`,
            winners: winnerRecords.map(w => ({
                id: w.id,
                userId: w.userId,
                name: w.user?.name ?? 'Unknown',
                email: w.user?.email,
                score: w.score,
                completedAt: w.completedAt,
                selectionMethod: w.selectionMethod,
                seed,
                selectedAt: w.selectedAt,
            })),
            consolation: {
                points: consolationPoints,
                losersAwarded: losers.length,
            },
            draw: {
                totalAttempts: attemptsData.length,
                maxScore,
                tiedCount: tiedCandidates.length,
                winnerCount: winnerRecords.length,
                seed,
            },
        });
    } catch (err) {
        console.error('[admin/lucky-winner/draw] POST error:', err);
        return NextResponse.json(
            { error: 'Failed to run lucky draw. Please try again.' },
            { status: 500 }
        );
    }
}
