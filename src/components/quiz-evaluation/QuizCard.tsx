import type { Quiz } from './types';

// Quiz Card Component
export const QuizCard = ({
    quiz,
    isSelected,
    onClick,
}: {
    quiz: Quiz;
    isSelected: boolean;
    onClick: () => void;
}) => {
    const progress = quiz.totalQuestions > 0
        ? Math.round((quiz.questionsWithAnswers / quiz.totalQuestions) * 100)
        : 0;

    return (
        <button
            onClick={onClick}
            className={`w-full text-left p-4 rounded-xl border transition-all duration-300 ${isSelected
                ? 'bg-gradient-to-br from-blue-500/30 to-purple-600/20 border-blue-400 shadow-lg shadow-blue-500/20 scale-[1.02]'
                : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                }`}
        >
            <div className="flex justify-between items-start mb-2">
                <h4 className="font-semibold text-white text-lg">{quiz.title}</h4>
                {isSelected && (
                    <span className="text-blue-400 text-xl animate-pulse">✓</span>
                )}
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-400">
                <span>📝 {quiz.totalQuestions} questions</span>
                <span>✅ {quiz.questionsWithAnswers} answered</span>
            </div>
            <div className="mt-3">
                <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">Answer Progress</span>
                    <span className={progress === 100 ? 'text-green-400' : 'text-blue-400'}>{progress}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-500 ${progress === 100
                            ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                            : 'bg-gradient-to-r from-blue-500 to-purple-500'
                            }`}
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        </button>
    );
};
