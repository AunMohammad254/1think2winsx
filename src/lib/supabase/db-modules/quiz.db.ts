/**
 * Quiz, Question, QuizAttempt, Answer, QuestionAttempt Database Operations
 */

import { getDb, getAdminDb, generateId } from './shared'
import type { Insertable, Updatable } from '../database.types'

// ============================================================================
// QUIZ OPERATIONS
// ============================================================================

export const quizDb = {
    async findMany(options?: {
        status?: string
        limit?: number
        offset?: number
        orderBy?: 'createdAt' | 'title'
        orderDir?: 'asc' | 'desc'
    }) {
        const supabase = await getDb()
        let query = supabase.from('Quiz').select('*')

        if (options?.status) {
            query = query.eq('status', options.status)
        }

        query = query.order(options?.orderBy || 'createdAt', {
            ascending: options?.orderDir === 'asc'
        })

        if (options?.limit) {
            query = query.limit(options.limit)
        }

        if (options?.offset) {
            query = query.range(options.offset, options.offset + (options.limit || 10) - 1)
        }

        const { data, error } = await query
        if (error) throw error
        return data || []
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Quiz')
            .select('*')
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findByIdWithQuestions(id: string) {
        const supabase = await getDb()
        const { data: quiz, error: quizError } = await supabase
            .from('Quiz')
            .select('*')
            .eq('id', id)
            .single()

        if (quizError && quizError.code !== 'PGRST116') throw quizError
        if (!quiz) return null

        const { data: questions, error: questionsError } = await supabase
            .from('Question')
            .select('*')
            .eq('quizId', id)
            .order('createdAt', { ascending: true })

        if (questionsError) throw questionsError

        return { ...quiz, questions: questions || [] }
    },

    async create(quizData: Insertable<'Quiz'>) {
        const supabase = getAdminDb()
        const { data, error } = await supabase
            .from('Quiz')
            .insert({
                id: generateId(),
                ...quizData,
                updatedAt: new Date().toISOString()
            } as any)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async update(id: string, quizData: Updatable<'Quiz'>) {
        const supabase = getAdminDb()
        const { data, error } = await supabase
            .from('Quiz')
            .update({ ...quizData, updatedAt: new Date().toISOString() } as any)
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async delete(id: string) {
        const supabase = getAdminDb()
        const { error } = await supabase
            .from('Quiz')
            .delete()
            .eq('id', id)

        if (error) throw error
    },

    async count(status?: string) {
        const supabase = await getDb()
        let query = supabase.from('Quiz').select('*', { count: 'exact', head: true })

        if (status) {
            query = query.eq('status', status)
        }

        const { count, error } = await query
        if (error) throw error
        return count || 0
    },
}

// ============================================================================
// QUESTION OPERATIONS
// ============================================================================

export const questionDb = {
    async findByQuizId(quizId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Question')
            .select('*')
            .eq('quizId', quizId)
            .order('createdAt', { ascending: true })

        if (error) throw error
        return data || []
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Question')
            .select('*')
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async create(questionData: Insertable<'Question'>) {
        const supabase = getAdminDb()
        const { data, error } = await supabase
            .from('Question')
            .insert({
                id: generateId(),
                ...questionData,
                updatedAt: new Date().toISOString()
            } as any)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async createMany(questions: Insertable<'Question'>[]) {
        const supabase = getAdminDb()
        const questionsWithIds = questions.map(q => ({
            id: generateId(),
            ...q,
            updatedAt: new Date().toISOString()
        }))

        const { data, error } = await supabase
            .from('Question')
            .insert(questionsWithIds as any)
            .select()

        if (error) throw error
        return data || []
    },

    async update(id: string, questionData: Updatable<'Question'>) {
        const supabase = getAdminDb()
        const { data, error } = await supabase
            .from('Question')
            .update({ ...questionData, updatedAt: new Date().toISOString() } as any)
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async delete(id: string) {
        const supabase = getAdminDb()
        const { error } = await supabase
            .from('Question')
            .delete()
            .eq('id', id)

        if (error) throw error
    },

    async setCorrectAnswer(id: string, correctOption: number) {
        const supabase = getAdminDb()
        const { data, error } = await supabase
            .from('Question')
            .update({
                correctOption,
                hasCorrectAnswer: true,
                updatedAt: new Date().toISOString()
            } as any)
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },
}

// ============================================================================
// QUIZ ATTEMPT OPERATIONS
// ============================================================================

export const quizAttemptDb = {
    async findByUserId(userId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('QuizAttempt')
            .select('*')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })

        if (error) throw error
        return data || []
    },

    async findByUserAndQuiz(userId: string, quizId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('QuizAttempt')
            .select('*')
            .eq('userId', userId)
            .eq('quizId', quizId)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('QuizAttempt')
            .select('*')
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findByIdWithAnswers(id: string) {
        const supabase = await getDb()
        const { data: attempt, error: attemptError } = await supabase
            .from('QuizAttempt')
            .select('*')
            .eq('id', id)
            .single()

        if (attemptError) throw attemptError
        if (!attempt) return null

        const { data: answers, error: answersError } = await supabase
            .from('Answer')
            .select('*')
            .eq('quizAttemptId', id)

        if (answersError) throw answersError

        return { ...attempt, answers: answers || [] }
    },

    async create(attemptData: Insertable<'QuizAttempt'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('QuizAttempt')
            .insert({ id: generateId(), ...attemptData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async update(id: string, attemptData: Updatable<'QuizAttempt'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('QuizAttempt')
            .update({ ...attemptData, updatedAt: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async complete(id: string, score: number, points: number) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('QuizAttempt')
            .update({
                score,
                points,
                isCompleted: true,
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },
}

// ============================================================================
// ANSWER OPERATIONS
// ============================================================================

export const answerDb = {
    async findByAttemptId(quizAttemptId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Answer')
            .select('*')
            .eq('quizAttemptId', quizAttemptId)

        if (error) throw error
        return data || []
    },

    async create(answerData: Insertable<'Answer'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Answer')
            .insert({ id: generateId(), ...answerData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async createMany(answers: Insertable<'Answer'>[]) {
        const supabase = await getDb()
        const answersWithIds = answers.map(a => ({ id: generateId(), ...a }))

        const { data, error } = await supabase
            .from('Answer')
            .insert(answersWithIds)
            .select()

        if (error) throw error
        return data || []
    },

    async updateCorrectness(questionId: string, correctOption: number) {
        const supabase = await getDb()

        // Get all answers for this question
        const { data: answers, error: fetchError } = await supabase
            .from('Answer')
            .select('id, selectedOption')
            .eq('questionId', questionId)

        if (fetchError) throw fetchError

        // Update each answer's correctness
        for (const answer of answers || []) {
            const isCorrect = answer.selectedOption === correctOption
            await supabase
                .from('Answer')
                .update({ isCorrect })
                .eq('id', answer.id)
        }
    },
}

// ============================================================================
// QUESTION ATTEMPT OPERATIONS
// ============================================================================

export const questionAttemptDb = {
    async findByUserAndQuiz(userId: string, quizId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('QuestionAttempt')
            .select('questionId')
            .eq('userId', userId)
            .eq('quizId', quizId)

        if (error) throw error
        return data || []
    },

    async createMany(attempts: Array<{
        userId: string;
        questionId: string;
        quizId: string;
        selectedOption: number;
        isCorrect: boolean;
        attemptedAt: Date;
    }>) {
        const supabase = await getDb()
        const attemptsWithIds = attempts.map(a => ({
            id: generateId(),
            userId: a.userId,
            questionId: a.questionId,
            quizId: a.quizId,
            selectedOption: a.selectedOption,
            isCorrect: a.isCorrect,
            attemptedAt: a.attemptedAt.toISOString(),
            createdAt: new Date().toISOString(),
        }))

        const { data, error } = await supabase
            .from('QuestionAttempt')
            .insert(attemptsWithIds)
            .select()

        if (error) throw error
        return data || []
    },
}
