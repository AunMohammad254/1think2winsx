'use client';

import { useState, useEffect, useCallback } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
    QuizFormSchema,
    QuizFormData,
    defaultQuestion,
    defaultQuiz
} from '@/lib/schemas/QuizFormSchema';
import { createQuiz, updateQuiz } from '@/actions/quiz-actions';
import { isTimedStatus } from './quiz-form/constants';
import QuizDetailsSection from './quiz-form/QuizDetailsSection';
import PrizeLinkSection, { type PrizeOption } from './quiz-form/PrizeLinkSection';
import QuestionCard from './quiz-form/QuestionCard';
import FormErrorSummary from './quiz-form/FormErrorSummary';
import FormActions from './quiz-form/FormActions';

interface QuizFormBuilderProps {
    initialData?: QuizFormData;
    onSuccess?: (id?: string) => void;
    onCancel?: () => void;
}

export default function QuizFormBuilder({ initialData, onSuccess, onCancel }: QuizFormBuilderProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [expandedQuestions, setExpandedQuestions] = useState<number[]>([0]);
    const [showPrizeSection, setShowPrizeSection] = useState(!!initialData?.prizeId);
    const [prizes, setPrizes] = useState<PrizeOption[]>([]);
    const [walletEnabled, setWalletEnabled] = useState(true);

    const isEditing = !!initialData?.id;

    const {
        register,
        control,
        handleSubmit,
        watch,
        setValue,
        formState: { errors, isDirty },
    } = useForm<QuizFormData>({
        resolver: zodResolver(QuizFormSchema) as any,
        defaultValues: initialData
            ? {
                ...initialData,
                startsAt: initialData.startsAt
                    ? new Date(new Date(initialData.startsAt).getTime() - new Date(initialData.startsAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                    : null
              }
            : defaultQuiz,
    });

    const { fields: questionFields, append: appendQuestion, remove: removeQuestion, move: moveQuestion } = useFieldArray({
        control,
        name: 'questions',
    });

    const watchedQuestions = watch('questions');
    const watchedStatus = watch('status');
    const watchedPrizeId = watch('prizeId');
    const watchedQuizType = watch('quizType');

    useEffect(() => {
        if (showPrizeSection && prizes.length === 0) {
            fetch('/api/prizes')
                .then(r => r.ok ? r.json() : { data: [] })
                .then(d => setPrizes(d.data || d.prizes || []))
                .catch(() => {});
        }
    }, [showPrizeSection, prizes.length]);

    // Fetch wallet enabled status
    useEffect(() => {
        fetch('/api/settings/wallet-enabled')
            .then(res => res.json())
            .then(data => setWalletEnabled(data.walletEnabled))
            .catch(console.error);
    }, []);

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
    // Up is disabled on the first question and Down on the last
    const handleMoveQuestion = useCallback((index: number, direction: 'up' | 'down') => {
        moveQuestion(index, direction === 'up' ? index - 1 : index + 1);
    }, [moveQuestion]);

    // Set correct answer for a question
    const setCorrectAnswer = useCallback((questionIndex: number, optionIndex: number) => {
        const currentOptions = watchedQuestions[questionIndex].options;
        const updatedOptions = currentOptions.map((opt, idx) => ({
            ...opt,
            isCorrect: idx === optionIndex,
        }));
        setValue(`questions.${questionIndex}.options`, updatedOptions, { shouldDirty: true });
        setValue(`questions.${questionIndex}.correctOption`, optionIndex, { shouldDirty: true });
    }, [watchedQuestions, setValue]);

    // Add option to a question
    // The Add Option button is hidden once a question has 6 options
    const addOption = useCallback((questionIndex: number) => {
        const currentOptions = watchedQuestions[questionIndex].options;
        setValue(`questions.${questionIndex}.options`, [
            ...currentOptions,
            { text: '', isCorrect: false },
        ], { shouldDirty: true });
    }, [watchedQuestions, setValue]);

    // Remove option from a question
    const removeOption = useCallback((questionIndex: number, optionIndex: number) => {
        const currentOptions = watchedQuestions[questionIndex].options;
        if (currentOptions.length > 2) {
            const updatedOptions = currentOptions.filter((_, idx) => idx !== optionIndex);
            setValue(`questions.${questionIndex}.options`, updatedOptions, { shouldDirty: true });
            // Keep correctOption pointing at the same answer: clear it if that answer was removed,
            // and shift it down when an option before it was removed
            const correct = watchedQuestions[questionIndex].correctOption;
            if (correct === optionIndex) {
                setValue(`questions.${questionIndex}.correctOption`, null, { shouldDirty: true });
            } else if (correct != null && correct > optionIndex) {
                setValue(`questions.${questionIndex}.correctOption`, correct - 1, { shouldDirty: true });
            }
        } else {
            toast.error('Minimum 2 options required');
        }
    }, [watchedQuestions, setValue]);

    // Form submission
    const onSubmit = async (data: QuizFormData) => {
        setIsSubmitting(true);
        try {
            // Clean up startsAt unless the quiz is still waiting to go live
            const payload = {
                ...data,
                // The picker yields a zone-less local time ("2026-12-01T16:30"). Convert it to an
                // absolute instant HERE, in the admin's browser: if the server parsed it, it would
                // read it in the server's timezone (UTC) and shift the quiz by the viewer's offset.
                startsAt: isTimedStatus(data.status) && data.startsAt
                    ? new Date(data.startsAt).toISOString()
                    : null,
                accessPrice: walletEnabled ? data.accessPrice : 0,
            };
            const result = isEditing
                ? await updateQuiz(payload)
                : await createQuiz(payload);

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
            <QuizDetailsSection
                control={control}
                register={register}
                watch={watch}
                setValue={setValue}
                errors={errors}
                walletEnabled={walletEnabled}
                watchedStatus={watchedStatus}
            />

            {/* Prize Link Section (optional, collapsible) */}
            <PrizeLinkSection
                control={control}
                isOpen={showPrizeSection}
                onToggle={() => setShowPrizeSection(prev => !prev)}
                prizes={prizes}
                watchedPrizeId={watchedPrizeId}
            />

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

                {questionFields.map((field, questionIndex) => (
                    <QuestionCard
                        key={field.id}
                        questionIndex={questionIndex}
                        questionCount={questionFields.length}
                        isExpanded={expandedQuestions.includes(questionIndex)}
                        question={watchedQuestions[questionIndex]}
                        questionErrors={errors.questions?.[questionIndex]}
                        quizType={watchedQuizType}
                        register={register}
                        onToggle={toggleQuestion}
                        onMove={handleMoveQuestion}
                        onRemove={handleRemoveQuestion}
                        onSetCorrect={setCorrectAnswer}
                        onAddOption={addOption}
                        onRemoveOption={removeOption}
                    />
                ))}
            </div>

            {/* Global Error Display for Debugging */}
            <FormErrorSummary errors={errors} />

            <FormActions
                isDirty={isDirty}
                isEditing={isEditing}
                isSubmitting={isSubmitting}
                onCancel={onCancel}
            />
        </form>
    );
}
