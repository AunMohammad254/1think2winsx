/**
 * Supabase Database Types
 * Generated from Prisma schema for type-safe database operations
 */

export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            User: {
                Row: {
                    id: string
                    name: string | null
                    email: string
                    password: string | null
                    phone: string | null
                    dateOfBirth: string | null
                    profilePicture: string | null
                    points: number
                    walletBalance: number
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    name?: string | null
                    email: string
                    password?: string | null
                    phone?: string | null
                    dateOfBirth?: string | null
                    profilePicture?: string | null
                    points?: number
                    walletBalance?: number
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    name?: string | null
                    email?: string
                    password?: string | null
                    phone?: string | null
                    dateOfBirth?: string | null
                    profilePicture?: string | null
                    points?: number
                    walletBalance?: number
                    createdAt?: string
                    updatedAt?: string
                }
            }
            Quiz: {
                Row: {
                    id: string
                    title: string
                    description: string | null
                    duration: number
                    passingScore: number
                    accessPrice: number
                    status: string
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    title: string
                    description?: string | null
                    duration?: number
                    passingScore?: number
                    accessPrice?: number
                    status?: string
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    title?: string
                    description?: string | null
                    duration?: number
                    passingScore?: number
                    accessPrice?: number
                    status?: string
                    createdAt?: string
                    updatedAt?: string
                }
            }
            Question: {
                Row: {
                    id: string
                    quizId: string
                    text: string
                    options: string
                    correctOption: number | null
                    hasCorrectAnswer: boolean
                    status: string
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    quizId: string
                    text: string
                    options: string
                    correctOption?: number | null
                    hasCorrectAnswer?: boolean
                    status?: string
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    quizId?: string
                    text?: string
                    options?: string
                    correctOption?: number | null
                    hasCorrectAnswer?: boolean
                    status?: string
                    createdAt?: string
                    updatedAt?: string
                }
            }
            QuizAttempt: {
                Row: {
                    id: string
                    userId: string
                    quizId: string
                    score: number
                    points: number
                    isCompleted: boolean
                    isEvaluated: boolean
                    completedAt: string | null
                    paymentId: string | null
                    dailyPaymentId: string | null
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    userId: string
                    quizId: string
                    score?: number
                    points?: number
                    isCompleted?: boolean
                    isEvaluated?: boolean
                    completedAt?: string | null
                    paymentId?: string | null
                    dailyPaymentId?: string | null
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    userId?: string
                    quizId?: string
                    score?: number
                    points?: number
                    isCompleted?: boolean
                    isEvaluated?: boolean
                    completedAt?: string | null
                    paymentId?: string | null
                    dailyPaymentId?: string | null
                    createdAt?: string
                    updatedAt?: string
                }
            }
            Answer: {
                Row: {
                    id: string
                    userId: string
                    questionId: string
                    quizAttemptId: string
                    selectedOption: number
                    isCorrect: boolean | null
                    createdAt: string
                }
                Insert: {
                    id?: string
                    userId: string
                    questionId: string
                    quizAttemptId: string
                    selectedOption: number
                    isCorrect?: boolean | null
                    createdAt?: string
                }
                Update: {
                    id?: string
                    userId?: string
                    questionId?: string
                    quizAttemptId?: string
                    selectedOption?: number
                    isCorrect?: boolean | null
                    createdAt?: string
                }
            }
            QuestionAttempt: {
                Row: {
                    id: string
                    userId: string
                    questionId: string
                    quizId: string
                    selectedOption: number
                    isCorrect: boolean | null
                    attemptedAt: string
                }
                Insert: {
                    id?: string
                    userId: string
                    questionId: string
                    quizId: string
                    selectedOption: number
                    isCorrect?: boolean | null
                    attemptedAt?: string
                }
                Update: {
                    id?: string
                    userId?: string
                    questionId?: string
                    quizId?: string
                    selectedOption?: number
                    isCorrect?: boolean | null
                    attemptedAt?: string
                }
            }
            Payment: {
                Row: {
                    id: string
                    userId: string
                    amount: number
                    status: string
                    paymentMethod: string | null
                    transactionId: string | null
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    userId: string
                    amount: number
                    status: string
                    paymentMethod?: string | null
                    transactionId?: string | null
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    userId?: string
                    amount?: number
                    status?: string
                    paymentMethod?: string | null
                    transactionId?: string | null
                    createdAt?: string
                    updatedAt?: string
                }
            }
            Prize: {
                Row: {
                    id: string
                    name: string
                    description: string | null
                    imageUrl: string | null
                    modelUrl: string | null
                    type: string
                    pointsRequired: number
                    isActive: boolean
                    category: string
                    stock: number
                    status: string
                    value: number
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    name: string
                    description?: string | null
                    imageUrl?: string | null
                    modelUrl?: string | null
                    type: string
                    pointsRequired: number
                    isActive?: boolean
                    category?: string
                    stock?: number
                    status?: string
                    value?: number
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    name?: string
                    description?: string | null
                    imageUrl?: string | null
                    modelUrl?: string | null
                    type?: string
                    pointsRequired?: number
                    isActive?: boolean
                    category?: string
                    stock?: number
                    status?: string
                    value?: number
                    createdAt?: string
                    updatedAt?: string
                }
            }
            Winning: {
                Row: {
                    id: string
                    userId: string
                    quizId: string
                    prizeId: string
                    claimed: boolean
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    userId: string
                    quizId: string
                    prizeId: string
                    claimed?: boolean
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    userId?: string
                    quizId?: string
                    prizeId?: string
                    claimed?: boolean
                    createdAt?: string
                    updatedAt?: string
                }
            }
            PrizeRedemption: {
                Row: {
                    id: string
                    userId: string
                    prizeId: string
                    pointsUsed: number
                    status: string
                    fullName: string | null
                    whatsappNumber: string | null
                    address: string | null
                    requestedAt: string
                    processedAt: string | null
                    notes: string | null
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    userId: string
                    prizeId: string
                    pointsUsed: number
                    status: string
                    fullName?: string | null
                    whatsappNumber?: string | null
                    address?: string | null
                    requestedAt?: string
                    processedAt?: string | null
                    notes?: string | null
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    userId?: string
                    prizeId?: string
                    pointsUsed?: number
                    status?: string
                    fullName?: string | null
                    whatsappNumber?: string | null
                    address?: string | null
                    requestedAt?: string
                    processedAt?: string | null
                    notes?: string | null
                    createdAt?: string
                    updatedAt?: string
                }
            }
            RateLimitEntry: {
                Row: {
                    id: string
                    key: string
                    createdAt: string
                }
                Insert: {
                    id?: string
                    key: string
                    createdAt?: string
                }
                Update: {
                    id?: string
                    key?: string
                    createdAt?: string
                }
            }
            SecurityEvent: {
                Row: {
                    id: string
                    type: string
                    userId: string | null
                    ip: string | null
                    userAgent: string | null
                    endpoint: string | null
                    details: string | null
                    severity: string | null
                    timestamp: string
                    createdAt: string
                }
                Insert: {
                    id?: string
                    type: string
                    userId?: string | null
                    ip?: string | null
                    userAgent?: string | null
                    endpoint?: string | null
                    details?: string | null
                    severity?: string | null
                    timestamp?: string
                    createdAt?: string
                }
                Update: {
                    id?: string
                    type?: string
                    userId?: string | null
                    ip?: string | null
                    userAgent?: string | null
                    endpoint?: string | null
                    details?: string | null
                    severity?: string | null
                    timestamp?: string
                    createdAt?: string
                }
            }
            DailyPayment: {
                Row: {
                    id: string
                    userId: string
                    amount: number
                    status: string
                    paymentMethod: string | null
                    transactionId: string | null
                    expiresAt: string
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    userId: string
                    amount?: number
                    status: string
                    paymentMethod?: string | null
                    transactionId?: string | null
                    expiresAt: string
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    userId?: string
                    amount?: number
                    status?: string
                    paymentMethod?: string | null
                    transactionId?: string | null
                    expiresAt?: string
                    createdAt?: string
                    updatedAt?: string
                }
            }
            StreamConfiguration: {
                Row: {
                    id: string
                    name: string
                    facebookPageId: string
                    accessToken: string
                    streamKey: string | null
                    isActive: boolean
                    isDefault: boolean
                    quality: string
                    autoReconnect: boolean
                    maxReconnectAttempts: number
                    reconnectDelay: number
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    name: string
                    facebookPageId: string
                    accessToken: string
                    streamKey?: string | null
                    isActive?: boolean
                    isDefault?: boolean
                    quality?: string
                    autoReconnect?: boolean
                    maxReconnectAttempts?: number
                    reconnectDelay?: number
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    name?: string
                    facebookPageId?: string
                    accessToken?: string
                    streamKey?: string | null
                    isActive?: boolean
                    isDefault?: boolean
                    quality?: string
                    autoReconnect?: boolean
                    maxReconnectAttempts?: number
                    reconnectDelay?: number
                    createdAt?: string
                    updatedAt?: string
                }
            }
            StreamSession: {
                Row: {
                    id: string
                    streamConfigurationId: string
                    facebookLiveVideoId: string | null
                    status: string
                    startedAt: string | null
                    endedAt: string | null
                    errorMessage: string | null
                    reconnectAttempts: number
                    viewerCount: number
                    peakViewerCount: number
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    streamConfigurationId: string
                    facebookLiveVideoId?: string | null
                    status: string
                    startedAt?: string | null
                    endedAt?: string | null
                    errorMessage?: string | null
                    reconnectAttempts?: number
                    viewerCount?: number
                    peakViewerCount?: number
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    streamConfigurationId?: string
                    facebookLiveVideoId?: string | null
                    status?: string
                    startedAt?: string | null
                    endedAt?: string | null
                    errorMessage?: string | null
                    reconnectAttempts?: number
                    viewerCount?: number
                    peakViewerCount?: number
                    createdAt?: string
                    updatedAt?: string
                }
            }
            StreamMetrics: {
                Row: {
                    id: string
                    streamConfigurationId: string
                    sessionId: string | null
                    metricType: string
                    value: number
                    metadata: string | null
                    timestamp: string
                }
                Insert: {
                    id?: string
                    streamConfigurationId: string
                    sessionId?: string | null
                    metricType: string
                    value: number
                    metadata?: string | null
                    timestamp?: string
                }
                Update: {
                    id?: string
                    streamConfigurationId?: string
                    sessionId?: string | null
                    metricType?: string
                    value?: number
                    metadata?: string | null
                    timestamp?: string
                }
            }
            WalletTransaction: {
                Row: {
                    id: string
                    userId: string
                    amount: number
                    paymentMethod: string
                    transactionId: string
                    status: string
                    proofImage: string | null
                    adminNotes: string | null
                    processedAt: string | null
                    processedBy: string | null
                    createdAt: string
                    updatedAt: string
                }
                Insert: {
                    id?: string
                    userId: string
                    amount: number
                    paymentMethod: string
                    transactionId: string
                    status?: string
                    proofImage?: string | null
                    adminNotes?: string | null
                    processedAt?: string | null
                    processedBy?: string | null
                    createdAt?: string
                    updatedAt?: string
                }
                Update: {
                    id?: string
                    userId?: string
                    amount?: number
                    paymentMethod?: string
                    transactionId?: string
                    status?: string
                    proofImage?: string | null
                    adminNotes?: string | null
                    processedAt?: string | null
                    processedBy?: string | null
                    createdAt?: string
                    updatedAt?: string
                }
            }
            AdminSession: {
                Row: {
                    id: string
                    token: string
                    email: string
                    expiresAt: string
                    createdAt: string
                }
                Insert: {
                    id?: string
                    token: string
                    email: string
                    expiresAt: string
                    createdAt?: string
                }
                Update: {
                    id?: string
                    token?: string
                    email?: string
                    expiresAt?: string
                    createdAt?: string
                }
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            [_ in never]: never
        }
    }
}

// Helper types for easier use
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type Insertable<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type Updatable<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']

// Convenience type aliases
export type User = Tables<'User'>
export type Quiz = Tables<'Quiz'>
export type Question = Tables<'Question'>
export type QuizAttempt = Tables<'QuizAttempt'>
export type Answer = Tables<'Answer'>
export type QuestionAttempt = Tables<'QuestionAttempt'>
export type Payment = Tables<'Payment'>
export type Prize = Tables<'Prize'>
export type Winning = Tables<'Winning'>
export type PrizeRedemption = Tables<'PrizeRedemption'>
export type RateLimitEntry = Tables<'RateLimitEntry'>
export type SecurityEvent = Tables<'SecurityEvent'>
export type DailyPayment = Tables<'DailyPayment'>
export type StreamConfiguration = Tables<'StreamConfiguration'>
export type StreamSession = Tables<'StreamSession'>
export type StreamMetrics = Tables<'StreamMetrics'>
export type WalletTransaction = Tables<'WalletTransaction'>
export type AdminSession = Tables<'AdminSession'>
