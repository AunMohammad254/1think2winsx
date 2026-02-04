/**
 * Supabase Database Layer
 * Replaces Prisma ORM with type-safe Supabase client operations
 */

import { createClient } from './server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { Database, Insertable, Updatable } from './database.types'
import { createId } from '@paralleldrive/cuid2'

// Generate CUID for new records (matching Prisma's default)
export const generateId = () => createId()

/**
 * Get Supabase client for database operations
 * This is the main entry point for all database queries
 */
export async function getDb() {
    return await createClient()
}

/**
 * Get Supabase admin client with service_role key
 * This bypasses ALL RLS policies - use only for admin operations
 * Returns the same type as the regular client for type compatibility
 */
export function getAdminDb() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Missing Supabase configuration for admin client')
    }

    // Create admin client with Database type for proper typing
    return createAdminClient<Database>(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        },
        db: {
            schema: 'public'
        }
    })
}

// ============================================================================
// USER OPERATIONS
// ============================================================================

export const userDb = {
    async findByEmail(email: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .select('*')
            .eq('email', email)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .select('*')
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async create(userData: Insertable<'User'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .insert({ id: generateId(), ...userData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async update(id: string, userData: Updatable<'User'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .update({ ...userData, updatedAt: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async updateByEmail(email: string, userData: Updatable<'User'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .update({ ...userData, updatedAt: new Date().toISOString() })
            .eq('email', email)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async delete(id: string) {
        const supabase = await getDb()
        const { error } = await supabase
            .from('User')
            .delete()
            .eq('id', id)

        if (error) throw error
    },

    async count() {
        const supabase = await getDb()
        const { count, error } = await supabase
            .from('User')
            .select('*', { count: 'exact', head: true })

        if (error) throw error
        return count || 0
    },

    async getLeaderboard(limit = 10) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('User')
            .select('id, name, email, points, profilePicture')
            .order('points', { ascending: false })
            .limit(limit)

        if (error) throw error
        return data || []
    },

    async addPoints(id: string, points: number) {
        const supabase = await getDb()
        const { data: user, error: fetchError } = await supabase
            .from('User')
            .select('points')
            .eq('id', id)
            .single()

        if (fetchError) throw fetchError

        const { data, error } = await supabase
            .from('User')
            .update({
                points: (user?.points || 0) + points,
                updatedAt: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async updateWalletBalance(id: string, amount: number) {
        const supabase = await getDb()
        const { data: user, error: fetchError } = await supabase
            .from('User')
            .select('walletBalance')
            .eq('id', id)
            .single()

        if (fetchError) throw fetchError

        const { data, error } = await supabase
            .from('User')
            .update({
                walletBalance: (user?.walletBalance || 0) + amount,
                updatedAt: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async findByPhone(phone: string, normalizedPhone?: string) {
        const supabase = await getDb()

        // Build OR query for phone variations
        const phoneVariants = [phone]
        if (normalizedPhone && normalizedPhone !== phone) {
            phoneVariants.push(normalizedPhone)
        }
        if (phone.startsWith('0')) {
            phoneVariants.push('+92' + phone.slice(1))
        }
        if (phone.startsWith('+92')) {
            phoneVariants.push('0' + phone.slice(3))
        }

        const { data, error } = await supabase
            .from('User')
            .select('id, email, name')
            .in('phone', phoneVariants)
            .limit(1)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },
}

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

        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Quiz')
            .insert({
                id: generateId(),
                ...quizData,
                updatedAt: new Date().toISOString()
            })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async update(id: string, quizData: Updatable<'Quiz'>) {

        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Quiz')
            .update({ ...quizData, updatedAt: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async delete(id: string) {
        // Use admin client to bypass RLS for quiz deletion
        const supabase = await getDb()
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

        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Question')
            .insert({
                id: generateId(),
                ...questionData,
                updatedAt: new Date().toISOString()
            })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async createMany(questions: Insertable<'Question'>[]) {

        const supabase = await getDb()
        const questionsWithIds = questions.map(q => ({
            id: generateId(),
            ...q,
            updatedAt: new Date().toISOString()
        }))

        const { data, error } = await supabase
            .from('Question')
            .insert(questionsWithIds)
            .select()

        if (error) throw error
        return data || []
    },

    async update(id: string, questionData: Updatable<'Question'>) {
        // Use admin client to bypass RLS for question update
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Question')
            .update({ ...questionData, updatedAt: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async delete(id: string) {
        // Use admin client to bypass RLS for question deletion
        const supabase = await getDb()
        const { error } = await supabase
            .from('Question')
            .delete()
            .eq('id', id)

        if (error) throw error
    },

    async setCorrectAnswer(id: string, correctOption: number) {
        // Use admin client to bypass RLS for setting correct answer
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Question')
            .update({
                correctOption,
                hasCorrectAnswer: true,
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

// ============================================================================
// WALLET TRANSACTION OPERATIONS
// ============================================================================

export const walletTransactionDb = {
    async findByUserId(userId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .select('*')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })

        if (error) throw error
        return data || []
    },

    async findPending() {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .select('*')
            .eq('status', 'pending')
            .order('createdAt', { ascending: true })

        if (error) throw error
        return data || []
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .select('*')
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async create(transactionData: Insertable<'WalletTransaction'>) {
        const supabase = await getDb()
        const now = new Date().toISOString()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .insert({
                id: generateId(),
                createdAt: now,
                updatedAt: now,
                ...transactionData
            })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async approve(id: string, processedBy: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .update({
                status: 'approved',
                processedAt: new Date().toISOString(),
                processedBy,
                updatedAt: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async reject(id: string, processedBy: string, adminNotes?: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('WalletTransaction')
            .update({
                status: 'rejected',
                processedAt: new Date().toISOString(),
                processedBy,
                adminNotes,
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
// PRIZE OPERATIONS
// ============================================================================

export const prizeDb = {
    async findMany(options?: { isActive?: boolean, status?: string }) {
        const supabase = await getDb()
        let query = supabase.from('Prize').select('*')

        if (options?.isActive !== undefined) {
            query = query.eq('isActive', options.isActive)
        }
        if (options?.status) {
            query = query.eq('status', options.status)
        }

        query = query.order('pointsRequired', { ascending: true })

        const { data, error } = await query
        if (error) throw error
        return data || []
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Prize')
            .select('*')
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async create(prizeData: Insertable<'Prize'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Prize')
            .insert({ id: generateId(), ...prizeData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async update(id: string, prizeData: Updatable<'Prize'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('Prize')
            .update({ ...prizeData, updatedAt: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },

    async delete(id: string) {
        const supabase = await getDb()
        const { error } = await supabase
            .from('Prize')
            .delete()
            .eq('id', id)

        if (error) throw error
    },

    async decrementStock(id: string) {
        const supabase = await getDb()
        const { data: prize, error: fetchError } = await supabase
            .from('Prize')
            .select('stock')
            .eq('id', id)
            .single()

        if (fetchError) throw fetchError
        if (!prize || prize.stock <= 0) throw new Error('Prize out of stock')

        const { data, error } = await supabase
            .from('Prize')
            .update({
                stock: prize.stock - 1,
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
// PRIZE REDEMPTION OPERATIONS
// ============================================================================

export const prizeRedemptionDb = {
    async findByUserId(userId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PrizeRedemption')
            .select('*')
            .eq('userId', userId)
            .order('requestedAt', { ascending: false })

        if (error) throw error
        return data || []
    },

    async findPending() {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PrizeRedemption')
            .select('*')
            .eq('status', 'pending')
            .order('requestedAt', { ascending: true })

        if (error) throw error
        return data || []
    },

    async findById(id: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PrizeRedemption')
            .select(`
                *,
                User:userId (id, name, email, phone, points),
                Prize:prizeId (id, name, description, imageUrl, type, pointsRequired)
            `)
            .eq('id', id)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findAllAdmin(options?: { status?: string, page?: number, limit?: number }) {
        const supabase = await getDb()
        const page = options?.page || 1
        const limit = options?.limit || 20
        const offset = (page - 1) * limit

        let query = supabase
            .from('PrizeRedemption')
            .select(`
                *,
                User:userId (id, name, email, phone, points),
                Prize:prizeId (id, name, description, imageUrl, type, pointsRequired)
            `, { count: 'exact' })
            .order('requestedAt', { ascending: false })
            .range(offset, offset + limit - 1)

        if (options?.status && options.status !== 'all') {
            query = query.eq('status', options.status)
        }

        const { data, count, error } = await query

        if (error) throw error
        return {
            data: data || [],
            count: count || 0,
            page,
            limit,
            totalPages: Math.ceil((count || 0) / limit)
        }
    },

    async create(redemptionData: Insertable<'PrizeRedemption'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PrizeRedemption')
            .insert({ id: generateId(), ...redemptionData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async updateStatus(id: string, status: string, notes?: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('PrizeRedemption')
            .update({
                status,
                notes,
                processedAt: new Date().toISOString(),
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
// ADMIN SESSION OPERATIONS (Uses service_role client for admin privileges)
// ============================================================================


// Note: Uses the exported getAdminDb() function from the top of this file
// for creating admin client with service_role privileges

export const adminSessionDb = {
    async findByToken(token: string) {
        // Use admin client (service_role) to bypass RLS for admin session operations
        const supabase = getAdminDb()
        const { data, error } = await supabase
            .from('AdminSession')
            .select('*')
            .eq('token', token)
            .gt('expiresAt', new Date().toISOString())
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async create(sessionData: Insertable<'AdminSession'>) {
        // Use admin client (service_role) to bypass RLS for admin session operations
        const supabase = getAdminDb()
        const insertData = { id: generateId(), ...sessionData }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase.from('AdminSession') as any)
            .insert(insertData)
            .select()
            .single()

        if (error) throw error
        return data as Database['public']['Tables']['AdminSession']['Row']
    },

    async delete(token: string) {
        // Use admin client (service_role) to bypass RLS for admin session operations
        const supabase = getAdminDb()
        const { error } = await supabase
            .from('AdminSession')
            .delete()
            .eq('token', token)

        if (error) throw error
    },

    async deleteExpired() {
        // Use admin client (service_role) to bypass RLS for admin session operations
        const supabase = getAdminDb()
        const { error } = await supabase
            .from('AdminSession')
            .delete()
            .lt('expiresAt', new Date().toISOString())

        if (error) throw error
    },
}

// ============================================================================
// RATE LIMIT OPERATIONS
// ============================================================================

export const rateLimitDb = {
    async count(key: string, windowMs: number) {
        const supabase = getAdminDb()
        const windowStart = new Date(Date.now() - windowMs).toISOString()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { count, error } = await (supabase.from('RateLimitEntry') as any)
            .select('*', { count: 'exact', head: true })
            .eq('key', key)
            .gte('createdAt', windowStart)

        if (error) throw error
        return count || 0
    },

    async add(key: string) {
        const supabase = getAdminDb()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from('RateLimitEntry') as any)
            .insert({ id: generateId(), key })

        if (error) throw error
    },

    async cleanup(key: string, windowMs: number) {
        const supabase = getAdminDb()
        const windowStart = new Date(Date.now() - windowMs).toISOString()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from('RateLimitEntry') as any)
            .delete()
            .eq('key', key)
            .lt('createdAt', windowStart)

        if (error) throw error
    },
}

// ============================================================================
// SECURITY EVENT OPERATIONS
// ============================================================================

export const securityEventDb = {
    async create(eventData: Insertable<'SecurityEvent'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('SecurityEvent')
            .insert({ id: generateId(), ...eventData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async findRecent(limit = 100) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('SecurityEvent')
            .select('*')
            .order('timestamp', { ascending: false })
            .limit(limit)

        if (error) throw error
        return data || []
    },

    async countByType(type: string, since: Date) {
        const supabase = await getDb()
        const { count, error } = await supabase
            .from('SecurityEvent')
            .select('*', { count: 'exact', head: true })
            .eq('type', type)
            .gte('timestamp', since.toISOString())

        if (error) throw error
        return count || 0
    },
}

// ============================================================================
// DAILY PAYMENT OPERATIONS
// ============================================================================

export const dailyPaymentDb = {
    async findActiveByUserId(userId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('DailyPayment')
            .select('*')
            .eq('userId', userId)
            .eq('status', 'completed')
            .gt('expiresAt', new Date().toISOString())
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findFirstActive(userId: string) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('DailyPayment')
            .select('*')
            .eq('userId', userId)
            .eq('status', 'completed')
            .gt('expiresAt', new Date().toISOString())
            .order('expiresAt', { ascending: false })
            .limit(1)

        if (error) throw error
        return data?.[0] || null
    },

    async findMany(userId: string, limit = 10) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('DailyPayment')
            .select('id, amount, status, paymentMethod, expiresAt, createdAt')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })
            .limit(limit)

        if (error) throw error
        return data || []
    },

    async create(paymentData: Insertable<'DailyPayment'>) {
        const supabase = await getDb()
        const now = new Date().toISOString()
        const { data, error } = await supabase
            .from('DailyPayment')
            .insert({
                id: generateId(),
                createdAt: now,
                updatedAt: now,
                ...paymentData
            })
            .select()
            .single()

        if (error) throw error
        return data
    },
}

// ============================================================================
// STREAM CONFIGURATION OPERATIONS
// ============================================================================

export const streamConfigDb = {
    async findDefault() {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('StreamConfiguration')
            .select('*')
            .eq('isDefault', true)
            .single()

        if (error && error.code !== 'PGRST116') throw error
        return data
    },

    async findActive() {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('StreamConfiguration')
            .select('*')
            .eq('isActive', true)

        if (error) throw error
        return data || []
    },

    async findAll() {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('StreamConfiguration')
            .select('*')
            .order('createdAt', { ascending: false })

        if (error) throw error
        return data || []
    },

    async create(configData: Insertable<'StreamConfiguration'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('StreamConfiguration')
            .insert({ id: generateId(), ...configData })
            .select()
            .single()

        if (error) throw error
        return data
    },

    async update(id: string, configData: Updatable<'StreamConfiguration'>) {
        const supabase = await getDb()
        const { data, error } = await supabase
            .from('StreamConfiguration')
            .update({ ...configData, updatedAt: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single()

        if (error) throw error
        return data
    },
}

// Export all database modules
export const db = {
    user: userDb,
    quiz: quizDb,
    question: questionDb,
    quizAttempt: quizAttemptDb,
    answer: answerDb,
    walletTransaction: walletTransactionDb,
    prize: prizeDb,
    prizeRedemption: prizeRedemptionDb,
    adminSession: adminSessionDb,
    rateLimit: rateLimitDb,
    securityEvent: securityEventDb,
    dailyPayment: dailyPaymentDb,
    streamConfig: streamConfigDb,
}

export default db

