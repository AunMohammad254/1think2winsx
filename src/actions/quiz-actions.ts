'use server';

import { adminActionGuard } from '@/lib/admin-guard';

import { quizDb, questionDb, notificationDb, getAdminDb, generateId } from '@/lib/supabase/db';
import { UPCOMING_NOTICE_TITLE, upcomingQuizLink, markQuizAnnounced } from '@/lib/quiz-scheduler';
import { toUtcIso, formatBusinessTime } from '@/lib/schedule-time';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { clearQuizListCache } from '@/lib/quiz-cache';
import { answeredQuestionError, answeredQuestionIds, sameOptions } from '@/lib/question-guard';
import { hasPayoutHistory, SETTLED_QUIZ_DELETE_ERROR } from '@/lib/quiz-history';
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
 * A broadcast inserts one notification per registered user, which takes a while on a big user base. It
 * runs after the response (next/server `after`), so the admin's click returns and the catalogue refresh
 * that shows players the change isn't held up behind it. A failure is only logged, as before.
 */
function broadcastAfterResponse(notice: { title: string; message: string; type: string; link: string }, failure: string) {
    after(async () => {
        try {
            await notificationDb.createBroadcast(notice);
        } catch (error) {
            console.error(failure, error);
        }
    });
}

interface QuizRow {
    title: string; description: string | null; duration: number; timeUpDuration: number; passingScore: number;
    status: string; startsAt: string | null; prizeId: string | null; isBumperPrize: boolean; quizType: string;
}
interface QuestionRow { id: string; isNew?: true; text: string; status: string; correctOption: number | null; options?: string }

const ANSWERED_MEANWHILE =
    "Players answered one of these questions while you were editing, so it can't be removed and its options can't change. Reload the quiz and try again.";

/**
 * The quiz, its questions and its entry limit and points pool, saved in one transaction by the save_quiz
 * database function (migration 20261024150000): saving them one request at a time left a half-saved quiz
 * when a step failed. Questions of an edited quiz that are left out are deleted. A refusal comes back as
 * an action error; a database error is thrown.
 */
async function saveQuizAtomically(quizId: string, create: boolean, quiz: QuizRow, questions: QuestionRow[], settings: { maxEntries: number; pointsPool: number }): Promise<ActionResult | null> {
    const { data, error } = await getAdminDb().rpc('save_quiz', {
        p_quiz_id: quizId, p_create: create, p_quiz: quiz, p_questions: questions, p_settings: settings,
    });
    if (error) throw error;
    const result = data as { success: boolean; code?: string; error?: string };
    if (result.success) return null;
    // The protect_answered_question trigger caught an answer that came in after updateQuiz's own check
    if (result.code === 'question_answered') return { success: false, error: ANSWERED_MEANWHILE, code: 'QUESTION_ANSWERED' };
    return { success: false, error: result.error || 'Failed to save the quiz', code: (result.code || 'invalid').toUpperCase() };
}

/** The quiz row the form describes. startsAt must be an absolute instant (the scheduler compares it with
 * UTC now); toUtcIso never reads a zone-less string in the server's own timezone. */
function quizRow(data: { title: string; description?: string | null; duration: number; timeUpDuration: number; passingScore: number; status: string; startsAt?: string | null; prizeId?: string | null; isBumperPrize: boolean; quizType: string }): QuizRow {
    return {
        title: data.title,
        description: data.description || null,
        duration: data.duration,
        timeUpDuration: data.timeUpDuration,
        passingScore: data.passingScore,
        status: data.status,
        startsAt: toUtcIso(data.startsAt),
        prizeId: data.prizeId || null,
        isBumperPrize: data.isBumperPrize,
        quizType: data.quizType,
    };
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
        const quizId = generateId();
        const quiz = quizRow(quizData);

        // New questions are open: see answerKey
        const refused = await saveQuizAtomically(quizId, true, quiz, questions.map((question) => ({
            id: generateId(),
            isNew: true as const,
            text: question.text,
            status: question.status,
            correctOption: answerKey(quizData.quizType, question.options),
            options: JSON.stringify(question.options.map(opt => opt.text)),
        })), { maxEntries: quizData.maxEntries, pointsPool: quizData.pointsPool });
        if (refused) return refused as ActionResult<{ id: string }>;

        if (quizData.status === 'active') {
            broadcastAfterResponse({
                title: '🎮 New Quiz Published!',
                message: `"${quiz.title}" is now active. Play now and score points!`,
                type: 'quiz_deadline',
                link: `/quizzes?openQuiz=${quizId}`
            }, 'Failed to send quiz publication broadcast notification:');
        }

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');
        clearQuizListCache();

        return { success: true, data: { id: quizId }, message: 'Quiz created successfully!' };
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

        // Existing questions keep a saved result (save_quiz leaves its key alone): editing the quiz used to
        // erase a prediction's result and reopen the question. Results change in Settle Quizzes. Unchanged
        // options are not sent: the database refuses any options write to an answered question.
        const refused = await saveQuizAtomically(quizId!, false, quizRow(quizData), questions.map((question) => {
            const options = JSON.stringify(question.options.map(opt => opt.text));
            const row = { text: question.text, status: question.status, correctOption: answerKey(quizData.quizType, question.options) };
            if (!question.id) return { id: generateId(), isNew: true as const, ...row, options };
            return { id: question.id, ...row, ...(optionsChanged(question) ? { options } : {}) };
        }), { maxEntries: quizData.maxEntries, pointsPool: quizData.pointsPool });
        if (refused) return refused;

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');
        clearQuizListCache();
        revalidatePath(`/quiz/${input.id}`);

        return { success: true, message: 'Quiz updated successfully!' };
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
        // Its winners, settlement and pool shares would cascade away while the paid points stay (lib/quiz-history)
        if (await hasPayoutHistory(id)) {
            return { success: false, error: SETTLED_QUIZ_DELETE_ERROR, code: 'QUIZ_SETTLED' };
        }
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
            broadcastAfterResponse({
                title: '🎮 New Quiz Published!',
                message: `"${updatedQuiz.title || 'Challenge'}" is now active. Play now and score points!`,
                type: 'quiz_deadline',
                link: `/quizzes?openQuiz=${id}`
            }, 'Failed to send quiz publication broadcast notification:');
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
 * infrastructure: (1) the quizzes page's live check (GET /api/live, every few
 * seconds) sees pushedAt change and shows the live banner and popup,
 * (2) the "Today's quizzes" cards read pushedAt (via /api/quizzes) to show
 * the Active/Answered/Missed badge. Also fires the same broadcast
 * notification publishQuiz() sends, for anyone not currently on the page;
 * it runs after the response, so the push reaches players at once.
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
            broadcastAfterResponse({
                title: '🔴 Live now',
                message: `"${updatedQuiz.title || 'Quiz'}" was just pushed during the stream — jump in now!`,
                type: 'quiz_deadline',
                link: `/quizzes?openQuiz=${id}`
            }, 'Failed to send quiz push broadcast notification:');
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
