'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getCSRFToken } from '@/lib/csrf';
import {
  type Quiz,
  type Question,
  type Winner,
  type ApiQuiz,
  type ApiQuizQuestion,
  type QuizEvaluation,
  type PointsAllocationResult,
  StepIndicator,
  StatCard,
  QuizCard,
  QuestionCard,
  WinnerRow,
  Skeleton,
} from './quiz-evaluation';

// Main Component
export default function QuizEvaluationManager() {
  // State
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<string>('');
  const [quizEvaluation, setQuizEvaluation] = useState<QuizEvaluation | null>(null);
  const [correctAnswers, setCorrectAnswers] = useState<Record<string, number>>({});
  const [pointsPerWinner, setPointsPerWinner] = useState(10);
  const [percentageThreshold, setPercentageThreshold] = useState(10);

  // Lucky Draw config
  const [numberOfWinners, setNumberOfWinners] = useState(1);
  const [consolationPoints, setConsolationPoints] = useState(0);

  // Optimization #1: Per-action loading states instead of one shared boolean
  const [loadingQuizzes, setLoadingQuizzes] = useState(true);
  const [loadingEvaluate, setLoadingEvaluate] = useState(false);
  const [loadingAllocate, setLoadingAllocate] = useState(false);
  const [loadingDraw, setLoadingDraw] = useState(false);

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());
  const [winners, setWinners] = useState<Winner[]>([]);
  const [showWinners, setShowWinners] = useState(false);

  // Optimization #4: Cache CSRF token to avoid redundant network requests
  const csrfRef = useRef<string | null>(null);
  const getToken = useCallback(async () => {
    if (!csrfRef.current) csrfRef.current = await getCSRFToken();
    return csrfRef.current;
  }, []);

  // Optimization #6: Auto-dismiss success messages after 5 seconds
  useEffect(() => {
    if (message?.type === 'success') {
      const t = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(t);
    }
  }, [message]);

  // Memoized current step — avoids recomputing on every render.
  const currentStep = useMemo(() => {
    if (!selectedQuiz || !quizEvaluation) return 1;
    if (!quizEvaluation.evaluation.isFullyEvaluated) return 2;
    if (showWinners) return 4;
    return 3;
  }, [selectedQuiz, quizEvaluation, showWinners]);

  // Fetch quizzes
  const fetchQuizzes = useCallback(async () => {
    try {
      setLoadingQuizzes(true);
      const response = await fetch('/api/admin/quizzes');
      if (response.ok) {
        const data = await response.json();
        const quizzesArray = data.quizzes || [];
        if (Array.isArray(quizzesArray)) {
          setQuizzes(
            quizzesArray.map((quiz: ApiQuiz) => ({
              id: quiz.id,
              title: quiz.title,
              prizeId: quiz.prizeId,
              totalQuestions: quiz._count?.questions || 0,
              questionsWithAnswers:
                quiz.questions?.filter((q: ApiQuizQuestion) => q.hasCorrectAnswer).length || 0,
            }))
          );
        }
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.message || 'Failed to fetch quizzes' });
      }
    } catch (error) {
      console.error('Failed to fetch quizzes:', error);
      setMessage({ type: 'error', text: 'Failed to fetch quizzes' });
    } finally {
      setLoadingQuizzes(false);
    }
  }, []);

  useEffect(() => {
    fetchQuizzes();
  }, [fetchQuizzes]);

  // Optimization #2: Wrap in useCallback to avoid stale closures & recreation each render
  const fetchQuizEvaluation = useCallback(async (quizId: string) => {
    try {
      setLoadingEvaluate(true);
      const response = await fetch(`/api/admin/quiz-evaluation?quizId=${quizId}`);
      if (response.ok) {
        const data = await response.json();
        setQuizEvaluation(data);
        // Initialize correct answers
        const answers: Record<string, number> = {};
        data.questions.forEach((q: Question) => {
          if (q.hasCorrectAnswer && q.correctOption !== null) {
            answers[q.id] = q.correctOption;
          }
        });
        setCorrectAnswers(answers);
        // Expand first unanswered question
        const firstUnanswered = data.questions.find(
          (q: Question) => !q.hasCorrectAnswer
        );
        if (firstUnanswered) {
          setExpandedQuestions(new Set([firstUnanswered.id]));
        }
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.message || 'Failed to fetch quiz evaluation' });
      }
    } catch (error) {
      console.error('Failed to fetch quiz evaluation:', error);
      setMessage({ type: 'error', text: 'Failed to fetch quiz evaluation' });
    } finally {
      setLoadingEvaluate(false);
    }
  }, []);

  // Handle quiz selection
  const handleQuizSelect = useCallback((quizId: string) => {
    if (quizId === selectedQuiz) return;
    setSelectedQuiz(quizId);
    setQuizEvaluation(null);
    setCorrectAnswers({});
    setMessage(null);
    setWinners([]);
    setShowWinners(false);
    setExpandedQuestions(new Set());
    if (quizId) {
      fetchQuizEvaluation(quizId);
    }
  }, [selectedQuiz, fetchQuizEvaluation]);

  // Optimization #5: useCallback with correctAnswers dependency to fix stale closure bug
  const handleCorrectAnswerChange = useCallback((questionId: string, optionIndex: number) => {
    setCorrectAnswers((prev) => {
      const next = { ...prev, [questionId]: optionIndex };
      return next;
    });
    // Auto-expand next unanswered question
    setQuizEvaluation((eval_) => {
      if (!eval_) return eval_;
      const currentIndex = eval_.questions.findIndex((q) => q.id === questionId);
      const nextUnanswered = eval_.questions.find(
        (q, i) => i > currentIndex && !(q.id in correctAnswers) && q.id !== questionId
      );
      if (nextUnanswered) {
        setExpandedQuestions(new Set([nextUnanswered.id]));
      } else {
        setExpandedQuestions(new Set());
      }
      return eval_;
    });
  }, [correctAnswers]);

  // Toggle question expansion
  const toggleQuestion = useCallback((questionId: string) => {
    setExpandedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.clear();
        next.add(questionId);
      }
      return next;
    });
  }, []);

  // Evaluate quiz
  const handleEvaluateQuiz = async () => {
    if (!selectedQuiz || !quizEvaluation) return;

    const missingAnswers = quizEvaluation.questions.filter((q) => !(q.id in correctAnswers));
    if (missingAnswers.length > 0) {
      setMessage({
        type: 'error',
        text: `Please set correct answers for all questions. Missing: ${missingAnswers.length} questions`,
      });
      return;
    }

    try {
      setLoadingEvaluate(true);
      const csrfToken = await getToken();
      if (!csrfToken) {
        setMessage({ type: 'error', text: 'Failed to get security token. Please try again.' });
        return;
      }

      const response = await fetch('/api/admin/quiz-evaluation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          quizId: selectedQuiz,
          correctAnswers,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setMessage({
          type: 'success',
          text: `🎉 Quiz evaluated successfully! ${data.evaluatedAttempts} attempts processed.`,
        });
        await fetchQuizEvaluation(selectedQuiz);
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.message || 'Failed to evaluate quiz' });
      }
    } catch (error) {
      console.error('Failed to evaluate quiz:', error);
      setMessage({ type: 'error', text: 'Failed to evaluate quiz' });
    } finally {
      setLoadingEvaluate(false);
    }
  };

  // Allocate points
  const handleAllocatePoints = async () => {
    if (!selectedQuiz) return;

    try {
      setLoadingAllocate(true);
      const csrfToken = await getToken();
      if (!csrfToken) {
        setMessage({ type: 'error', text: 'Failed to get security token. Please try again.' });
        return;
      }

      const response = await fetch('/api/admin/points-allocation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          quizId: selectedQuiz,
          pointsPerWinner,
          percentageThreshold,
        }),
      });

      if (response.ok) {
        const data: PointsAllocationResult = await response.json();
        setMessage({
          type: 'success',
          text: `🏆 Points allocated! ${data.allocation?.eligibleWinners} winners received ${data.allocation?.pointsPerWinner} points each.`,
        });
        setWinners(data.winners || []);
        setShowWinners(true);
        await fetchQuizEvaluation(selectedQuiz);
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.message || 'Failed to allocate points' });
      }
    } catch (error) {
      console.error('Failed to allocate points:', error);
      setMessage({ type: 'error', text: 'Failed to allocate points' });
    } finally {
      setLoadingAllocate(false);
    }
  };

  // Run Lucky Draw
  const handleRunLuckyDraw = async () => {
    if (!selectedQuiz) return;

    try {
      setLoadingDraw(true);
      const csrfToken = await getToken();
      if (!csrfToken) {
        setMessage({ type: 'error', text: 'Failed to get security token. Please try again.' });
        return;
      }

      const response = await fetch(`/api/admin/lucky-winner/${selectedQuiz}/draw`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          numberOfWinners,
          consolationPoints
        })
      });

      if (response.ok) {
        const data = await response.json();

        let msg = data.message || '🎲 Lucky Draw complete!';
        if (data.consolation && data.consolation.losersAwarded > 0) {
          msg += ` ${data.consolation.losersAwarded} runner(s) up received ${data.consolation.points} points.`;
        }

        setMessage({ type: 'success', text: msg });

        // Show the winners in the leaderboard section
        if (data.winners && data.winners.length > 0) {
          setWinners(data.winners.map((w: any) => ({
            userId: w.userId,
            userName: w.name || 'Unknown',
            userEmail: w.email || 'No email',
            score: w.score || 100,
            pointsAwarded: 0 // Prize is awarded instead of points
          })));
          setShowWinners(true);
        }

        await fetchQuizEvaluation(selectedQuiz);
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || 'Failed to run lucky draw' });
      }
    } catch (error) {
      console.error('Failed to run lucky draw:', error);
      setMessage({ type: 'error', text: 'Failed to run lucky draw' });
    } finally {
      setLoadingDraw(false);
    }
  };

  // Optimization #3: useMemo with single Math.ceil calculation (was computed twice before)
  const allocationMetrics = useMemo(() => {
    if (!quizEvaluation) return null;
    const topPercentageCount = Math.max(
      1,
      Math.ceil(quizEvaluation.evaluation.totalAttempts * (percentageThreshold / 100))
    );
    return {
      totalAttempts: quizEvaluation.evaluation.totalAttempts,
      topPercentageCount,
      totalPointsToDistribute: topPercentageCount * pointsPerWinner,
    };
  }, [quizEvaluation, percentageThreshold, pointsPerWinner]);

  // Calculate answered questions count
  const answeredCount = Object.keys(correctAnswers).length;
  const totalQuestions = quizEvaluation?.questions.length || 0;
  const answerProgress = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  // Optimization #7: useMemo for sliced winners list
  const visibleWinners = useMemo(() => winners.slice(0, 10), [winners]);

  // Any action is loading
  const isAnyLoading = loadingEvaluate || loadingAllocate || loadingDraw;

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} />

      {/* Message Display */}
      {message && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between backdrop-blur-sm transition-all duration-300 ${message.type === 'success'
            ? 'bg-green-500/20 border border-green-400/30 text-green-300'
            : 'bg-red-500/20 border border-red-400/30 text-red-300'
            }`}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{message.type === 'success' ? '✅' : '❌'}</span>
            <p>{message.text}</p>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="text-xl hover:opacity-70 transition-opacity"
          >
            ×
          </button>
        </div>
      )}

      {/* Quiz Selection Section */}
      <div className="rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          📋 Select Quiz to Evaluate
        </h3>

        {loadingQuizzes ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : quizzes.length === 0 ? (
          <div className="text-center py-12">
            <span className="text-6xl mb-4 block">📭</span>
            <p className="text-gray-400">No quizzes found. Create a quiz first.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quizzes.map((quiz) => (
              <QuizCard
                key={quiz.id}
                quiz={quiz}
                isSelected={selectedQuiz === quiz.id}
                onClick={() => handleQuizSelect(quiz.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Loading State */}
      {loadingEvaluate && !quizEvaluation && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-8">
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 border-4 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400">Loading quiz data...</p>
          </div>
        </div>
      )}

      {/* Quiz Evaluation Content */}
      {quizEvaluation && (
        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon="📝"
              label="Total Questions"
              value={quizEvaluation.quiz.totalQuestions}
              color="blue"
            />
            <StatCard
              icon="👥"
              label="Total Attempts"
              value={quizEvaluation.evaluation.totalAttempts}
              color="purple"
            />
            <StatCard
              icon="✅"
              label="Evaluated"
              value={quizEvaluation.evaluation.evaluatedAttempts}
              color="green"
            />
            <StatCard
              icon="⏳"
              label="Pending"
              value={quizEvaluation.evaluation.pendingAttempts}
              color="yellow"
              animate={quizEvaluation.evaluation.pendingAttempts > 0}
            />
          </div>

          {/* Questions Section */}
          {!quizEvaluation.evaluation.isFullyEvaluated && (
            <div className="rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  ✏️ Set Correct Answers
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">
                    {answeredCount}/{totalQuestions}
                  </span>
                  <div className="w-32 h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
                      style={{ width: `${answerProgress}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {quizEvaluation.questions.map((question, index) => (
                  <QuestionCard
                    key={question.id}
                    question={question}
                    index={index}
                    correctAnswer={correctAnswers[question.id]}
                    onAnswerChange={(optionIndex) =>
                      handleCorrectAnswerChange(question.id, optionIndex)
                    }
                    isExpanded={expandedQuestions.has(question.id)}
                    onToggle={() => toggleQuestion(question.id)}
                    disabled={isAnyLoading}
                  />
                ))}
              </div>

              {/* Evaluate Button */}
              <button
                onClick={handleEvaluateQuiz}
                disabled={loadingEvaluate || answeredCount !== totalQuestions}
                className={`mt-6 w-full py-4 rounded-xl font-semibold text-lg transition-all duration-300 ${loadingEvaluate || answeredCount !== totalQuestions
                  ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-500 hover:to-purple-500 hover:shadow-lg hover:shadow-blue-500/30 hover:scale-[1.02]'
                  }`}
              >
                {loadingEvaluate ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Evaluating...
                  </span>
                ) : (
                  `📊 Evaluate Quiz & Calculate Scores`
                )}
              </button>
            </div>
          )}

          {/* Points Allocation Section */}
          {quizEvaluation.evaluation.isFullyEvaluated && (
            <div className="rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-400/20 p-6">
              <h3 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                🏆 Allocate Points to Winners
              </h3>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Configuration */}
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Top Percentage of Performers
                    </label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={percentageThreshold}
                        onChange={(e) => setPercentageThreshold(parseFloat(e.target.value))}
                        className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500 [&::-webkit-slider-thumb]:shadow-lg"
                        disabled={loadingAllocate}
                      />
                      <div className="w-20 px-3 py-2 bg-white/10 rounded-lg text-center">
                        <span className="text-white font-bold">{percentageThreshold}%</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Reward top {percentageThreshold}% of participants
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Points per Winner
                    </label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={pointsPerWinner}
                        onChange={(e) => setPointsPerWinner(parseInt(e.target.value))}
                        className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:shadow-lg"
                        disabled={loadingAllocate}
                      />
                      <div className="w-20 px-3 py-2 bg-white/10 rounded-lg text-center">
                        <span className="text-white font-bold">{pointsPerWinner}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Preview */}
                {allocationMetrics && (
                  <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                    <h4 className="text-sm font-medium text-gray-300 mb-4">Allocation Preview</h4>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Total Participants</span>
                        <span className="text-white font-bold text-lg">
                          {allocationMetrics.totalAttempts.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Winners (top {percentageThreshold}%)</span>
                        <span className="text-purple-300 font-bold text-lg">
                          {allocationMetrics.topPercentageCount.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Points per Winner</span>
                        <span className="text-blue-300 font-bold text-lg">{pointsPerWinner}</span>
                      </div>
                      <div className="border-t border-white/10 pt-3">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-300 font-medium">Total Points</span>
                          <span className="text-green-400 font-bold text-2xl">
                            {allocationMetrics.totalPointsToDistribute.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleAllocatePoints}
                disabled={loadingAllocate}
                className={`mt-6 w-full py-4 rounded-xl font-semibold text-lg transition-all duration-300 ${loadingAllocate
                  ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-500 hover:to-pink-500 hover:shadow-lg hover:shadow-purple-500/30 hover:scale-[1.02]'
                  }`}
              >
                {loadingAllocate ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Allocating Points...
                  </span>
                ) : (
                  `🏆 Allocate Points to Top ${percentageThreshold}%`
                )}
              </button>

              {quizEvaluation.quiz.prizeId && (
                <div className="mt-8 border-t border-purple-400/20 pt-6">
                  <h4 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
                    🎁 Lucky Draw Selection
                  </h4>
                  <p className="text-sm text-gray-400 mb-6">
                    This quiz is linked to a prize. Run the Lucky Draw to randomly select a winner from the perfect scorers.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Number of Winners</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={numberOfWinners}
                        onChange={(e) => setNumberOfWinners(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-yellow-500 outline-none"
                        disabled={loadingDraw}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Consolation Points (for losers)</label>
                      <input
                        type="number"
                        min="0"
                        value={consolationPoints}
                        onChange={(e) => setConsolationPoints(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-yellow-500 outline-none"
                        disabled={loadingDraw}
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleRunLuckyDraw}
                    disabled={loadingDraw}
                    className={`w-full py-4 rounded-xl font-semibold text-lg transition-all duration-300 ${loadingDraw
                      ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white hover:from-yellow-400 hover:to-orange-400 hover:shadow-lg hover:shadow-yellow-500/30 hover:scale-[1.02]'
                      }`}
                  >
                    {loadingDraw ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Running Draw...
                      </span>
                    ) : (
                      `🎲 Run Lucky Draw`
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Winners Display */}
          {showWinners && winners.length > 0 && (
            <div className="rounded-xl bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-400/20 p-6 animate-fadeIn">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  🎉 Winners Leaderboard
                </h3>
                <span className="px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-300 text-sm">
                  {winners.length} winners
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-gray-400 text-sm">
                      <th className="py-2 px-4">Rank</th>
                      <th className="py-2 px-4">User</th>
                      <th className="py-2 px-4 text-center">Score</th>
                      <th className="py-2 px-4 text-center">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Optimization #7: use memoized sliced list */}
                    {visibleWinners.map((winner, index) => (
                      <WinnerRow key={winner.userId} winner={winner} rank={index + 1} />
                    ))}
                  </tbody>
                </table>
                {winners.length > 10 && (
                  <p className="text-center text-gray-500 text-sm mt-4">
                    And {winners.length - 10} more winners...
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Instructions when no quiz selected */}
      {!selectedQuiz && !loadingQuizzes && quizzes.length > 0 && (
        <div className="rounded-xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-400/20 p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            💡 How to Use Quiz Evaluation
          </h3>
          <ol className="space-y-3 text-gray-300">
            {[
              'Select a quiz from the cards above',
              'Set the correct answer for each question',
              'Click "Evaluate Quiz" to calculate all participant scores',
              'Configure the winner percentage and points',
              'Allocate points to top performers',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-sm font-bold">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}