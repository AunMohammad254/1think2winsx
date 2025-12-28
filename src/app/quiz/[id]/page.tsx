'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import QuizResults from '@/components/QuizResults';
import LazyStreamPlayer from '@/components/LazyStreamPlayer';

interface Question {
  id: string;
  text: string;
  options: string[];
}

interface Quiz {
  id: string;
  title: string;
  description: string;
  questions: Question[];
  duration: number; // Duration in minutes from admin
  timeLimit: number;
  questionCount: number;
  totalQuestions: number;
  isReattempt?: boolean;
  newQuestionsCount?: number;
  previousAttempt?: {
    id: string;
    score: number;
    points: number;
    completedAt: string;
  };
}

interface Answer {
  questionId: string;
  selectedOption: number;
}

interface SubmissionResult {
  message?: string;
  results?: {
    submittedAnswers?: number;
    note?: string;
  };
}

export default function QuizPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const _searchParams = useSearchParams();
  const quizId = params.id as string;

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null); // Will be set from quiz.duration
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [quizStarted, setQuizStarted] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const [showStream, setShowStream] = useState(false);
  const [showTimeExpired, setShowTimeExpired] = useState(false); // Time expired dialog
  const [showUnansweredWarning, setShowUnansweredWarning] = useState(false); // Unanswered questions warning

  const fetchQuiz = useCallback(async () => {
    try {
      const response = await fetch(`/api/quizzes/${quizId}`);
      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json();
          // Check if user has already completed this quiz and there are no new questions
          if (errorData.completed && errorData.attempt) {
            // Redirect to results page
            router.push(`/quiz/${quizId}/results?score=${errorData.attempt.score || 0}&total=10`);
            return;
          }
          throw new Error('You need to pay to access this quiz');
        }
        throw new Error('Failed to fetch quiz');
      }
      const data = await response.json();
      setQuiz(data.quiz);

      // Set timer from quiz duration (convert minutes to seconds)
      const durationInSeconds = (data.quiz.duration || 30) * 60;
      setTimeRemaining(durationInSeconds);

      // Initialize answers array for the questions being shown (new questions in reattempt)
      const initialAnswers: Answer[] = data.quiz.questions.map((q: Question) => ({
        questionId: q.id,
        selectedOption: -1
      }));
      setAnswers(initialAnswers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quiz');
    } finally {
      setLoading(false);
    }
  }, [quizId, router]);

  // Helper function to get CSRF token
  const getCSRFToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/csrf-token');
      if (!response.ok) {
        console.error('Failed to get CSRF token');
        return null;
      }
      const data = await response.json();
      return data.csrfToken;
    } catch (error) {
      console.error('Error fetching CSRF token:', error);
      return null;
    }
  }, []);

  const handleSubmitQuiz = useCallback(async (forceSubmit: boolean = false) => {
    if (isSubmitting) return;

    // Check if all questions are answered (unless forced or time expired)
    const unansweredCount = answers.filter(a => a.selectedOption === -1).length;
    if (!forceSubmit && unansweredCount > 0) {
      setShowUnansweredWarning(true);
      return;
    }

    setShowUnansweredWarning(false);
    setIsSubmitting(true);
    try {
      // Get CSRF token for secure submission
      const csrfToken = await getCSRFToken();
      if (!csrfToken) {
        throw new Error('Unable to verify security token. Please refresh the page and try again.');
      }

      const response = await fetch(`/api/quizzes/${quizId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ answers }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || 'Failed to submit quiz');
      }

      const result = await response.json();

      // For prediction-based quizzes, show results component instead of redirecting
      // This is a prediction-based quiz system, so we show submission confirmation
      setSubmissionResult(result);
      setShowResults(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit quiz');
    } finally {
      setIsSubmitting(false);
    }
  }, [quizId, answers, isSubmitting, getCSRFToken]);

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.push('/login');
      return;
    }

    fetchQuiz();
  }, [user, isLoading, router, fetchQuiz]);

  // Timer effect
  useEffect(() => {
    if (!quizStarted || timeRemaining === null || timeRemaining <= 0) return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev === null) return null;
        if (prev <= 1) {
          // Show time expired dialog instead of auto-submitting
          setShowTimeExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [quizStarted, timeRemaining]);

  const handleAnswerSelect = (questionId: string, optionIndex: number) => {
    setAnswers(prev =>
      prev.map(answer =>
        answer.questionId === questionId
          ? { ...answer, selectedOption: optionIndex }
          : answer
      )
    );
  };

  const handleNextQuestion = () => {
    if (quiz && currentQuestionIndex < quiz.questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
    }
  };

  const formatTime = (seconds: number | null) => {
    if (seconds === null) return '--:--';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  // Handle time expired - submit and redirect to results (force submit even if incomplete)
  const handleTimeExpiredClose = async () => {
    setShowTimeExpired(false);
    await handleSubmitQuiz(true); // Force submit on time expiry
    router.push(`/quiz/${quizId}/results`);
  };

  const getAnsweredCount = () => {
    return answers.filter(answer => answer.selectedOption !== -1).length;
  };

  if (isLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-white">Loading quiz...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center p-4">
        <div className="glass-card glass-border rounded-2xl p-8 max-w-md w-full text-center">
          <div className="text-red-400 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-white mb-4">Quiz Access Error</h2>
          <p className="text-gray-300 mb-6">{error}</p>
          <div className="space-y-3">
            <button
              onClick={() => router.push('/quizzes')}
              className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-purple-600 transition-all duration-200"
            >
              Back to Quizzes
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="text-center">
          <p className="text-white">Quiz not found</p>
        </div>
      </div>
    );
  }

  // Show results component after submission for prediction-based quizzes
  if (showResults && submissionResult) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center p-4">
        <QuizResults
          success={true}
          message={submissionResult.message || "Your predictions have been successfully submitted!"}
          totalQuestions={quiz?.questions.length || 0}
          submittedAnswers={submissionResult.results?.submittedAnswers || getAnsweredCount()}
          note={submissionResult.results?.note || "The admin will review all submissions and add the correct answers. Points will be allocated to the top performers based on accuracy and speed."}
        />
      </div>
    );
  }

  if (!quizStarted) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center p-4">
        <div className="glass-card glass-border rounded-2xl p-8 max-w-2xl w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-4">{quiz.title}</h1>
            <p className="text-gray-300 text-lg">{quiz.description}</p>

            {/* Reattempt notification */}
            {quiz.isReattempt && (
              <div className="mt-6 bg-green-500/20 border border-green-500/30 rounded-xl p-4">
                <h3 className="text-green-200 font-semibold mb-2">🎉 New Questions Available!</h3>
                <p className="text-green-100 text-sm">
                  You&apos;ve already completed this quiz, but {quiz.newQuestionsCount} new questions have been added.
                  You can now attempt these new questions to improve your score!
                </p>
                {quiz.previousAttempt && (
                  <p className="text-green-100 text-xs mt-2">
                    Previous attempt: {quiz.previousAttempt.score}% on {new Date(quiz.previousAttempt.completedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="glass-card-blue glass-border-blue rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-white">
                {quiz.isReattempt ? quiz.newQuestionsCount : quiz.questions.length}
              </div>
              <div className="text-blue-200 text-sm">
                {quiz.isReattempt ? 'New Questions' : 'Questions'}
              </div>
            </div>
            <div className="glass-card-blue glass-border-blue rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-white">{quiz.duration || 30}</div>
              <div className="text-blue-200 text-sm">Minutes</div>
            </div>
            <div className="glass-card-blue glass-border-blue rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-white">
                {quiz.isReattempt ? 'Reattempt' : '1'}
              </div>
              <div className="text-blue-200 text-sm">
                {quiz.isReattempt ? 'Mode' : 'Attempt'}
              </div>
            </div>
          </div>

          <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-xl p-4 mb-8">
            <h3 className="text-yellow-200 font-semibold mb-2">Important Instructions:</h3>
            <ul className="text-yellow-100 text-sm space-y-1">
              <li>• You have {quiz.duration || 30} minutes to complete all questions</li>
              <li>• You can navigate between questions and change answers</li>
              <li>• Make sure to submit before time runs out</li>
              {quiz.isReattempt ? (
                <li>• You&apos;re only answering the new questions added to this quiz</li>
              ) : (
                <li>• Once submitted, you cannot retake this quiz</li>
              )}
            </ul>
          </div>

          <button
            onClick={() => setQuizStarted(true)}
            className="w-full py-4 px-6 bg-gradient-to-r from-green-500 to-blue-500 text-white text-xl font-bold rounded-xl hover:from-green-600 hover:to-blue-600 transition-all duration-200"
          >
            {quiz.isReattempt ? 'Start New Questions' : 'Start Quiz'}
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion = quiz.questions[currentQuestionIndex];
  const currentAnswer = answers.find(a => a.questionId === currentQuestion?.id);

  // Safety check for currentQuestion
  if (!currentQuestion) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="text-center">
          <p className="text-white">Question not found</p>
        </div>
      </div>
    );
  }

  // Pre-compute progress percentage to simplify JSX style braces
  const progressPercent = Math.floor(((currentQuestionIndex + 1) / quiz.questions.length) * 100);

  return (
    <div className="min-h-screen bg-gradient-glass-dark py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Main Quiz Content */}
          <div className="flex-1 max-w-4xl">
            {/* Sticky Header */}
            <div className="sticky top-0 z-40 glass-card glass-border rounded-2xl p-4 md:p-6 mb-6 backdrop-blur-xl bg-gray-900/80">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl md:text-2xl font-bold text-white truncate mb-1">{quiz.title}</h1>
                  <p className="text-gray-300 text-sm md:text-base">
                    Question <span className="text-blue-400 font-semibold">{currentQuestionIndex + 1}</span> of <span className="text-blue-400 font-semibold">{quiz.questions.length}</span>
                  </p>
                </div>
                <div className="flex items-center gap-4 md:gap-6">
                  {/* Timer */}
                  <div className={`text-center px-4 py-2 rounded-xl ${(timeRemaining ?? 0) <= 60 ? 'bg-red-500/20 border border-red-500/50' : 'bg-blue-500/10 border border-blue-500/30'}`}>
                    <div className={`text-xl md:text-2xl font-bold font-mono ${(timeRemaining ?? 0) <= 60 ? 'text-red-400 animate-pulse' : (timeRemaining ?? 0) <= 120 ? 'text-yellow-400' : 'text-white'}`}>
                      {formatTime(timeRemaining)}
                    </div>
                    <div className="text-gray-400 text-xs">Time Left</div>
                  </div>
                  {/* Answered Count */}
                  <div className="text-center px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/30">
                    <div className="text-xl md:text-2xl font-bold text-white">
                      <span className="text-green-400">{getAnsweredCount()}</span>/{quiz.questions.length}
                    </div>
                    <div className="text-gray-400 text-xs">Answered</div>
                  </div>
                  {/* Stream Toggle Button */}
                  <button
                    onClick={() => setShowStream(!showStream)}
                    className="lg:hidden py-2 px-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl font-medium hover:from-purple-600 hover:to-pink-600 transition-all duration-200 text-sm"
                  >
                    📺
                  </button>
                </div>
              </div>

              {/* Progress Bar - Integrated in Header */}
              <div className="mt-4">
                <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-green-400 via-blue-500 to-purple-500 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Question Card */}
            <div className="glass-card glass-border rounded-2xl p-6 md:p-8 mb-6 bg-gradient-to-br from-blue-900/20 to-purple-900/20">
              {/* Question Number Badge */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 text-sm mb-4">
                <span>❓</span>
                <span>Question {currentQuestionIndex + 1}</span>
              </div>

              <h2 className="text-lg md:text-xl font-semibold text-white mb-6 leading-relaxed">
                {currentQuestion.text}
              </h2>

              {/* Options Grid */}
              <div className="space-y-3">
                {currentQuestion.options.map((option, index) => {
                  const isSelected = currentAnswer?.selectedOption === index;
                  return (
                    <button
                      key={index}
                      onClick={() => handleAnswerSelect(currentQuestion.id, index)}
                      className={`w-full min-h-[60px] p-4 md:p-5 text-left rounded-xl border-2 transition-all duration-200 transform active:scale-[0.98] ${isSelected
                        ? 'border-blue-400 bg-gradient-to-r from-blue-500/30 to-purple-500/30 text-white shadow-lg shadow-blue-500/20'
                        : 'border-gray-600 bg-gray-800/50 text-gray-300 hover:border-gray-400 hover:bg-gray-700/50'
                        }`}
                    >
                      <div className="flex items-center gap-4">
                        {/* Option Letter */}
                        <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full border-2 flex items-center justify-center font-bold text-sm md:text-base flex-shrink-0 transition-all duration-200 ${isSelected
                          ? 'border-blue-400 bg-blue-500 text-white'
                          : 'border-gray-500 text-gray-400'
                          }`}>
                          {String.fromCharCode(65 + index)}
                        </div>
                        <span className="font-medium text-sm md:text-base">{option}</span>
                        {/* Check mark for selected */}
                        {isSelected && (
                          <div className="ml-auto">
                            <svg className="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Navigation */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
              <button
                onClick={handlePreviousQuestion}
                disabled={currentQuestionIndex === 0}
                className="w-full sm:w-auto py-3 px-6 glass-card glass-border text-gray-300 rounded-xl font-medium hover:bg-white/10 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </button>

              <div className="flex gap-3 w-full sm:w-auto">
                {currentQuestionIndex === quiz.questions.length - 1 ? (
                  <button
                    onClick={() => handleSubmitQuiz()}
                    disabled={isSubmitting}
                    className="flex-1 sm:flex-none py-3 px-8 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-semibold hover:from-green-600 hover:to-emerald-700 transition-all duration-200 disabled:opacity-50 shadow-lg shadow-green-500/25 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        Submit Quiz
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleNextQuestion}
                    className="flex-1 sm:flex-none py-3 px-8 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl font-semibold hover:from-blue-600 hover:to-purple-600 transition-all duration-200 shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2"
                  >
                    Next
                  </button>
                )}
              </div>
            </div>

            {/* Question Navigator */}
            <div className="mt-8 glass-card glass-border rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Question Navigator</h3>
              <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
                {quiz.questions.map((_, index) => {
                  const isAnswered = answers[index]?.selectedOption !== -1;
                  const isCurrent = index === currentQuestionIndex;

                  return (
                    <button
                      key={index}
                      onClick={() => setCurrentQuestionIndex(index)}
                      className={`w-10 h-10 rounded-lg font-medium transition-all duration-200 ${isCurrent
                        ? 'bg-blue-500 text-white'
                        : isAnswered
                          ? 'bg-green-500/30 text-green-400 border border-green-500/50'
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                        }`}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Live Stream Sidebar - Desktop */}
          <div className="hidden lg:block lg:w-96">
            <div className="sticky top-8">
              <div className="glass-card glass-border rounded-2xl p-4 mb-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">📺 Live Stream</h3>
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-red-400 text-sm font-medium">LIVE</span>
                  </div>
                </div>
                <LazyStreamPlayer />
              </div>
              <div className="glass-card glass-border rounded-xl p-4">
                <p className="text-gray-300 text-sm">
                  💡 <strong>Tip:</strong> Watch the live stream for hints and explanations that might help you with the quiz!
                </p>
              </div>
            </div>
          </div>

          {/* Live Stream Mobile Modal */}
          {
            showStream && (
              <div className="lg:hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="glass-card glass-border rounded-2xl p-4 w-full max-w-md max-h-[80vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">📺 Live Stream</h3>
                    <button
                      onClick={() => setShowStream(false)}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                  <LazyStreamPlayer />
                  <div className="mt-4 p-3 bg-blue-500/20 border border-blue-500/30 rounded-xl">
                    <p className="text-blue-100 text-sm">
                      💡 Watch for hints and explanations that might help with your quiz!
                    </p>
                  </div>
                </div>
              </div>
            )
          }

          {/* Time Expired Dialog */}
          {
            showTimeExpired && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="glass-card glass-border rounded-2xl p-8 max-w-md w-full text-center animate-pulse">
                  <div className="text-6xl mb-6">⏰</div>
                  <h2 className="text-2xl font-bold text-white mb-4">Your Quiz Time is Over!</h2>
                  <p className="text-gray-300 mb-6">
                    Your time has expired. We&apos;ll submit your answers and take you to the results page.
                  </p>
                  <button
                    onClick={handleTimeExpiredClose}
                    className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-lg font-bold rounded-xl hover:from-blue-600 hover:to-purple-600 transition-all duration-200"
                  >
                    View Results
                  </button>
                </div>
              </div>
            )
          }

          {/* Unanswered Questions Warning Modal */}
          {
            showUnansweredWarning && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="glass-card glass-border rounded-2xl p-8 max-w-md w-full text-center">
                  <div className="text-6xl mb-6">⚠️</div>
                  <h2 className="text-2xl font-bold text-white mb-4">Answer All Questions</h2>
                  <p className="text-gray-300 mb-4">
                    You have <span className="text-red-400 font-bold">{answers.filter(a => a.selectedOption === -1).length}</span> unanswered question{answers.filter(a => a.selectedOption === -1).length !== 1 ? 's' : ''}.
                  </p>
                  <p className="text-yellow-300 text-sm mb-6">
                    Please answer all questions before submitting the quiz.
                  </p>

                  {/* Show unanswered question numbers */}
                  <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
                    <p className="text-gray-400 text-sm mb-2">Unanswered questions:</p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {answers.map((answer, index) =>
                        answer.selectedOption === -1 ? (
                          <button
                            key={index}
                            onClick={() => {
                              setCurrentQuestionIndex(index);
                              setShowUnansweredWarning(false);
                            }}
                            className="w-10 h-10 rounded-lg bg-red-500/20 border border-red-500/50 text-red-300 font-medium hover:bg-red-500/30 transition-colors"
                          >
                            {index + 1}
                          </button>
                        ) : null
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => setShowUnansweredWarning(false)}
                    className="w-full py-4 px-6 bg-gradient-to-r from-blue-500 to-purple-500 text-white text-lg font-bold rounded-xl hover:from-blue-600 hover:to-purple-600 transition-all duration-200"
                  >
                    Go Answer Questions
                  </button>
                </div>
              </div>
            )
          }
        </div >
      </div >
    </div >
  );
}