import type { User as SupabaseUser } from '@supabase/supabase-js';

/**
 * Calculates the accuracy percentage based on correct answers and quizzes taken.
 * Assumes 10 questions per quiz by default.
 */
export function calculateAccuracy(correctAnswers: number, quizzesTaken: number, questionsPerQuiz: number = 10): number {
  if (!quizzesTaken || quizzesTaken <= 0) return 0;
  return Math.round((correctAnswers / (quizzesTaken * questionsPerQuiz)) * 100);
}

/**
 * Extracts a friendly display name from a Supabase User object.
 */
export function getUserDisplayName(user: SupabaseUser | null | undefined): string {
  if (!user) return 'Guest';
  return (
    user.user_metadata?.name ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'User'
  );
}
