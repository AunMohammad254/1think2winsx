interface PaymentInfo {
  id: string;
  expiresAt: Date;
  timeRemaining: number;
}

interface QuizListResponse {
  quizzes: Array<any>;
  hasAccess: boolean;
  paymentInfo: PaymentInfo | null;
  accessError: string | null;
}

// Simple in-memory cache for quiz list shared between routes
export const quizListCache = new Map<string, { data: QuizListResponse; timestamp: number }>();
export const clearQuizListCache = () => {
  console.log('[Cache] Clearing quiz list cache');
  quizListCache.clear();
};
