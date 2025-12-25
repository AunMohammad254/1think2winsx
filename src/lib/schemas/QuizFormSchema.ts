import { z } from 'zod';

// ============================================
// Option Schema
// ============================================
export const OptionSchema = z.object({
    id: z.string().optional(),
    text: z.string().min(1, 'Option text is required').max(500, 'Option too long'),
    isCorrect: z.boolean().default(false),
});

export type OptionFormData = z.infer<typeof OptionSchema>;

// ============================================
// Question Schema
// ============================================
export const QuestionSchema = z.object({
    id: z.string().optional(),
    text: z.string()
        .min(5, 'Question must be at least 5 characters')
        .max(1000, 'Question too long (max 1000 characters)'),
    options: z.array(OptionSchema)
        .min(2, 'At least 2 options required')
        .max(6, 'Maximum 6 options allowed'),
    correctOption: z.number().optional(),
    status: z.enum(['active', 'paused']).default('active'),
});

export type QuestionFormData = z.infer<typeof QuestionSchema>;

// ============================================
// Quiz Schema
// ============================================
export const QuizFormSchema = z.object({
    id: z.string().optional(),
    title: z.string()
        .min(3, 'Title must be at least 3 characters')
        .max(200, 'Title too long (max 200 characters)'),
    description: z.string().max(1000, 'Description too long').optional().nullable(),
    duration: z.number()
        .min(1, 'Duration must be at least 1 minute')
        .max(180, 'Duration cannot exceed 180 minutes'),
    passingScore: z.number()
        .min(0, 'Passing score must be 0 or higher')
        .max(100, 'Passing score cannot exceed 100'),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
    status: z.enum(['draft', 'active', 'paused']).default('draft'),
    questions: z.array(QuestionSchema)
        .min(1, 'At least 1 question required'),
});

export type QuizFormData = z.infer<typeof QuizFormSchema>;

// ============================================
// Server Action Input Schemas
// ============================================
export const CreateQuizInputSchema = QuizFormSchema.omit({ id: true });
export const UpdateQuizInputSchema = QuizFormSchema;

export type CreateQuizInput = z.infer<typeof CreateQuizInputSchema>;
export type UpdateQuizInput = z.infer<typeof UpdateQuizInputSchema>;

// ============================================
// Quiz Attempt Schemas
// ============================================
export const AnswerSubmissionSchema = z.object({
    questionId: z.string(),
    selectedOption: z.number().min(0),
});

export const QuizSubmissionSchema = z.object({
    quizId: z.string(),
    answers: z.array(AnswerSubmissionSchema).min(1, 'At least 1 answer required'),
});

export type AnswerSubmission = z.infer<typeof AnswerSubmissionSchema>;
export type QuizSubmission = z.infer<typeof QuizSubmissionSchema>;

// ============================================
// Validation Helpers
// ============================================
export function validateQuizForm(data: unknown): { success: true; data: QuizFormData } |
    { success: false; errors: z.ZodError['errors'] } {
    const result = QuizFormSchema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, errors: result.error.errors };
}

export function validateQuizSubmission(data: unknown): { success: true; data: QuizSubmission } |
    { success: false; errors: z.ZodError['errors'] } {
    const result = QuizSubmissionSchema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, errors: result.error.errors };
}

// ============================================
// Default Values
// ============================================
export const defaultOption: OptionFormData = {
    text: '',
    isCorrect: false,
};

export const defaultQuestion: QuestionFormData = {
    text: '',
    options: [
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
    ],
    status: 'active',
};

export const defaultQuiz: QuizFormData = {
    title: '',
    description: '',
    duration: 30,
    passingScore: 70,
    difficulty: 'medium',
    status: 'draft',
    questions: [defaultQuestion],
};
