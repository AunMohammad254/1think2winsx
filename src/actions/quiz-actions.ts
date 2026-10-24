'use server';

import { adminActionGuard } from '@/lib/admin-guard';

import { quizDb, questionDb, notificationDb, getAdminDb } from '@/lib/supabase/db';
import { UPCOMING_NOTICE_TITLE, upcomingQuizLink, markQuizAnnounced } from '@/lib/quiz-scheduler';
import { toUtcIso, formatBusinessTime } from '@/lib/schedule-time';
import { revalidatePath } from 'next/cache';
import { clearQuizListCache } from '@/lib/quiz-cache';
import { saveQuizAdminSettings } from '@/lib/quiz-admin-settings';
import { answeredQuestionError, answeredQuestionIds, sameOptions } from '@/lib/question-guard';
import {
    QuizFormSchema,
    CreateQuizInputSchema,
    CreateQuizInput,
    UpdateQuizInput
} from '@/lib/schemas/QuizFormSchema';

// ============================================
// Types
// ============================================
type ActionResult<T = undefined> =
    | { success: true; data?: T; message?: string }
    | { success: false; error: string; code?: string };

/**
 * The correct option typed in the form: a normal quiz's answer key, or null for a prediction (nobody
 * knows it yet). It never closes the question: submit_quiz_attempt refuses answers to any question
 * with "hasCorrectAnswer", so that is set only when the result is saved in Settle Quizzes, which
 * pre-fills this key. Setting it here made every normal quiz refuse every answer ("Invalid or closed
 * question IDs in submission").
 */
function answerKey(quizType: string, options: Array<{ isCorrect?: boolean }>): number | null {
    if (quizType !== 'normal') return null;
    const index = options.findIndex(opt => opt.isCorrect);
    return index === -1 ? null : index;
}

/**
 * Save the admin-only entry limit and points pool. The quiz itself is already saved by then, so a
 * failure is reported as a warning to retry, not as a failed save (which invites a duplicate quiz).
 */
async function saveSettingsOrWarn(quizId: string, maxEntries: number, pointsPool: number): Promise<string | null> {
    try {
        await saveQuizAdminSettings(quizId, { maxEntries, pointsPool });
        return null;
    } catch (error) {
        console.error(`Saving entry limit and points pool for quiz ${quizId} failed:`, error);
        return 'but its entry limit and points pool were not saved. Edit the quiz and save again';
    }
}

// ============================================
// Admin Quiz Actions
// ============================================

/**
 * Create a new quiz with questions
 */
export async function createQuiz(input: CreateQuizInput): Promise<ActionResult<{ id: string }>> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        // Validate input
        const validationResult = CreateQuizInputSchema.safeParse(input);
        if (!validationResult.success) {
            return {
                success: false,
                error: validationResult.error.issues.map(e => e.message).join(', ')
            };
        }

        const { questions, ...quizData } = validationResult.data;

        // Create the quiz
        // startsAt must be an absolute instant (the cron compares it against UTC now).
        // toUtcIso never reads a zone-less string in the server's own timezone.
        const startsAtUtc = toUtcIso(quizData.startsAt);

        const quiz = await quizDb.create({
            title: quizData.title,
            description: quizData.description || null,
            duration: quizData.duration,
            timeUpDuration: quizData.timeUpDuration,
            passingScore: quizData.passingScore,
            status: quizData.status,
            startsAt: startsAtUtc,
            prizeId: quizData.prizeId || null,
            isBumperPrize: quizData.isBumperPrize,
            quizType: quizData.quizType,
        } as any);

        // Create questions for the quiz (open: see answerKey)
        for (const question of questions) {
            await questionDb.create({
                quizId: quiz.id,
                text: question.text,
                options: JSON.stringify(question.options.map(opt => opt.text)),
                correctOption: answerKey(quizData.quizType, question.options),
                hasCorrectAnswer: false,
                status: question.status,
            });
        }

        const settingsWarning = await saveSettingsOrWarn(quiz.id, quizData.maxEntries, quizData.pointsPool);

        if (quizData.status === 'active') {
            try {
                await notificationDb.createBroadcast({
                    title: '🎮 New Quiz Published!',
                    message: `"${quiz.title || 'Challenge'}" is now active. Play now and score points!`,
                    type: 'quiz_deadline',
                    link: `/quizzes?openQuiz=${quiz.id}`
                });
            } catch (notifErr) {
                console.error('Failed to send quiz publication broadcast notification:', notifErr);
            }
        }

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');
        clearQuizListCache();

        return {
            success: true,
            data: { id: quiz.id },
            message: settingsWarning ? `Quiz created, ${settingsWarning}.` : 'Quiz created successfully!'
        };
    } catch (error: any) {
        console.error('Create quiz error:', error);
        return {
            success: false,
            error: error?.message || 'Failed to create quiz. Please try again.'
        };
    }
}

/**
 * Update an existing quiz
 */
export async function updateQuiz(input: UpdateQuizInput): Promise<ActionResult> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        if (!input.id) {
            return { success: false, error: 'Quiz ID is required' };
        }

        const validationResult = QuizFormSchema.safeParse(input);
        if (!validationResult.success) {
            return {
                success: false,
                error: validationResult.error.issues.map(e => e.message).join(', ')
            };
        }

        const { questions, id: quizId, ...quizData } = validationResult.data;

        // Before anything is saved: refuse to remove an answered question or change its options, which
        // would delete or re-map players' answers (lib/question-guard)
        const currentQuestions = await questionDb.findByQuizId(quizId!);
        const keptIds = new Set(questions.filter(q => q.id).map(q => q.id as string));
        const currentById = new Map<string, { id: string; text: string; options?: unknown }>(
            currentQuestions.map((q: { id: string; text: string; options?: unknown }) => [q.id, q])
        );
        const optionsChanged = (q: (typeof questions)[number]) =>
            !!q.id && currentById.has(q.id) && !sameOptions(currentById.get(q.id)!.options, q.options.map(opt => opt.text));
        const risky = [
            ...currentQuestions.filter((q: { id: string }) => !keptIds.has(q.id)).map((q: { id: string }) => q.id),
            ...questions.filter(optionsChanged).map(q => q.id as string),
        ];
        const answered = risky.length > 0 ? await answeredQuestionIds(risky) : new Set<string>();
        if (answered.size > 0) {
            // Every id checked is one of the quiz's current questions
            const first = currentById.get([...answered][0])!;
            return { success: false, error: answeredQuestionError(first.text, answered.size - 1), code: 'QUESTION_ANSWERED' };
        }

        // Update quiz basic info
        // See createQuiz: absolute instant, independent of the server's timezone.
        const startsAtUtc = toUtcIso(quizData.startsAt);

        await quizDb.update(quizId!, {
            title: quizData.title,
            description: quizData.description || null,
            duration: quizData.duration,
            timeUpDuration: quizData.timeUpDuration,
            passingScore: quizData.passingScore,
            status: quizData.status,
            startsAt: startsAtUtc,
            prizeId: quizData.prizeId || null,
            isBumperPrize: quizData.isBumperPrize,
            quizType: quizData.quizType,
        } as any);

        // Delete questions not in the update list (none of them has answers: checked above)
        for (const question of currentQuestions) {
            if (!keptIds.has(question.id)) {
                await questionDb.delete(question.id);
            }
        }

        // Upsert questions. A question whose result is already saved keeps it: editing the quiz used to
        // erase a prediction's result (and reopen the question). Results change in Settle Quizzes.
        const resultSaved = new Set(currentQuestions.filter((q: { hasCorrectAnswer?: boolean }) => q.hasCorrectAnswer).map((q: { id: string }) => q.id));
        for (const question of questions) {
            const options = JSON.stringify(question.options.map(opt => opt.text));
            const key = { correctOption: answerKey(quizData.quizType, question.options), hasCorrectAnswer: false };

            if (question.id) {
                // Update existing question. Unchanged options are not rewritten: the database refuses any
                // options write to an answered question, even one that only re-spaces the JSON
                const content = {
                    text: question.text,
                    ...(optionsChanged(question) || !currentById.has(question.id) ? { options } : {}),
                    status: question.status,
                };
                await questionDb.update(question.id, resultSaved.has(question.id) ? content : { ...content, ...key });
            } else {
                // Create new question
                await questionDb.create({ quizId: quizId!, text: question.text, options, status: question.status, ...key });
            }
        }

        const settingsWarning = await saveSettingsOrWarn(quizId!, quizData.maxEntries, quizData.pointsPool);

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');
        clearQuizListCache();
        revalidatePath(`/quiz/${input.id}`);

        return { success: true, message: settingsWarning ? `Quiz updated, ${settingsWarning}.` : 'Quiz updated successfully!' };
    } catch (error) {
        console.error('Update quiz error:', error);
        return { success: false, error: 'Failed to update quiz. Please try again.' };
    }
}

/**
 * Delete a quiz
 */
export async function deleteQuiz(id: string): Promise<ActionResult> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        await quizDb.delete(id);

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');
        clearQuizListCache();

        return { success: true, message: 'Quiz deleted successfully!' };
    } catch (error) {
        console.error('Delete quiz error:', error);
        return { success: false, error: 'Failed to delete quiz. Please try again.' };
    }
}

/**
 * Publish a quiz (change status from draft to active)
 */
export async function publishQuiz(id: string): Promise<ActionResult> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        // Check if quiz has at least one question
        const questions = await questionDb.findByQuizId(id);

        if (questions.length === 0) {
            return { success: false, error: 'Cannot publish quiz without questions' };
        }

        const updatedQuiz = await quizDb.update(id, { status: 'active' });

        if (updatedQuiz) {
            try {
                await notificationDb.createBroadcast({
                    title: '🎮 New Quiz Published!',
                    message: `"${updatedQuiz.title || 'Challenge'}" is now active. Play now and score points!`,
                    type: 'quiz_deadline',
                    link: `/quizzes?openQuiz=${id}`
                });
            } catch (notifErr) {
                console.error('Failed to send quiz publication broadcast notification:', notifErr);
            }
        }

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');
        clearQuizListCache();

        return { success: true, message: 'Quiz published successfully!' };
    } catch (error) {
        console.error('Publish quiz error:', error);
        return { success: false, error: 'Failed to publish quiz. Please try again.' };
    }
}

/**
 * Pause a quiz
 */
export async function pauseQuiz(id: string): Promise<ActionResult> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        await quizDb.update(id, { status: 'paused' });

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');
        clearQuizListCache();

        return { success: true, message: 'Quiz paused successfully!' };
    } catch (error) {
        console.error('Pause quiz error:', error);
        return { success: false, error: 'Failed to pause quiz. Please try again.' };
    }
}

/**
 * Push an already-published quiz to everyone currently on the live stream.
 *
 * Sets Quiz.pushedAt, which the client picks up two ways with no new
 * infrastructure: (1) the quizzes page's existing Realtime subscription on
 * Quiz UPDATE events sees pushedAt change and shows the live toast/popup,
 * (2) the "Today's quizzes" cards read pushedAt (via /api/quizzes) to show
 * the Active/Answered/Missed badge. Also fires the same broadcast
 * notification publishQuiz() sends, for anyone not currently on the page.
 */
export async function pushQuizLive(id: string): Promise<ActionResult> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        const quiz = await quizDb.findById(id);
        if (!quiz) return { success: false, error: 'Quiz not found' };
        if (quiz.status !== 'active') {
            return { success: false, error: 'Publish the quiz before pushing it live' };
        }

        const updatedQuiz = await quizDb.update(id, { pushedAt: new Date().toISOString() } as any);

        if (updatedQuiz) {
            try {
                await notificationDb.createBroadcast({
                    title: '🔴 Live now',
                    message: `"${updatedQuiz.title || 'Quiz'}" was just pushed during the stream — jump in now!`,
                    type: 'quiz_deadline',
                    link: `/quizzes?openQuiz=${id}`
                });
            } catch (notifErr) {
                console.error('Failed to send quiz push broadcast notification:', notifErr);
            }
        }

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');
        clearQuizListCache();

        return { success: true, message: 'Pushed to live viewers!' };
    } catch (error) {
        console.error('Push quiz error:', error);
        return { success: false, error: 'Failed to push quiz. Please try again.' };
    }
}

/**
 * Tell every user about a scheduled quiz that is coming up.
 *
 * This only sends a notification. The quiz stays `scheduled` and still goes live
 * on its own at `startsAt` (see lib/quiz-scheduler); nothing about it changes.
 *
 * If users were already told about this quiz, it refuses with code
 * 'ALREADY_NOTIFIED' unless `force` is set, so a double click can't spam everyone.
 */
export async function notifyUpcomingQuiz(id: string, force = false): Promise<ActionResult> {
    const denied = await adminActionGuard();
    if (denied) return denied as any;
    try {
        const quiz = await quizDb.findById(id);
        if (!quiz) return { success: false, error: 'Quiz not found' };
        // 'upcoming' is the legacy status the old button used to set; still notifiable
        if (quiz.status !== 'scheduled' && quiz.status !== 'upcoming') {
            return { success: false, error: 'Only scheduled quizzes can be announced as upcoming' };
        }
        // Without a start time the scheduler would never take it live
        if (!quiz.startsAt) {
            return { success: false, error: 'Set a schedule date and time (edit the quiz) before notifying users' };
        }
        if (new Date(quiz.startsAt).getTime() <= Date.now()) {
            return { success: false, error: 'This quiz is due to start already, so there is nothing "upcoming" to announce' };
        }

        const link = upcomingQuizLink(id);
        if (!force) {
            const { data: alreadySent } = await getAdminDb()
                .from('Notification')
                .select('id')
                .eq('type', 'quiz_starts_soon')
                .eq('title', UPCOMING_NOTICE_TITLE)
                .eq('link', link)
                .limit(1);
            if (alreadySent && alreadySent.length > 0) {
                return { success: false, error: 'Users were already notified about this quiz.', code: 'ALREADY_NOTIFIED' };
            }
        }

        await notificationDb.createBroadcast({
            title: UPCOMING_NOTICE_TITLE,
            message: `"${quiz.title || 'Quiz'}" goes live ${formatBusinessTime(quiz.startsAt)}. Get ready!`,
            type: 'quiz_starts_soon',
            link,
        });
        // After the broadcast, so the bell already holds the notice when the stream pops it up
        await markQuizAnnounced(id);
        clearQuizListCache();

        return { success: true, message: 'Users notified about the upcoming quiz. The quiz is still scheduled.' };
    } catch (error) {
        console.error('Notify upcoming quiz error:', error);
        return { success: false, error: 'Failed to notify users. Please try again.' };
    }
}

// ============================================
// User Quiz Actions
// ============================================

// Note: Quiz submission is now handled by the API route at /api/quizzes/[id]/submit
// for better security (CSRF protection, Rate Limiting) and performance.
