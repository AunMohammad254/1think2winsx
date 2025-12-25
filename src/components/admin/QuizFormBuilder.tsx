'use client';

import { useState, useEffect, useCallback } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Trash2, GripVertical, Check, X, Save, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import {
    QuizFormSchema,
    QuizFormData,
    QuestionFormData,
    defaultQuestion,
    defaultQuiz
} from '@/lib/schemas/QuizFormSchema';
import { createQuiz, updateQuiz } from '@/actions/quiz-actions';

interface QuizFormBuilderProps {
    initialData?: QuizFormData;
    onSuccess?: (id?: string) => void;
    onCancel?: () => void;
}

const difficultyOptions = [
    { value: 'easy', label: 'Easy', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    { value: 'medium', label: 'Medium', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
    { value: 'hard', label: 'Hard', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
];

const statusOptions = [
    { value: 'draft', label: 'Draft', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
    { value: 'active', label: 'Published', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
    { value: 'paused', label: 'Paused', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
];

export default function QuizFormBuilder({ initialData, onSuccess, onCancel }: QuizFormBuilderProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [expandedQuestions, setExpandedQuestions] = useState<number[]>([0]);

    const isEditing = !!initialData?.id;

    const {
        register,
        control,
        handleSubmit,
        watch,
        setValue,
        formState: { errors, isDirty },
    } = useForm<QuizFormData>({
        resolver: zodResolver(QuizFormSchema),
        defaultValues: initialData || defaultQuiz,
    });

    const { fields: questionFields, append: appendQuestion, remove: removeQuestion, move: moveQuestion } = useFieldArray({
        control,
        name: 'questions',
    });

    const watchedQuestions = watch('questions');

    // Toggle question expansion
    const toggleQuestion = useCallback((index: number) => {
        setExpandedQuestions(prev =>
            prev.includes(index)
                ? prev.filter(i => i !== index)
                : [...prev, index]
        );
    }, []);

    // Add new question
    const handleAddQuestion = useCallback(() => {
        appendQuestion(defaultQuestion);
        setExpandedQuestions(prev => [...prev, questionFields.length]);
    }, [appendQuestion, questionFields.length]);

    // Remove question
    const handleRemoveQuestion = useCallback((index: number) => {
        if (questionFields.length > 1) {
            removeQuestion(index);
            setExpandedQuestions(prev => prev.filter(i => i !== index).map(i => i > index ? i - 1 : i));
        } else {
            toast.error('Quiz must have at least one question');
        }
    }, [removeQuestion, questionFields.length]);

    // Move question up/down
    const handleMoveQuestion = useCallback((index: number, direction: 'up' | 'down') => {
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex >= 0 && newIndex < questionFields.length) {
            moveQuestion(index, newIndex);
        }
    }, [moveQuestion, questionFields.length]);

    // Set correct answer for a question
    const setCorrectAnswer = useCallback((questionIndex: number, optionIndex: number) => {
        const currentOptions = watchedQuestions[questionIndex]?.options || [];
        const updatedOptions = currentOptions.map((opt, idx) => ({
            ...opt,
            isCorrect: idx === optionIndex,
        }));
        setValue(`questions.${questionIndex}.options`, updatedOptions, { shouldDirty: true });
        setValue(`questions.${questionIndex}.correctOption`, optionIndex, { shouldDirty: true });
    }, [watchedQuestions, setValue]);

    // Add option to a question
    const addOption = useCallback((questionIndex: number) => {
        const currentOptions = watchedQuestions[questionIndex]?.options || [];
        if (currentOptions.length < 6) {
            setValue(`questions.${questionIndex}.options`, [
                ...currentOptions,
                { text: '', isCorrect: false },
            ], { shouldDirty: true });
        } else {
            toast.error('Maximum 6 options allowed per question');
        }
    }, [watchedQuestions, setValue]);

    // Remove option from a question
    const removeOption = useCallback((questionIndex: number, optionIndex: number) => {
        const currentOptions = watchedQuestions[questionIndex]?.options || [];
        if (currentOptions.length > 2) {
            const updatedOptions = currentOptions.filter((_, idx) => idx !== optionIndex);
            // If we removed the correct answer, clear the correct answer
            if (currentOptions[optionIndex]?.isCorrect) {
                updatedOptions.forEach(opt => opt.isCorrect = false);
            }
            setValue(`questions.${questionIndex}.options`, updatedOptions, { shouldDirty: true });
        } else {
            toast.error('Minimum 2 options required');
        }
    }, [watchedQuestions, setValue]);

    // Form submission
    const onSubmit = async (data: QuizFormData) => {
        setIsSubmitting(true);
        try {
            const result = isEditing
                ? await updateQuiz(data)
                : await createQuiz(data);

            if (result.success) {
                toast.success(result.message || (isEditing ? 'Quiz updated!' : 'Quiz created!'));
                onSuccess?.('data' in result ? result.data?.id : undefined);
            } else {
                toast.error(result.error);
            }
        } catch (error) {
            console.error('Form submission error:', error);
            toast.error('An unexpected error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Warn before leaving with unsaved changes
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty]);

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            {/* Quiz Basic Info */}
            <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
                <h2 className="text-xl font-bold text-white mb-6">Quiz Details</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Title */}
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Quiz Title <span className="text-red-400">*</span>
                        </label>
                        <input
                            {...register('title')}
                            className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                            placeholder="Enter quiz title"
                        />
                        {errors.title && (
                            <p className="mt-1 text-sm text-red-400">{errors.title.message}</p>
                        )}
                    </div>

                    {/* Description */}
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Description
                        </label>
                        <textarea
                            {...register('description')}
                            rows={3}
                            className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all resize-none"
                            placeholder="Enter quiz description (optional)"
                        />
                    </div>

                    {/* Duration */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Duration (minutes) <span className="text-red-400">*</span>
                        </label>
                        <input
                            type="number"
                            {...register('duration', { valueAsNumber: true })}
                            min={1}
                            max={180}
                            className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                        />
                        {errors.duration && (
                            <p className="mt-1 text-sm text-red-400">{errors.duration.message}</p>
                        )}
                    </div>

                    {/* Passing Score */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Passing Score (%) <span className="text-red-400">*</span>
                        </label>
                        <input
                            type="number"
                            {...register('passingScore', { valueAsNumber: true })}
                            min={0}
                            max={100}
                            className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                        />
                        {errors.passingScore && (
                            <p className="mt-1 text-sm text-red-400">{errors.passingScore.message}</p>
                        )}
                    </div>

                    {/* Access Price */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Access Price (PKR) <span className="text-red-400">*</span>
                        </label>
                        <div className="relative">
                            <input
                                type="number"
                                {...register('accessPrice', { valueAsNumber: true })}
                                min={0.5}
                                max={1000}
                                step={0.5}
                                className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                                placeholder="2"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">PKR</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">Price users pay for 24-hour quiz access</p>
                        {errors.accessPrice && (
                            <p className="mt-1 text-sm text-red-400">{errors.accessPrice.message}</p>
                        )}
                    </div>

                    {/* Difficulty */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Difficulty
                        </label>
                        <Controller
                            name="difficulty"
                            control={control}
                            render={({ field }) => (
                                <div className="flex gap-2">
                                    {difficultyOptions.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => field.onChange(option.value)}
                                            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-all ${field.value === option.value
                                                ? option.color
                                                : 'bg-gray-800/50 text-gray-400 border-white/5 hover:border-white/10'
                                                }`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        />
                    </div>

                    {/* Status */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Status
                        </label>
                        <Controller
                            name="status"
                            control={control}
                            render={({ field }) => (
                                <div className="flex gap-2">
                                    {statusOptions.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => field.onChange(option.value)}
                                            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-all ${field.value === option.value
                                                ? option.color
                                                : 'bg-gray-800/50 text-gray-400 border-white/5 hover:border-white/10'
                                                }`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        />
                    </div>
                </div>
            </div>

            {/* Questions Section */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">
                        Questions ({questionFields.length})
                    </h2>
                    <button
                        type="button"
                        onClick={handleAddQuestion}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-500 transition-colors"
                    >
                        <Plus className="w-5 h-5" />
                        Add Question
                    </button>
                </div>

                {errors.questions?.message && (
                    <p className="text-sm text-red-400">{errors.questions.message}</p>
                )}

                {/* Question Cards */}
                {questionFields.map((field, questionIndex) => {
                    const isExpanded = expandedQuestions.includes(questionIndex);
                    const questionErrors = errors.questions?.[questionIndex];
                    const currentQuestion = watchedQuestions[questionIndex];

                    return (
                        <div
                            key={field.id}
                            className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden"
                        >
                            {/* Question Header */}
                            <div
                                className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5 transition-colors"
                                onClick={() => toggleQuestion(questionIndex)}
                            >
                                <div className="flex items-center gap-3">
                                    <GripVertical className="w-5 h-5 text-gray-500" />
                                    <span className="text-white font-medium">
                                        Question {questionIndex + 1}
                                    </span>
                                    {currentQuestion?.text && (
                                        <span className="text-gray-400 text-sm truncate max-w-xs">
                                            — {currentQuestion.text}
                                        </span>
                                    )}
                                    {questionErrors && (
                                        <span className="px-2 py-0.5 text-xs bg-red-500/20 text-red-400 rounded-full">
                                            Has errors
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleMoveQuestion(questionIndex, 'up'); }}
                                        disabled={questionIndex === 0}
                                        className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronUp className="w-4 h-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleMoveQuestion(questionIndex, 'down'); }}
                                        disabled={questionIndex === questionFields.length - 1}
                                        className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronDown className="w-4 h-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handleRemoveQuestion(questionIndex); }}
                                        className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                    {isExpanded ? (
                                        <ChevronUp className="w-5 h-5 text-gray-400" />
                                    ) : (
                                        <ChevronDown className="w-5 h-5 text-gray-400" />
                                    )}
                                </div>
                            </div>

                            {/* Question Content */}
                            {isExpanded && (
                                <div className="p-6 pt-0 space-y-6">
                                    {/* Question Text */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-300 mb-2">
                                            Question Text <span className="text-red-400">*</span>
                                        </label>
                                        <textarea
                                            {...register(`questions.${questionIndex}.text`)}
                                            rows={2}
                                            className="w-full px-4 py-3 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all resize-none"
                                            placeholder="Enter your question"
                                        />
                                        {questionErrors?.text && (
                                            <p className="mt-1 text-sm text-red-400">{questionErrors.text.message}</p>
                                        )}
                                    </div>

                                    {/* Options */}
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <label className="text-sm font-medium text-gray-300">
                                                Answer Options <span className="text-red-400">*</span>
                                            </label>
                                            <span className="text-xs text-gray-500">
                                                Click the check to mark correct answer
                                            </span>
                                        </div>

                                        <div className="space-y-3">
                                            {currentQuestion?.options?.map((option, optionIndex) => (
                                                <div key={optionIndex} className="flex items-center gap-3">
                                                    {/* Correct Answer Toggle */}
                                                    <button
                                                        type="button"
                                                        onClick={() => setCorrectAnswer(questionIndex, optionIndex)}
                                                        className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all ${option.isCorrect
                                                            ? 'bg-green-500 text-white'
                                                            : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                                                            }`}
                                                    >
                                                        <Check className="w-4 h-4" />
                                                    </button>

                                                    {/* Option Input */}
                                                    <input
                                                        {...register(`questions.${questionIndex}.options.${optionIndex}.text`)}
                                                        className="flex-1 px-4 py-2.5 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                                                        placeholder={`Option ${optionIndex + 1}`}
                                                    />

                                                    {/* Remove Option */}
                                                    <button
                                                        type="button"
                                                        onClick={() => removeOption(questionIndex, optionIndex)}
                                                        className="flex-shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>

                                        {currentQuestion?.options && currentQuestion.options.length < 6 && (
                                            <button
                                                type="button"
                                                onClick={() => addOption(questionIndex)}
                                                className="mt-3 flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 transition-colors"
                                            >
                                                <Plus className="w-4 h-4" />
                                                Add Option
                                            </button>
                                        )}

                                        {questionErrors?.options && (
                                            <p className="mt-2 text-sm text-red-400">
                                                {typeof questionErrors.options === 'string'
                                                    ? questionErrors.options
                                                    : questionErrors.options.message}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Form Actions */}
            <div className="flex items-center justify-between pt-6 border-t border-white/10">
                <div className="text-sm text-gray-400">
                    {isDirty && 'You have unsaved changes'}
                </div>
                <div className="flex gap-3">
                    {onCancel && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-6 py-3 rounded-xl font-medium text-gray-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
                        >
                            Cancel
                        </button>
                    )}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                {isEditing ? 'Updating...' : 'Creating...'}
                            </>
                        ) : (
                            <>
                                <Save className="w-5 h-5" />
                                {isEditing ? 'Update Quiz' : 'Create Quiz'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </form>
    );
}
