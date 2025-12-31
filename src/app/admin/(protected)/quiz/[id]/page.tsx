'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import QuizManagement from '@/components/admin/QuizManagement';
import QuestionManagement from '@/components/admin/QuestionManagement';

interface Quiz {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'paused' | 'draft';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function QuizManagementPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const quizId = params?.id as string;

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  // Fetch quiz details
  const fetchQuiz = useCallback(async () => {
    if (!quizId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/quizzes/${quizId}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to fetch quiz:', errorData);

        if (response.status === 404) {
          throw new Error('Quiz not found');
        }
        throw new Error(errorData.message || 'Failed to fetch quiz');
      }

      const data = await response.json();
      setQuiz(data.quiz);
    } catch (err) {
      console.error('Error fetching quiz:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [quizId]);

  useEffect(() => {
    fetchQuiz();
  }, [fetchQuiz]);

  // Handle quiz updates
  const handleQuizChange = (updatedQuiz: Quiz) => {
    setQuiz(updatedQuiz);
  };

  // Authentication check
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
          <span className="text-white">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    router.push('/login');
    return null;
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8">
            <Link
              href="/admin/dashboard"
              className="inline-flex items-center text-blue-400 hover:text-blue-300 mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Admin Dashboard
            </Link>
          </div>

          {/* Error Display */}
          <Card className="glass-card border-red-500">
            <CardContent className="p-8 text-center">
              <AlertCircle className="h-16 w-16 text-red-400 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-white mb-2">Error</h1>
              <p className="text-red-300 mb-6">{error}</p>
              <div className="space-x-4">
                <Button
                  onClick={fetchQuiz}
                  className="glass-card-blue glass-border-blue"
                >
                  Try Again
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push('/admin/dashboard')}
                  className="glass-card glass-border"
                >
                  Go Back
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="mb-8">
            <Link
              href="/admin/dashboard"
              className="inline-flex items-center text-blue-400 hover:text-blue-300 mb-4"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Admin Dashboard
            </Link>
          </div>

          {/* Loading Display */}
          <Card className="glass-card glass-border">
            <CardContent className="p-8 text-center">
              <Loader2 className="h-16 w-16 text-blue-400 mx-auto mb-4 animate-spin" />
              <h1 className="text-2xl font-bold text-white mb-2">Loading Quiz</h1>
              <p className="text-gray-300">Please wait while we fetch the quiz details...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-glass-dark">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center text-blue-400 hover:text-blue-300 mb-4 glass-transition"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Admin Dashboard
          </Link>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white">
                {quiz?.title || 'Quiz Management'}
              </h1>
              <p className="text-gray-300 mt-1">
                Manage quiz settings and questions
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="glass-card glass-border">
            <TabsTrigger
              value="overview"
              className="data-[state=active]:glass-card-blue data-[state=active]:glass-border-blue"
            >
              Quiz Overview
            </TabsTrigger>
            <TabsTrigger
              value="questions"
              className="data-[state=active]:glass-card-blue data-[state=active]:glass-border-blue"
            >
              Question Management
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <Card className="glass-card glass-border">
              <CardHeader>
                <CardTitle className="text-white">Quiz Settings & Status</CardTitle>
                <CardDescription className="text-gray-300">
                  Manage quiz activation, status, and overall settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                {quiz && (
                  <QuizManagement
                    quizId={quiz.id}
                    onQuizChange={handleQuizChange}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="questions" className="space-y-6">
            <Card className="glass-card glass-border">
              <CardHeader>
                <CardTitle className="text-white">Question Management</CardTitle>
                <CardDescription className="text-gray-300">
                  Add, edit, delete, and manage individual quiz questions
                </CardDescription>
              </CardHeader>
              <CardContent>
                {quiz && (
                  <QuestionManagement
                    quizId={quiz.id}
                    onQuestionsChange={(questions) => {
                      // Optional: Handle questions change if needed
                      console.log('Questions updated:', questions.length);
                    }}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}