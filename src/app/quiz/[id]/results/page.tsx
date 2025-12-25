'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useSearchParams } from 'next/navigation';

interface QuizResult {
  id: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  correctAnswers: number;
  timeSpent: number;
  isEvaluated?: boolean;
  quiz: {
    title: string;
    description: string;
  };
  createdAt: string;
}

export default function QuizResultsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const quizId = params.id as string;

  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get score from URL params as fallback
  const urlScore = searchParams.get('score');
  const urlTotal = searchParams.get('total');

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    const fetchResults = async () => {
      try {
        const response = await fetch(`/api/quizzes/${quizId}/results`);

        if (!response.ok) {
          const errorData = await response.json();

          // Handle 404 specifically - quiz results not found
          if (response.status === 404) {
            // If API returns 404 but we have URL params, use them as fallback
            if (urlScore && urlTotal) {
              const fallbackResult: QuizResult = {
                id: 'temp',
                score: parseInt(urlScore),
                totalQuestions: parseInt(urlTotal),
                percentage: Math.round((parseInt(urlScore) / parseInt(urlTotal)) * 100),
                correctAnswers: parseInt(urlScore),
                timeSpent: 0,
                quiz: {
                  title: 'Quiz Results',
                  description: 'Your quiz has been completed'
                },
                createdAt: new Date().toISOString()
              };
              setResult(fallbackResult);
              return;
            } else {
              throw new Error(errorData.error || 'Quiz results not found. You may not have completed this quiz yet.');
            }
          }

          throw new Error(errorData.error || 'Failed to fetch results');
        }

        const data = await response.json();

        // Transform API response to match our QuizResult interface
        const apiResult = data.results;
        const transformedResult: QuizResult = {
          id: apiResult.attemptId,
          score: apiResult.score,
          totalQuestions: apiResult.totalQuestions,
          percentage: Math.round((apiResult.correctAnswers / apiResult.totalQuestions) * 100),
          correctAnswers: apiResult.correctAnswers,
          timeSpent: 0, // API doesn't provide this, using default
          isEvaluated: apiResult.isEvaluated,
          quiz: {
            title: data.quiz.title,
            description: data.quiz.description
          },
          createdAt: apiResult.completedAt
        };

        setResult(transformedResult);
      } catch (err) {
        // If API fails, use URL params as fallback
        if (urlScore && urlTotal) {
          const fallbackResult: QuizResult = {
            id: 'temp',
            score: parseInt(urlScore),
            totalQuestions: parseInt(urlTotal),
            percentage: Math.round((parseInt(urlScore) / parseInt(urlTotal)) * 100),
            correctAnswers: parseInt(urlScore),
            timeSpent: 0,
            quiz: {
              title: 'Quiz Results',
              description: 'Your quiz has been completed'
            },
            createdAt: new Date().toISOString()
          };
          setResult(fallbackResult);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load results');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [user, isLoading, router, quizId, urlScore, urlTotal]);

  const getScoreColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-400';
    if (percentage >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getScoreMessage = (percentage: number) => {
    if (percentage >= 90) return 'Excellent! Outstanding performance! 🏆';
    if (percentage >= 80) return 'Great job! Well done! 🎉';
    if (percentage >= 70) return 'Good work! Keep it up! 👍';
    if (percentage >= 60) return 'Not bad! Room for improvement! 📚';
    return 'Keep practicing! You can do better! 💪';
  };

  const getPerformanceLevel = (percentage: number) => {
    if (percentage >= 90) return 'Excellent';
    if (percentage >= 80) return 'Very Good';
    if (percentage >= 70) return 'Good';
    if (percentage >= 60) return 'Average';
    return 'Needs Improvement';
  };

  if (isLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-white">Loading results...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center p-4">
        <div className="glass-card glass-border rounded-2xl p-8 max-w-md w-full text-center">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-white mb-4">Error Loading Results</h2>
          <p className="text-gray-300 mb-6">{error}</p>
          <button
            onClick={() => router.push('/quizzes')}
            className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-purple-600 transition-all duration-200"
          >
            Back to Quizzes
          </button>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="text-center">
          <p className="text-white">Results not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-glass-dark py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">
            {result.percentage >= 80 ? '🎉' : result.percentage >= 60 ? '👍' : '📚'}
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">Quiz Completed!</h1>
          <p className="text-xl text-gray-300">{result.quiz.title}</p>
        </div>

        {/* Main Results Card */}
        <div className="glass-card glass-border rounded-2xl p-8 mb-8">
          {/* Evaluation Status */}
          {result.isEvaluated === false && (
            <div className="mb-6 p-4 bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 rounded-xl">
              <div className="flex items-center justify-center mb-2">
                <div className="animate-pulse text-2xl mr-2">⏳</div>
                <h3 className="text-lg font-semibold text-yellow-400">Evaluation In Progress</h3>
              </div>
              <p className="text-center text-yellow-200 text-sm">
                Your quiz is currently being reviewed by our admin team.
                The results shown below are preliminary and may change after evaluation.
              </p>
            </div>
          )}

          <div className="text-center mb-8">
            <div className={`text-6xl font-bold mb-4 ${getScoreColor(result.percentage)}`}>
              {result.percentage}%
            </div>
            <div className="text-2xl font-semibold text-white mb-2">
              {result.isEvaluated === false ? 'Preliminary Score' : getPerformanceLevel(result.percentage)}
            </div>
            <p className="text-lg text-gray-300">
              {result.isEvaluated === false
                ? 'This score may change after admin evaluation'
                : getScoreMessage(result.percentage)
              }
            </p>
          </div>

          {/* Score Breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="glass-card-blue glass-border-blue rounded-xl p-5 text-center">
              <div className="text-3xl mb-2">✅</div>
              <div className="text-2xl font-bold text-green-400 mb-1">{result.correctAnswers}</div>
              <div className="text-gray-300 text-sm">Correct</div>
            </div>
            <div className="glass-card-blue glass-border-blue rounded-xl p-5 text-center">
              <div className="text-3xl mb-2">❌</div>
              <div className="text-2xl font-bold text-red-400 mb-1">{result.totalQuestions - result.correctAnswers}</div>
              <div className="text-gray-300 text-sm">Incorrect</div>
            </div>
            <div className="glass-card-blue glass-border-blue rounded-xl p-5 text-center">
              <div className="text-3xl mb-2">📊</div>
              <div className="text-2xl font-bold text-blue-400 mb-1">{result.percentage}%</div>
              <div className="text-gray-300 text-sm">Accuracy</div>
            </div>
            <div className="glass-card-blue glass-border-blue rounded-xl p-5 text-center">
              <div className="text-3xl mb-2">🎯</div>
              <div className="text-2xl font-bold text-purple-400 mb-1">{result.score || result.correctAnswers * 10}</div>
              <div className="text-gray-300 text-sm">Points</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm text-gray-400 mb-2">
              <span>Your Score</span>
              <span>{result.correctAnswers}/{result.totalQuestions}</span>
            </div>
            <div className="glass-card glass-border rounded-full p-1">
              <div
                className={`h-4 rounded-full transition-all duration-1000 ${result.percentage >= 80
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                  : result.percentage >= 60
                    ? 'bg-gradient-to-r from-yellow-500 to-orange-500'
                    : 'bg-gradient-to-r from-red-500 to-pink-500'
                  }`}
                style={{ width: `${result.percentage}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Achievement Section */}
        {result.percentage >= 80 && result.isEvaluated !== false && (
          <div className="glass-card glass-border rounded-2xl p-6 mb-8 bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border-yellow-500/30">
            <div className="text-center">
              <div className="text-4xl mb-3">🏆</div>
              <h3 className="text-xl font-bold text-yellow-400 mb-2">Achievement Unlocked!</h3>
              <p className="text-yellow-200">You scored above 80%! Excellent performance!</p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <button
            onClick={() => router.push('/quizzes')}
            className="py-4 px-6 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-lg font-medium rounded-xl hover:from-blue-600 hover:to-purple-600 transition-all duration-200"
          >
            Take More Quizzes
          </button>
          <button
            onClick={() => router.push('/leaderboard')}
            className="py-4 px-6 glass-card glass-border text-white text-lg font-medium rounded-xl hover:bg-white/5 transition-all duration-200"
          >
            View Leaderboard
          </button>
        </div>

        {/* Share Results */}
        <div className="glass-card glass-border rounded-2xl p-6 text-center">
          <h3 className="text-lg font-semibold text-white mb-4">Share Your Results</h3>
          <p className="text-gray-300 mb-4">
            I just scored {result.percentage}% on &ldquo;{result.quiz.title}&rdquo; quiz! 🎯
          </p>
          <div className="flex justify-center space-x-4">
            <button
              onClick={() => {
                const text = `I just scored ${result.percentage}% on "${result.quiz.title}" quiz! 🎯`;
                if (navigator.share) {
                  navigator.share({ text });
                } else {
                  navigator.clipboard.writeText(text);
                  alert('Results copied to clipboard!');
                }
              }}
              className="py-2 px-4 bg-gradient-to-r from-green-500 to-blue-500 text-white rounded-lg font-medium hover:from-green-600 hover:to-blue-600 transition-all duration-200"
            >
              Share Results
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}