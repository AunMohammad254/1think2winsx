'use client';

import type { UseFormRegister } from 'react-hook-form';
import { Trash2, GripVertical, ChevronDown, ChevronUp } from 'lucide-react';
import type { QuizFormData } from '@/lib/schemas/QuizFormSchema';
import QuestionEditor from './QuestionEditor';
import type { QuestionErrors, QuestionHandlers, WatchedQuestion } from './types';

interface QuestionCardProps extends QuestionHandlers {
    questionIndex: number;
    questionCount: number;
    isExpanded: boolean;
    question: WatchedQuestion;
    questionErrors?: QuestionErrors;
    quizType: QuizFormData['quizType'];
    register: UseFormRegister<QuizFormData>;
}

/**
 * One question: a header that collapses the card and moves or removes the question,
 * and the editor below it while the card is expanded.
 */
export default function QuestionCard({
    questionIndex,
    questionCount,
    isExpanded,
    question: currentQuestion,
    questionErrors,
    quizType,
    register,
    onToggle,
    onMove,
    onRemove,
    onSetCorrect,
    onAddOption,
    onRemoveOption,
}: QuestionCardProps) {
    return (
        <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/60 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden">
            {/* Question Header */}
            <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-white/5 transition-colors"
                onClick={() => onToggle(questionIndex)}
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
                        onClick={(e) => { e.stopPropagation(); onMove(questionIndex, 'up'); }}
                        disabled={questionIndex === 0}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onMove(questionIndex, 'down'); }}
                        disabled={questionIndex === questionCount - 1}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronDown className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemove(questionIndex); }}
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
                <QuestionEditor
                    questionIndex={questionIndex}
                    question={currentQuestion}
                    questionErrors={questionErrors}
                    quizType={quizType}
                    register={register}
                    onSetCorrect={onSetCorrect}
                    onAddOption={onAddOption}
                    onRemoveOption={onRemoveOption}
                />
            )}
        </div>
    );
}
