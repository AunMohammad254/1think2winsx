'use client';

import { Controller, type Control, type UseFormSetValue, type UseFormWatch } from 'react-hook-form';
import type { QuizFormData } from '@/lib/schemas/QuizFormSchema';

interface QuizTypeToggleProps {
    control: Control<QuizFormData>;
    watch: UseFormWatch<QuizFormData>;
    setValue: UseFormSetValue<QuizFormData>;
}

/** Normal / Predictable switch in the Quiz Details header. */
export default function QuizTypeToggle({ control, watch, setValue }: QuizTypeToggleProps) {
    return (
        <Controller
            name="quizType"
            control={control}
            render={({ field }) => (
                <div className="flex bg-gray-900/80 border border-white/10 rounded-lg p-1">
                    <button
                        type="button"
                        onClick={() => field.onChange('normal')}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                            field.value === 'normal'
                                ? 'bg-purple-600 text-white shadow'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        Normal
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            field.onChange('predictable');
                            // Reset correct options when switching to predictable
                            const currentQuestions = watch('questions');
                            currentQuestions.forEach((_, idx) => {
                                setValue(`questions.${idx}.correctOption`, null as any, { shouldValidate: true });
                            });
                        }}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                            field.value === 'predictable'
                                ? 'bg-blue-600 text-white shadow'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        Predictable
                    </button>
                </div>
            )}
        />
    );
}
