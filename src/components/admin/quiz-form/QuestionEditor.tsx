'use client';

import type { UseFormRegister } from 'react-hook-form';
import { Plus, Check, X } from 'lucide-react';
import type { QuizFormData } from '@/lib/schemas/QuizFormSchema';
import FieldError from './FieldError';
import type { QuestionErrors, QuestionHandlers, WatchedQuestion } from './types';

interface QuestionEditorProps extends Pick<QuestionHandlers, 'onSetCorrect' | 'onAddOption' | 'onRemoveOption'> {
    questionIndex: number;
    question: WatchedQuestion;
    questionErrors?: QuestionErrors;
    quizType: QuizFormData['quizType'];
    register: UseFormRegister<QuizFormData>;
}

/** The body of an expanded question card: its text, answer options and the correct-answer picker. */
export default function QuestionEditor({
    questionIndex,
    question: currentQuestion,
    questionErrors,
    quizType,
    register,
    onSetCorrect,
    onAddOption,
    onRemoveOption,
}: QuestionEditorProps) {
    return (
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
                <FieldError error={questionErrors?.text} />
            </div>

            {/* Options */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-medium text-gray-300">
                        Answer Options <span className="text-red-400">*</span>
                    </label>
                    {quizType === 'normal' ? (
                        <span className="text-xs text-gray-500">
                            Click the check to mark correct answer
                        </span>
                    ) : (
                        <span className="text-xs text-blue-400 font-medium bg-blue-500/10 px-2 py-1 rounded-md">
                            Answers will be evaluated later by Admin
                        </span>
                    )}
                </div>

                <div className="space-y-3">
                    {currentQuestion?.options?.map((option, optionIndex) => (
                        <div key={optionIndex} className="flex items-center gap-3">
                            {/* Correct Answer Toggle */}
                            {quizType === 'normal' && (
                                <button
                                    type="button"
                                    onClick={() => onSetCorrect(questionIndex, optionIndex)}
                                    className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all ${option.isCorrect
                                        ? 'bg-green-500 text-white'
                                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                                        }`}
                                >
                                    <Check className="w-4 h-4" />
                                </button>
                            )}

                            {/* Option Input */}
                            <input
                                {...register(`questions.${questionIndex}.options.${optionIndex}.text`)}
                                className="flex-1 px-4 py-2.5 bg-gray-900/50 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                                placeholder={`Option ${optionIndex + 1}`}
                            />

                            {/* Remove Option */}
                            <button
                                type="button"
                                onClick={() => onRemoveOption(questionIndex, optionIndex)}
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
                        onClick={() => onAddOption(questionIndex)}
                        className="mt-3 flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Add Option
                    </button>
                )}

                {questionErrors?.correctOption?.message && (
                    <p className="mt-2 text-sm text-red-400">{questionErrors.correctOption.message}</p>
                )}
                {questionErrors?.options && (
                    <p className="mt-2 text-sm text-red-400">
                        {questionErrors.options.message ?? 'Every option needs text'}
                    </p>
                )}
            </div>
        </div>
    );
}
