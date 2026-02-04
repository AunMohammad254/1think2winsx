'use server';

import { quizDb, questionDb } from '@/lib/supabase/db';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/supabase/db';
import {
    QuizFormSchema,
    CreateQuizInput,
    UpdateQuizInput
} from '@/lib/schemas/QuizFormSchema';

// ============================================
// Types
// ============================================
type ActionResult<T = undefined> =
    | { success: true; data?: T; message?: string }
    | { success: false; error: string };

// ============================================
// Admin Quiz Actions
// ============================================

/**
 * Create a new quiz with questions
 */
export async function createQuiz(input: CreateQuizInput): Promise<ActionResult<{ id: string }>> {
    try {
        // Validate input
        const validationResult = QuizFormSchema.omit({ id: true }).safeParse(input);
        if (!validationResult.success) {
            return {
                success: false,
                error: validationResult.error.errors.map(e => e.message).join(', ')
            };
        }

        const { questions, ...quizData } = validationResult.data;

        // Create the quiz
        const quiz = await quizDb.create({
            title: quizData.title,
            description: quizData.description || null,
            duration: quizData.duration,
            passingScore: quizData.passingScore,
            // Access price is not part of the schema/DB in this version but kept for type compat if needed
            // accessPrice: quizData.accessPrice ?? 2,
            status: quizData.status,
        });

        // Create questions for the quiz
        for (const question of questions) {
            const hasCorrectAnswer = question.options.some(opt => opt.isCorrect);
            const correctOption = question.options.findIndex(opt => opt.isCorrect);

            await questionDb.create({
                quizId: quiz.id,
                text: question.text,
                options: JSON.stringify(question.options.map(opt => opt.text)),
                correctOption: hasCorrectAnswer ? correctOption : null,
                hasCorrectAnswer,
                status: question.status,
            });
        }

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');

        return {
            success: true,
            data: { id: quiz.id },
            message: 'Quiz created successfully!'
        };
    } catch (error) {
        console.error('Create quiz error:', error);
        return {
            success: false,
            error: 'Failed to create quiz. Please try again.'
        };
    }
}

/**
 * Update an existing quiz
 */
export async function updateQuiz(input: UpdateQuizInput): Promise<ActionResult> {
    try {
        if (!input.id) {
            return { success: false, error: 'Quiz ID is required' };
        }

        const validationResult = QuizFormSchema.safeParse(input);
        if (!validationResult.success) {
            return {
                success: false,
                error: validationResult.error.errors.map(e => e.message).join(', ')
            };
        }

        const { questions, id: quizId, ...quizData } = validationResult.data;

        // Update quiz basic info
        await quizDb.update(quizId!, {
            title: quizData.title,
            description: quizData.description || null,
            duration: quizData.duration,
            passingScore: quizData.passingScore,
            status: quizData.status,
        });

        // Get existing question IDs to update
        const existingQuestionIds = questions
            .filter(q => q.id)
            .map(q => q.id as string);

        // Delete questions not in the update list
        const currentQuestions = await questionDb.findByQuizId(quizId!);
        for (const question of currentQuestions) {
            if (!existingQuestionIds.includes(question.id)) {
                await questionDb.delete(question.id);
            }
        }

        // Upsert questions
        for (const question of questions) {
            const hasCorrectAnswer = question.options.some(opt => opt.isCorrect);
            const correctOption = question.options.findIndex(opt => opt.isCorrect);

            if (question.id) {
                // Update existing question
                await questionDb.update(question.id, {
                    text: question.text,
                    options: JSON.stringify(question.options.map(opt => opt.text)),
                    correctOption: hasCorrectAnswer ? correctOption : null,
                    hasCorrectAnswer,
                    status: question.status,
                });
            } else {
                // Create new question
                await questionDb.create({
                    quizId: quizId!,
                    text: question.text,
                    options: JSON.stringify(question.options.map(opt => opt.text)),
                    correctOption: hasCorrectAnswer ? correctOption : null,
                    hasCorrectAnswer,
                    status: question.status,
                });
            }
        }

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');
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
    try {
        await quizDb.delete(id);

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');

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
    try {
        // Check if quiz has at least one question
        const questions = await questionDb.findByQuizId(id);

        if (questions.length === 0) {
            return { success: false, error: 'Cannot publish quiz without questions' };
        }

        await quizDb.update(id, { status: 'active' });

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');

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
    try {
        await quizDb.update(id, { status: 'paused' });

        revalidatePath('/admin/quiz');
        revalidatePath('/quizzes');

        return { success: true, message: 'Quiz paused successfully!' };
    } catch (error) {
        console.error('Pause quiz error:', error);
        return { success: false, error: 'Failed to pause quiz. Please try again.' };
    }
}

// ============================================
// User Quiz Actions
// ============================================

// Note: Quiz submission is now handled by the API route at /api/quizzes/[id]/submit
// for better security (CSRF protection, Rate Limiting) and performance.
