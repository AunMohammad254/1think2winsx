'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Play, Pause, AlertCircle, Users, Clock, CheckCircle, XCircle } from "lucide-react";

interface Quiz {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'paused' | 'draft';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  questions: Array<{
    id: string;
    text: string;
    status: 'active' | 'paused';
  }>;
  _count: {
    questions: number;
    attempts: number;
  };
  stats?: {
    totalAttempts: number;
    averageScore: number;
    completionRate: number;
  };
}

interface QuizManagementProps {
  quizId: string;
  onQuizChange?: (quiz: Quiz) => void;
}

export default function QuizManagement({ quizId, onQuizChange }: QuizManagementProps) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStatusConfirm, setShowStatusConfirm] = useState<'active' | 'paused' | null>(null);
  
  // CSRF token
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  // Use ref to store onQuizChange to prevent unnecessary re-renders and flickering
  const onQuizChangeRef = useRef(onQuizChange);
  useEffect(() => {
    onQuizChangeRef.current = onQuizChange;
  }, [onQuizChange]);

  // Fetch CSRF token
  const fetchCSRFToken = async () => {
    try {
      const response = await fetch('/api/csrf-token');
      if (response.ok) {
        const data = await response.json();
        setCsrfToken(data.csrfToken);
      }
    } catch (error) {
      console.error('Failed to fetch CSRF token:', error);
    }
  };

  useEffect(() => {
    fetchCSRFToken();
  }, []);

  // Fetch quiz details
  const fetchQuiz = useCallback(async () => {
    if (!quizId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/admin/quizzes/${quizId}`);
      
      if (!response.ok) {
        let errorMessage = 'Failed to fetch quiz';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          errorMessage = response.statusText || errorMessage;
          console.warn('Failed to parse error response as JSON:', parseError);
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setQuiz(data.quiz);
      
      // Use ref to avoid dependency issues and prevent flickering
      if (onQuizChangeRef.current && data.quiz) {
        onQuizChangeRef.current(data.quiz);
      }
    } catch (err) {
      console.error('Error fetching quiz:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [quizId]); // Only depend on quizId to prevent unnecessary re-renders

  // Handle quiz status change
  const handleQuizStatusChange = useCallback(async (newStatus: 'active' | 'paused') => {
    if (!quiz || !csrfToken) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/quizzes/${quiz.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          status: newStatus,
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to update quiz status';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          // If response is not JSON, use status text or default message
          errorMessage = response.statusText || errorMessage;
          console.warn('Failed to parse error response as JSON:', parseError);
        }
        throw new Error(errorMessage);
      }

      // Optimistically update the quiz state to prevent flickering
      setQuiz(prevQuiz => prevQuiz ? { ...prevQuiz, status: newStatus } : null);
      
      // Notify parent component if callback provided using ref to prevent flickering
      if (onQuizChangeRef.current && quiz) {
        onQuizChangeRef.current({ ...quiz, status: newStatus });
      }
      
      setShowStatusConfirm(null);
    } catch (err) {
      console.error('Error updating quiz status:', err);
      setError(err instanceof Error ? err.message : 'Failed to update quiz status');
      // Revert optimistic update on error by refetching
      if (quizId) {
        try {
          const response = await fetch(`/api/admin/quizzes/${quizId}`);
          if (response.ok) {
            const data = await response.json();
            setQuiz(data.quiz);
          }
        } catch (refetchError) {
          console.error('Error refetching quiz after failed update:', refetchError);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [quiz, csrfToken, quizId]); // Removed quiz.id as it's redundant with quiz

  useEffect(() => {
    fetchQuiz();
  }, [fetchQuiz]); // Include fetchQuiz dependency

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500';
      case 'paused':
        return 'bg-yellow-500';
      case 'draft':
        return 'bg-gray-500';
      default:
        return 'bg-gray-500';
    }
  };

  // Get status icon
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="h-4 w-4" />;
      case 'paused':
        return <Pause className="h-4 w-4" />;
      case 'draft':
        return <XCircle className="h-4 w-4" />;
      default:
        return <XCircle className="h-4 w-4" />;
    }
  };

  // Calculate quiz health
  const getQuizHealth = () => {
    if (!quiz || !quiz.questions) return { status: 'unknown', message: 'Loading...' };
    
    const activeQuestions = quiz.questions.filter(q => q.status === 'active').length;
    const totalQuestions = quiz.questions.length;
    
    if (totalQuestions === 0) {
      return { status: 'error', message: 'No questions added' };
    }
    
    if (activeQuestions === 0) {
      return { status: 'warning', message: 'No active questions' };
    }
    
    if (activeQuestions < totalQuestions) {
      return { status: 'warning', message: `${totalQuestions - activeQuestions} questions paused` };
    }
    
    return { status: 'healthy', message: 'All questions active' };
  };

  const quizHealth = getQuizHealth();

  if (isLoading && !quiz) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading quiz details...</span>
      </div>
    );
  }

  if (!quiz) {
    return (
      <div className="glass-card glass-border p-6 rounded-lg">
        <div className="flex items-center justify-center">
          <AlertCircle className="h-8 w-8 text-red-400 mr-2" />
          <span className="text-red-300">Quiz not found</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error Display */}
      {error && (
        <div className="glass-card border-red-500 p-4 rounded-lg">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
            <span className="text-red-300">{error}</span>
          </div>
        </div>
      )}

      {/* Quiz Overview Card */}
      <Card className="glass-card glass-border">
        <CardHeader>
          <div className="flex justify-between items-start">
            <div className="flex-1">
              <CardTitle className="text-xl text-white flex items-center">
                {quiz.title}
                <Badge className={`ml-3 ${getStatusColor(quiz.status)}`}>
                  {getStatusIcon(quiz.status)}
                  <span className="ml-1 capitalize">{quiz.status}</span>
                </Badge>
              </CardTitle>
              <CardDescription className="text-gray-300 mt-2">
                {quiz.description || 'No description provided'}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {/* Questions Stats */}
            <div className="glass-card glass-border p-4 rounded-lg">
              <div className="flex items-center">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <CheckCircle className="h-5 w-5 text-blue-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-gray-300">Questions</p>
                  <p className="text-lg font-semibold text-white">
                    {quiz.questions?.filter(q => q.status === 'active').length || 0} / {quiz._count?.questions || 0}
                  </p>
                </div>
              </div>
            </div>

            {/* Attempts Stats */}
            <div className="glass-card glass-border p-4 rounded-lg">
              <div className="flex items-center">
                <div className="p-2 rounded-lg bg-green-500/20">
                  <Users className="h-5 w-5 text-green-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-gray-300">Total Attempts</p>
                  <p className="text-lg font-semibold text-white">{quiz._count?.attempts || 0}</p>
                </div>
              </div>
            </div>

            {/* Last Updated */}
            <div className="glass-card glass-border p-4 rounded-lg">
              <div className="flex items-center">
                <div className="p-2 rounded-lg bg-purple-500/20">
                  <Clock className="h-5 w-5 text-purple-400" />
                </div>
                <div className="ml-3">
                  <p className="text-sm text-gray-300">Last Updated</p>
                  <p className="text-lg font-semibold text-white">
                    {new Date(quiz.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Quiz Health Status */}
          <div className={`glass-card p-4 rounded-lg mb-6 ${
            quizHealth.status === 'error' ? 'border-red-500' :
            quizHealth.status === 'warning' ? 'border-yellow-500' :
            'border-green-500'
          }`}>
            <div className="flex items-center">
              <div className={`p-2 rounded-lg ${
                quizHealth.status === 'error' ? 'bg-red-500/20' :
                quizHealth.status === 'warning' ? 'bg-yellow-500/20' :
                'bg-green-500/20'
              }`}>
                {quizHealth.status === 'error' ? (
                  <XCircle className="h-5 w-5 text-red-400" />
                ) : quizHealth.status === 'warning' ? (
                  <AlertCircle className="h-5 w-5 text-yellow-400" />
                ) : (
                  <CheckCircle className="h-5 w-5 text-green-400" />
                )}
              </div>
              <div className="ml-3">
                <p className="text-sm text-gray-300">Quiz Health</p>
                <p className={`text-lg font-semibold ${
                  quizHealth.status === 'error' ? 'text-red-300' :
                  quizHealth.status === 'warning' ? 'text-yellow-300' :
                  'text-green-300'
                }`}>
                  {quizHealth.message}
                </p>
              </div>
            </div>
          </div>

          {/* Quiz Controls */}
          <div className="flex flex-col sm:flex-row gap-4">
            {quiz.status === 'active' ? (
              <Button
                onClick={() => setShowStatusConfirm('paused')}
                disabled={isLoading}
                className="glass-card glass-border-yellow bg-yellow-500/20 flex-1"
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Pause className="h-4 w-4 mr-2" />
                Pause Quiz
              </Button>
            ) : (
              <Button
                onClick={() => setShowStatusConfirm('active')}
                disabled={isLoading || quizHealth.status === 'error'}
                className="glass-card glass-border-green bg-green-500/20 flex-1"
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Play className="h-4 w-4 mr-2" />
                Activate Quiz
              </Button>
            )}
          </div>

          {/* Warning for activation */}
          {quiz.status !== 'active' && quizHealth.status === 'error' && (
            <div className="mt-4 p-3 glass-card border-red-500 rounded-lg">
              <p className="text-sm text-red-300">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                Cannot activate quiz: {quizHealth.message}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status Change Confirmation Dialog */}
      <Dialog open={showStatusConfirm !== null} onOpenChange={(open) => {
        if (!open) setShowStatusConfirm(null);
      }}>
        <DialogContent className="glass-card glass-border">
          <DialogHeader>
            <DialogTitle className="text-white">
              {showStatusConfirm === 'active' ? 'Activate Quiz' : 'Pause Quiz'}
            </DialogTitle>
            <DialogDescription className="text-gray-300">
              {showStatusConfirm === 'active' ? (
                <>
                  Are you sure you want to activate this quiz? Once activated, users will be able to take the quiz.
                  {quizHealth.status === 'warning' && (
                    <div className="mt-2 p-2 bg-yellow-500/20 border border-yellow-500 rounded">
                      <p className="text-yellow-300 text-sm">
                        <AlertCircle className="h-4 w-4 inline mr-1" />
                        Warning: {quizHealth.message}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                'Are you sure you want to pause this quiz? Users will not be able to take the quiz while it\'s paused.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowStatusConfirm(null)}
              className="glass-card glass-border"
            >
              Cancel
            </Button>
            <Button
              onClick={() => showStatusConfirm && handleQuizStatusChange(showStatusConfirm)}
              disabled={isLoading}
              className={`glass-card ${
                showStatusConfirm === 'active' 
                  ? 'glass-border-green bg-green-500/20' 
                  : 'glass-border-yellow bg-yellow-500/20'
              }`}
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {showStatusConfirm === 'active' ? (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Activate Quiz
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause Quiz
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}