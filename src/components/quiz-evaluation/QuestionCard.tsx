import type { Question } from './types';

// Question Card Component
export const QuestionCard = ({
    question,
    index,
    correctAnswer,
    onAnswerChange,
    isExpanded,
    onToggle,
    disabled,
}: {
    question: Question;
    index: number;
    correctAnswer: number | undefined;
    onAnswerChange: (optionIndex: number) => void;
    isExpanded: boolean;
    onToggle: () => void;
    disabled: boolean;
}) => {
    const options = Array.isArray(question.options)
        ? question.options
        : JSON.parse(question.options || '[]');

    const isAnswered = correctAnswer !== undefined;

    return (
        <div
            className={`rounded-xl border transition-all duration-300 overflow-hidden ${isAnswered
                ? 'bg-green-500/10 border-green-400/30'
                : 'bg-white/5 border-white/10'
                }`}
        >
            <button
                onClick={onToggle}
                className="w-full p-4 text-left flex items-center justify-between"
            >
                <div className="flex items-center gap-3">
                    <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${isAnswered
                            ? 'bg-green-500 text-white'
                            : 'bg-white/10 text-gray-400'
                            }`}
                    >
                        {isAnswered ? '✓' : index + 1}
                    </div>
                    <span className="text-white font-medium line-clamp-1">{question.text}</span>
                </div>
                <span
                    className={`text-xl transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''
                        }`}
                >
                    ▼
                </span>
            </button>

            <div
                className={`transition-all duration-300 ${isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                    }`}
            >
                <div className="p-4 pt-0 space-y-2">
                    {options.map((option: string, optionIndex: number) => (
                        <label
                            key={optionIndex}
                            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200 ${correctAnswer === optionIndex
                                ? 'bg-blue-500/30 border border-blue-400'
                                : 'bg-white/5 border border-transparent hover:bg-white/10'
                                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            <div
                                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${correctAnswer === optionIndex
                                    ? 'border-blue-400 bg-blue-500'
                                    : 'border-gray-500'
                                    }`}
                            >
                                {correctAnswer === optionIndex && (
                                    <div className="w-2 h-2 rounded-full bg-white" />
                                )}
                            </div>
                            <span className="text-gray-200 flex-1">{option}</span>
                            {question.hasCorrectAnswer && question.correctOption === optionIndex && (
                                <span className="px-2 py-1 rounded text-xs bg-green-500/20 text-green-300 border border-green-400/30">
                                    Saved ✓
                                </span>
                            )}
                            <input
                                type="radio"
                                name={`question-${question.id}`}
                                value={optionIndex}
                                checked={correctAnswer === optionIndex}
                                onChange={() => onAnswerChange(optionIndex)}
                                disabled={disabled}
                                className="sr-only"
                            />
                        </label>
                    ))}
                </div>
            </div>
        </div>
    );
};
