'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import {
    QuizFormSchema,
    CreateQuizInput,
    UpdateQuizInput,
    QuizSubmission
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

        // Create quiz with questions in a transaction
        const quiz = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Create the quiz
            const newQuiz = await tx.quiz.create({
                data: {
                    title: quizData.title,
                    description: quizData.description || null,
                    duration: quizData.duration,
                    passingScore: quizData.passingScore,
                    accessPrice: quizData.accessPrice ?? 2,
                    status: quizData.status,
                },
            });

            // Create questions for the quiz
            for (const question of questions) {
                const hasCorrectAnswer = question.options.some(opt => opt.isCorrect);
                const correctOption = question.options.findIndex(opt => opt.isCorrect);

                await tx.question.create({
                    data: {
                        quiz: { connect: { id: newQuiz.id } },
                        text: question.text,
                        options: JSON.stringify(question.options.map(opt => opt.text)),
                        correctOption: hasCorrectAnswer ? correctOption : null,
                        hasCorrectAnswer,
                        status: question.status,
                    },
                });
            }

            return newQuiz;
        });

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

        const { questions, id, ...quizData } = validationResult.data;

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Update quiz basic info
            await tx.quiz.update({
                where: { id },
                data: {
                    title: quizData.title,
                    description: quizData.description || null,
                    duration: quizData.duration,
                    passingScore: quizData.passingScore,
                    accessPrice: quizData.accessPrice ?? 2,
                    status: quizData.status,
                },
            });

            // Delete existing questions that are not in the update
            const existingQuestionIds = questions
                .filter(q => q.id)
                .map(q => q.id as string);

            await tx.question.deleteMany({
                where: {
                    quizId: id,
                    NOT: { id: { in: existingQuestionIds } },
                },
            });

            // Upsert questions
            for (const question of questions) {
                const hasCorrectAnswer = question.options.some(opt => opt.isCorrect);
                const correctOption = question.options.findIndex(opt => opt.isCorrect);

                if (question.id) {
                    // Update existing question
                    await tx.question.update({
                        where: { id: question.id },
                        data: {
                            text: question.text,
                            options: JSON.stringify(question.options.map(opt => opt.text)),
                            correctOption: hasCorrectAnswer ? correctOption : null,
                            hasCorrectAnswer,
                            status: question.status,
                        },
                    });
                } else {
                    // Create new question
                    await tx.question.create({
                        data: {
                            quiz: { connect: { id } },
                            text: question.text,
                            options: JSON.stringify(question.options.map(opt => opt.text)),
                            correctOption: hasCorrectAnswer ? correctOption : null,
                            hasCorrectAnswer,
                            status: question.status,
                        },
                    });
                }
            }
        });

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
        await prisma.quiz.delete({
            where: { id },
        });

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
        const quiz = await prisma.quiz.findUnique({
            where: { id },
            include: { questions: { select: { id: true } } },
        });

        if (!quiz) {
            return { success: false, error: 'Quiz not found' };
        }

        if (quiz.questions.length === 0) {
            return { success: false, error: 'Cannot publish quiz without questions' };
        }

        await prisma.quiz.update({
            where: { id },
            data: { status: 'active' },
        });

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
        await prisma.quiz.update({
            where: { id },
            data: { status: 'paused' },
        });

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

/**
 * Submit quiz answers
 */
export async function submitQuizAttempt(
    userId: string,
    submission: QuizSubmission
): Promise<ActionResult<{ attemptId: string; answersSubmitted: number }>> {
    try {
        const { quizId, answers } = submission;

        // Create quiz attempt
        const attempt = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Create the attempt
            const newAttempt = await tx.quizAttempt.create({
                data: {
                    user: { connect: { id: userId } },
                    quiz: { connect: { id: quizId } },
                    isCompleted: true,
                    completedAt: new Date(),
                },
            });

            // Create answers
            for (const answer of answers) {
                await tx.answer.create({
                    data: {
                        userId,
                        question: { connect: { id: answer.questionId } },
                        quizAttempt: { connect: { id: newAttempt.id } },
                        selectedOption: answer.selectedOption,
                    },
                });

                // Also create question attempt
                await tx.questionAttempt.upsert({
                    where: {
                        userId_questionId: {
                            userId,
                            questionId: answer.questionId,
                        },
                    },
                    update: {
                        selectedOption: answer.selectedOption,
                        attemptedAt: new Date(),
                    },
                    create: {
                        user: { connect: { id: userId } },
                        question: { connect: { id: answer.questionId } },
                        quiz: { connect: { id: quizId } },
                        selectedOption: answer.selectedOption,
                    },
                });
            }

            return newAttempt;
        });

        revalidatePath(`/quiz/${quizId}`);

        return {
            success: true,
            data: {
                attemptId: attempt.id,
                answersSubmitted: answers.length
            },
            message: 'Quiz submitted successfully!'
        };
    } catch (error) {
        console.error('Submit quiz attempt error:', error);
        return { success: false, error: 'Failed to submit quiz. Please try again.' };
    }
}
