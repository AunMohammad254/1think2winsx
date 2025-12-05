'use client';

import { useState, useEffect } from 'react';

type Quiz = {
  id: string;
  title: string;
  totalQuestions: number;
  questionsWithAnswers: number;
};

type Question = {
  id: string;
  text: string;
  options: string[] | string;
  correctOption: number | null;
  hasCorrectAnswer: boolean;
};

type QuizAttempt = {
  id: string;
  userId: string;
  score: number;
  answers: Record<string, number>;
  user: {
    id: string;
    name: string;
    email: string;
  };
};

type Winner = {
  userId: string;
  userName: string;
  userEmail: string;
  score: number;
  pointsAwarded: number;
};

// Types for API response data
type ApiQuizQuestion = {
  hasCorrectAnswer: boolean;
};

type ApiQuiz = {
  id: string;
  title: string;
  _count?: {
    questions: number;
  };
  questions?: ApiQuizQuestion[];
};

type QuizEvaluation = {
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

type PointsAllocationResult = {
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

export default function QuizEvaluationManager() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<string>('');
  const [quizEvaluation, setQuizEvaluation] = useState<QuizEvaluation | null>(null);
  const [correctAnswers, setCorrectAnswers] = useState<Record<string, number>>({});
  const [pointsPerWinner, setPointsPerWinner] = useState(10);
  const [percentageThreshold, setPercentageThreshold] = useState(10); // Default 10%
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Function to fetch CSRF token
  const getCSRFToken = async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/csrf-token');
      if (!response.ok) {
        throw new Error('Failed to fetch CSRF token');
      }
      const data = await response.json();
      return data.csrfToken;
    } catch (error) {
      console.error('Error fetching CSRF token:', error);
      return null;
    }
  };

  useEffect(() => {
    fetchQuizzes();
  }, []);

  // Calculate metrics for point allocation preview
  const calculateAllocationMetrics = () => {
    if (!quizEvaluation) return null;
    
    const totalAttempts = quizEvaluation.evaluation.totalAttempts;
    const topPercentageCount = Math.max(1, Math.ceil(totalAttempts * (percentageThreshold / 100)));
    const totalPointsToDistribute = topPercentageCount * pointsPerWinner;
    
    return {
      totalAttempts,
      topPercentageCount,
      percentageThreshold,
      pointsPerWinner,
      totalPointsToDistribute
    };
  };

  const fetchQuizzes = async () => {
    try {
      const response = await fetch('/api/admin/quizzes');
      if (response.ok) {
        const data = await response.json();
        const quizzesArray = data.quizzes || [];
        
        if (Array.isArray(quizzesArray)) {
          setQuizzes(quizzesArray.map((quiz: ApiQuiz) => ({
            id: quiz.id,
            title: quiz.title,
            totalQuestions: quiz._count?.questions || 0,
            questionsWithAnswers: quiz.questions?.filter((q: ApiQuizQuestion) => q.hasCorrectAnswer).length || 0
          })));
        }
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.message || 'Failed to fetch quizzes' });
      }
    } catch (error) {
      console.error('Failed to fetch quizzes:', error);
      setMessage({ type: 'error', text: 'Failed to fetch quizzes' });
    }
  };

  const fetchQuizEvaluation = async (quizId: string) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/quiz-evaluation?quizId=${quizId}`);
      
      if (response.ok) {
        const data = await response.json();
        setQuizEvaluation(data);
        
        // Initialize correct answers from existing data
        const answers: Record<string, number> = {};
        data.questions.forEach((q: Question) => {
          if (q.hasCorrectAnswer && q.correctOption !== null) {
            answers[q.id] = q.correctOption;
          }
        });
        setCorrectAnswers(answers);
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.message || 'Failed to fetch quiz evaluation' });
      }
    } catch (error) {
      console.error('Failed to fetch quiz evaluation:', error);
      setMessage({ type: 'error', text: 'Failed to fetch quiz evaluation' });
    } finally {
      setLoading(false);
    }
  };

  const handleQuizSelect = (quizId: string) => {
    setSelectedQuiz(quizId);
    setQuizEvaluation(null);
    setCorrectAnswers({});
    setMessage(null);
    
    if (quizId) {
      fetchQuizEvaluation(quizId);
    }
  };

  const handleCorrectAnswerChange = (questionId: string, optionIndex: number) => {
    setCorrectAnswers(prev => ({
      ...prev,
      [questionId]: optionIndex
    }));
  };

  const handleEvaluateQuiz = async () => {
    if (!selectedQuiz || !quizEvaluation) return;
    
    // Check if all questions have correct answers
    const missingAnswers = quizEvaluation.questions.filter(q => !(q.id in correctAnswers));
    if (missingAnswers.length > 0) {
      setMessage({ 
        type: 'error', 
        text: `Please set correct answers for all questions. Missing: ${missingAnswers.length} questions` 
      });
      return;
    }
    
    try {
      setLoading(true);
      
      // Fetch CSRF token
      const csrfToken = await getCSRFToken();
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
          correctAnswers
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setMessage({ 
          type: 'success', 
          text: `Quiz evaluated successfully! ${data.evaluatedAttempts} attempts processed.` 
        });
        
        // Refresh quiz evaluation data
        await fetchQuizEvaluation(selectedQuiz);
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.message || 'Failed to evaluate quiz' });
      }
    } catch (error) {
      console.error('Failed to evaluate quiz:', error);
      setMessage({ type: 'error', text: 'Failed to evaluate quiz' });
    } finally {
      setLoading(false);
    }
  };

  const handleAllocatePoints = async () => {
    if (!selectedQuiz) return;
    
    try {
      setLoading(true);
      
      // Fetch CSRF token
      const csrfToken = await getCSRFToken();
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
          percentageThreshold
        })
      });
      
      if (response.ok) {
        const data: PointsAllocationResult = await response.json();
        setMessage({ 
          type: 'success', 
          text: `Points allocated successfully! ${data.allocation?.eligibleWinners} winners (top ${data.allocation?.percentageThreshold}%) received ${data.allocation?.pointsPerWinner} points each.` 
        });
        
        // Refresh quiz evaluation data
        await fetchQuizEvaluation(selectedQuiz);
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.message || 'Failed to allocate points' });
      }
    } catch (error) {
      console.error('Failed to allocate points:', error);
      setMessage({ type: 'error', text: 'Failed to allocate points' });
    } finally {
      setLoading(false);
    }
  };

  const allocationMetrics = calculateAllocationMetrics();

  return (
    <div className="space-y-6">
      {/* Message Display */}
      {message && (
        <div className={`p-4 rounded-md glass-transition ${
          message.type === 'success' 
            ? 'glass-card-blue glass-border-blue text-green-300' 
            : 'glass-card glass-border text-red-300'
        }`}>
          <p className="text-white">{message.text}</p>
          <button 
            onClick={() => setMessage(null)}
            className="mt-2 text-sm underline hover:no-underline text-blue-300 glass-transition hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Quiz Selection */}
      <div className="glass-card glass-transition glass-hover p-4 rounded-lg">
        <label className="block text-sm font-medium text-gray-200 mb-2">
          Select Quiz to Evaluate
        </label>
        <select
          value={selectedQuiz}
          onChange={(e) => handleQuizSelect(e.target.value)}
          className="w-full px-3 py-2 glass-card border border-blue-400 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-400 glass-transition"
          disabled={loading}
        >
          <option value="">Choose a quiz...</option>
          {quizzes.map((quiz) => (
            <option key={quiz.id} value={quiz.id}>
              {quiz.title} ({quiz.totalQuestions} questions)
            </option>
          ))}
        </select>
      </div>

      {/* Quiz Evaluation Details */}
      {quizEvaluation && (
        <div className="space-y-6">
          {/* Evaluation Status */}
          <div className="glass-card-blue glass-border-blue glass-transition glass-hover p-4 rounded-lg">
            <h4 className="font-medium text-blue-200 mb-2">Evaluation Status</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-blue-300 font-medium">Total Attempts:</span>
                <span className="ml-2 text-white">{quizEvaluation.evaluation.totalAttempts}</span>
              </div>
              <div>
                <span className="text-blue-300 font-medium">Evaluated:</span>
                <span className="ml-2 text-white">{quizEvaluation.evaluation.evaluatedAttempts}</span>
              </div>
              <div>
                <span className="text-blue-300 font-medium">Pending:</span>
                <span className="ml-2 text-white">{quizEvaluation.evaluation.pendingAttempts}</span>
              </div>
              <div>
                <span className="text-blue-300 font-medium">Questions with Answers:</span>
                <span className="ml-2 text-white">{quizEvaluation.quiz.questionsWithAnswers}/{quizEvaluation.quiz.totalQuestions}</span>
              </div>
            </div>
          </div>

          {/* Point Allocation Configuration */}
          {quizEvaluation.evaluation.isFullyEvaluated && (
            <div className="glass-card glass-border glass-transition glass-hover p-4 rounded-lg">
              <h4 className="font-medium text-white mb-4">Point Allocation Configuration</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Configuration Inputs */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-200 mb-2">
                      Percentage of Top Performers (%)
                    </label>
                    <input
                      type="number"
                      value={percentageThreshold}
                      onChange={(e) => setPercentageThreshold(Math.max(0.01, Math.min(100, parseFloat(e.target.value) || 0.01)))}
                      min="0.01"
                      max="100"
                      step="0.01"
                      className="w-full px-3 py-2 glass-card border border-blue-400 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-400 glass-transition"
                      disabled={loading}
                      placeholder="e.g., 10 for top 10%"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Enter percentage (0.01% - 100%). Examples: 1 = top 1%, 0.1 = top 0.1%, 10 = top 10%
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-200 mb-2">
                      Points per Winner
                    </label>
                    <input
                      type="number"
                      value={pointsPerWinner}
                      onChange={(e) => setPointsPerWinner(Math.max(1, parseInt(e.target.value) || 1))}
                      min="1"
                      max="1000"
                      className="w-full px-3 py-2 glass-card border border-blue-400 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-400 glass-transition"
                      disabled={loading}
                    />
                  </div>
                </div>

                {/* Allocation Metrics Preview */}
                {allocationMetrics && (
                  <div className="glass-card-blue glass-border-blue p-4 rounded-lg">
                    <h5 className="font-medium text-blue-200 mb-3">Allocation Preview</h5>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-blue-300">Total Participants:</span>
                        <span className="text-white font-medium">{allocationMetrics.totalAttempts.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-300">Top {percentageThreshold}% Count:</span>
                        <span className="text-white font-medium">{allocationMetrics.topPercentageCount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-blue-300">Points per Winner:</span>
                        <span className="text-white font-medium">{pointsPerWinner}</span>
                      </div>
                      <div className="flex justify-between border-t border-blue-400 pt-2 mt-2">
                        <span className="text-blue-300 font-medium">Total Points to Distribute:</span>
                        <span className="text-white font-bold">{allocationMetrics.totalPointsToDistribute.toLocaleString()}</span>
                      </div>
                    </div>
                    
                    {allocationMetrics.topPercentageCount === 1 && percentageThreshold < 1 && (
                      <div className="mt-3 p-2 bg-yellow-900/30 border border-yellow-600 rounded text-yellow-200 text-xs">
                        <strong>Note:</strong> Percentage rounds to minimum 1 user to ensure at least one winner.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={handleAllocatePoints}
                disabled={loading}
                className={`mt-4 px-6 py-3 rounded-md font-medium glass-transition ${
                  loading
                    ? 'glass-card glass-border text-gray-400 cursor-not-allowed'
                    : 'glass-card-blue glass-border-blue glass-hover-blue text-white hover:text-blue-100'
                }`}
              >
                {loading ? 'Allocating...' : `Allocate Points to Top ${percentageThreshold}%`}
              </button>
            </div>
          )}

          {/* Questions and Correct Answers */}
          <div className="space-y-4">
            <h4 className="font-medium text-white">Set Correct Answers</h4>
            {quizEvaluation.questions.map((question, index) => (
              <div key={question.id} className="glass-card glass-border glass-transition glass-hover rounded-lg p-4">
                <div className="mb-3">
                  <h5 className="font-medium text-white">Question {index + 1}</h5>
                  <p className="text-gray-200 mt-1">{question.text}</p>
                </div>
                
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-200">
                    Select Correct Answer:
                  </label>
                  <div className="space-y-1">
                    {(Array.isArray(question.options) ? question.options : JSON.parse(question.options || '[]')).map((option: string, optionIndex: number) => (
                      <label key={optionIndex} className="flex items-center">
                        <input
                          type="radio"
                          name={`question-${question.id}`}
                          value={optionIndex}
                          checked={correctAnswers[question.id] === optionIndex}
                          onChange={() => handleCorrectAnswerChange(question.id, optionIndex)}
                          className="mr-2 text-blue-500 focus:ring-blue-400"
                          disabled={loading}
                        />
                        <span className="text-sm text-gray-200">{option}</span>
                        {question.hasCorrectAnswer && question.correctOption === optionIndex && (
                          <span className="ml-2 text-xs glass-card-blue glass-border-blue text-green-300 px-2 py-1 rounded">
                            Current Answer
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleEvaluateQuiz}
              disabled={loading || Object.keys(correctAnswers).length !== quizEvaluation.questions.length}
              className={`px-6 py-3 rounded-md font-medium glass-transition ${
                loading || Object.keys(correctAnswers).length !== quizEvaluation.questions.length
                  ? 'glass-card glass-border text-gray-400 cursor-not-allowed'
                  : 'glass-card-blue glass-border-blue glass-hover-blue text-white hover:text-blue-100'
              }`}
            >
              {loading ? 'Evaluating...' : 'Evaluate Quiz & Calculate Scores'}
            </button>
          </div>
        </div>
      )}

      {/* Instructions */}
      {!selectedQuiz && (
        <div className="glass-card glass-border glass-transition glass-hover p-4 rounded-lg">
          <h4 className="font-medium text-blue-200 mb-2">How to Use Quiz Evaluation</h4>
          <ol className="list-decimal list-inside text-sm text-gray-200 space-y-1">
            <li>Select a quiz from the dropdown above</li>
            <li>Set the correct answer for each question</li>
            <li>Click &quot;Evaluate Quiz&quot; to calculate scores for all attempts</li>
            <li>Configure the percentage of top performers and points per winner</li>
            <li>Review the allocation preview and allocate points</li>
          </ol>
        </div>
      )}
    </div>
  );
}