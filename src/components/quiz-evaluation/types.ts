// Types for Quiz Evaluation

export type Quiz = {
    id: string;
    title: string;
    totalQuestions: number;
    questionsWithAnswers: number;
};

export type Question = {
    id: string;
    text: string;
    options: string[] | string;
    correctOption: number | null;
    hasCorrectAnswer: boolean;
};

export type QuizAttempt = {
    id: string;
    userId: string;
    score: number;
    isEvaluated: boolean;
    createdAt: string;
    user: {
        name: string;
        email: string;
    };
};

export type Winner = {
    userId: string;
    userName: string;
    userEmail: string;
    score: number;
    pointsAwarded: number;
    newTotalPoints?: number;
};

export type ApiQuizQuestion = {
    hasCorrectAnswer: boolean;
};

export type ApiQuiz = {
    id: string;
    title: string;
    _count?: {
        questions: number;
    };
    questions?: ApiQuizQuestion[];
};

export type QuizEvaluation = {
    quiz: Quiz;
    evaluation: {
        totalAttempts: number;
        evaluatedAttempts: number;
        pendingAttempts: number;
        isFullyEvaluated: boolean;
    };
    questions: Question[];
    attempts: QuizAttempt[];
};

export type PointsAllocationResult = {
    success: boolean;
    message: string;
    allocation?: {
        totalAttempts: number;
        topPercentageCount: number;
        eligibleWinners: number;
        pointsPerWinner: number;
        totalPointsDistributed: number;
        percentageThreshold: number;
    };
    winners?: Winner[];
};
