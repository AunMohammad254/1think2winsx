'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import QuizEvaluationManager from '@/components/QuizEvaluationManager';
import PlayerClaimsManager from '@/components/admin/PlayerClaimsManager';
import StreamingManager from '@/components/admin/StreamingManager';

type SystemStats = {
  totalUsers: number;
  totalQuizzes: number;
  totalQuizAttempts: number;
  totalPayments: number;
  recentUsers: number;
  recentQuizAttempts: number;
  totalRevenue: number;
  averageScore: number;
};

type BulkDeleteResult = {
  quizId: string;
  success: boolean;
  error: string | null;
};

type Quiz = {
  id: string;
  title: string;
  description: string | null;
  duration?: number;
  passingScore?: number;
  status?: string;
  createdAt: string;
  updatedAt?: string;
  startDate?: string;
  endDate?: string;
  isActive?: boolean;
  questions?: Question[];
  stats?: {
    totalQuestions: number;
    activeQuestions: number;
    questionsWithAnswers: number;
    totalAttempts: number;
    completedAttempts: number;
    completionRate: number;
    averageScore: number;
  };
  // Keep _count for backward compatibility but make it optional
  _count?: {
    questions: number;
  };
};

type Question = {
  id?: string;
  text: string;
  options: string[];
  correctOption: number;
};

interface QuizQuestion {
  id: string;
  text: string;
  options: string | string[];
  correctOption: number | null;
  createdAt?: string;
  updatedAt?: string;
  quizId?: string;
}

type QuizFormData = {
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  questions: Question[];
};

export default function AdminDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<SystemStats | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'quizzes' | 'evaluation' | 'claims' | 'streaming' | 'maintenance'>('overview');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Quiz management state
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [showQuizForm, setShowQuizForm] = useState(false);
  const [editingQuiz, setEditingQuiz] = useState<Quiz | null>(null);
  const [selectedQuizzes, setSelectedQuizzes] = useState<string[]>([]);
  const [quizFormData, setQuizFormData] = useState<QuizFormData>({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    isActive: true,
    questions: []
  });

  // Loading states for better UX
  const [isCreatingQuiz, setIsCreatingQuiz] = useState(false);
  const [isUpdatingQuiz, setIsUpdatingQuiz] = useState(false);
  const [_isDeletingQuiz, _setIsDeletingQuiz] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Fetch stats
      const statsResponse = await fetch('/api/admin/stats');
      if (statsResponse.status === 403) {
        setError('Access denied. Admin privileges required.');
        return;
      }
      if (!statsResponse.ok) {
        throw new Error('Failed to fetch stats');
      }
      const statsData = await statsResponse.json();
      setStats(statsData);



      // Fetch quizzes
      await fetchQuizzes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }

    if (status === 'authenticated') {
      fetchData();
    }
  }, [status, router, fetchData]);

  const fetchQuizzes = async () => {
    try {
      const response = await fetch('/api/admin/quizzes');
      if (response.ok) {
        const data = await response.json();

        // Handle the admin API response structure with quizzes array
        const quizzesArray = data.quizzes || [];

        // Ensure we have an array before setting - admin API returns proper structure
        if (Array.isArray(quizzesArray)) {
          setQuizzes(quizzesArray);
        } else {
          console.error('Admin API response does not contain a valid quizzes array:', data);
          setQuizzes([]);
        }
      } else {
        console.error('Failed to fetch quizzes from admin API:', response.status, response.statusText);
        setQuizzes([]);
      }
    } catch (err) {
      console.error('Failed to fetch quizzes:', err);
      setQuizzes([]);
    }
  };



  const handleCreateQuiz = async () => {
    // Validation
    if (!quizFormData.title.trim()) {
      alert('Please enter a quiz title.');
      return;
    }
    if (quizFormData.questions.length === 0) {
      alert('Please add at least one question to the quiz.');
      return;
    }

    // Validate each question
    for (let i = 0; i < quizFormData.questions.length; i++) {
      const question = quizFormData.questions[i];
      if (!question.text.trim()) {
        alert(`Please enter text for question ${i + 1}.`);
        return;
      }
      if (question.options.some(option => !option.trim())) {
        alert(`Please fill in all options for question ${i + 1}.`);
        return;
      }
    }

    setIsCreatingQuiz(true);

    // Optimistic update - add quiz to list immediately
    const optimisticQuiz: Quiz = {
      id: `temp-${Date.now()}`,
      title: quizFormData.title,
      description: quizFormData.description,
      startDate: quizFormData.startDate,
      endDate: quizFormData.endDate,
      isActive: quizFormData.isActive,
      createdAt: new Date().toISOString(),
      _count: { questions: quizFormData.questions.length }
    };

    setQuizzes(prev => [optimisticQuiz, ...prev]);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      // Get CSRF token
      const csrfResponse = await fetch('/api/csrf-token');
      if (!csrfResponse.ok) {
        throw new Error('Failed to get CSRF token');
      }
      const { csrfToken } = await csrfResponse.json();

      // Prepare data for new API format
      const requestData = {
        title: quizFormData.title,
        description: quizFormData.description || null,
        timeLimit: 600, // Default 10 minutes
        isActive: quizFormData.isActive,
        questions: quizFormData.questions.map((q, _index) => ({
          text: q.text,
          options: q.options,
          correctAnswer: q.correctOption,
          isActive: true,
        }))
      };

      const response = await fetch('/api/admin/quizzes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(requestData),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const result = await response.json();

        // Replace optimistic quiz with real data
        setQuizzes(prev => prev.map(quiz =>
          quiz.id === optimisticQuiz.id
            ? {
              ...result.quiz,
              _count: { questions: result.quiz.questions?.length || 0 },
              startDate: quizFormData.startDate,
              endDate: quizFormData.endDate
            }
            : quiz
        ));

        alert('Quiz created successfully!');
        setShowQuizForm(false);
        resetQuizForm();
      } else {
        // Remove optimistic quiz on error
        setQuizzes(prev => prev.filter(quiz => quiz.id !== optimisticQuiz.id));

        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        alert(`Failed to create quiz: ${errorData.error || 'Server error'}`);
      }
    } catch (error: unknown) {
      // Remove optimistic quiz on error
      setQuizzes(prev => prev.filter(quiz => quiz.id !== optimisticQuiz.id));

      if (error instanceof Error && error.name === 'AbortError') {
        alert('Create operation timed out. Please try again.');
      } else {
        console.error('Create error:', error);
        alert('Error creating quiz. Please check your connection and try again.');
      }
    } finally {
      setIsCreatingQuiz(false);
    }
  };

  const handleUpdateQuiz = async () => {
    if (!editingQuiz) return;

    console.log('Starting quiz update for quiz:', editingQuiz.id);
    console.log('Quiz form data:', quizFormData);

    // Validation
    if (!quizFormData.title.trim()) {
      alert('Please enter a quiz title.');
      return;
    }
    if (quizFormData.questions.length === 0) {
      alert('Please add at least one question to the quiz.');
      return;
    }

    // Validate each question
    for (let i = 0; i < quizFormData.questions.length; i++) {
      const question = quizFormData.questions[i];
      if (!question.text.trim()) {
        alert(`Please enter text for question ${i + 1}.`);
        return;
      }
      if (question.options.some(option => !option.trim())) {
        alert(`Please fill in all options for question ${i + 1}.`);
        return;
      }
    }

    setIsUpdatingQuiz(true);

    // Store original quiz for rollback
    const originalQuiz = quizzes.find(q => q.id === editingQuiz.id);

    // Optimistic update
    const updatedQuiz: Quiz = {
      ...editingQuiz,
      title: quizFormData.title,
      description: quizFormData.description,
      startDate: quizFormData.startDate,
      endDate: quizFormData.endDate,
      isActive: quizFormData.isActive,
      _count: { questions: quizFormData.questions.length }
    };

    setQuizzes(prev => prev.map(quiz =>
      quiz.id === editingQuiz.id ? updatedQuiz : quiz
    ));

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      // Prepare questions data for new API format
      const questionsData = quizFormData.questions.map((q, index) => ({
        id: q.id?.startsWith('temp-') ? undefined : q.id,
        text: q.text,
        options: q.options,
        correctAnswer: q.correctOption,
        isActive: true,
        order: index
      }));

      const requestBody = {
        title: quizFormData.title,
        description: quizFormData.description || null,
        timeLimit: 600, // Default 10 minutes
        isActive: quizFormData.isActive,
        questions: questionsData
      };

      console.log('Sending update request with body:', requestBody);

      const response = await fetch(`/api/admin/quizzes/${editingQuiz.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const result = await response.json();
        console.log('Quiz updated successfully:', result);

        // Update with real data from server
        setQuizzes(prev => prev.map(quiz =>
          quiz.id === editingQuiz.id
            ? {
              ...result.quiz,
              _count: { questions: result.quiz.questions?.length || 0 },
              startDate: quizFormData.startDate,
              endDate: quizFormData.endDate
            }
            : quiz
        ));

        alert('Quiz updated successfully!');
        setShowQuizForm(false);
        setEditingQuiz(null);
        resetQuizForm();
      } else {
        // Rollback optimistic update
        if (originalQuiz) {
          setQuizzes(prev => prev.map(quiz =>
            quiz.id === editingQuiz.id ? originalQuiz : quiz
          ));
        }

        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Update failed:', errorData);
        alert(`Failed to update quiz: ${errorData.error || 'Server error'}`);
      }
    } catch (error: unknown) {
      // Rollback optimistic update
      if (originalQuiz) {
        setQuizzes(prev => prev.map(quiz =>
          quiz.id === editingQuiz.id ? originalQuiz : quiz
        ));
      }

      if (error instanceof Error && error.name === 'AbortError') {
        alert('Update operation timed out. Please try again.');
      } else {
        console.error('Update error:', error);
        alert('Error updating quiz. Please check your connection and try again.');
      }
    } finally {
      setIsUpdatingQuiz(false);
    }
  };

  // New enhanced functions for quiz management
  const _handleToggleQuizStatus = async (quizId: string, isActive: boolean) => {
    try {
      // Optimistic update
      setQuizzes(prev => prev.map(quiz =>
        quiz.id === quizId ? { ...quiz, isActive } : quiz
      ));

      const response = await fetch(`/api/admin/quizzes/${quizId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update quiz status');
      }

      const result = await response.json();

      // Update with server response
      setQuizzes(prev => prev.map(quiz =>
        quiz.id === quizId ? { ...quiz, ...result.quiz } : quiz
      ));

    } catch (error) {
      console.error('Error updating quiz status:', error);
      // Revert optimistic update on error
      fetchQuizzes();
      alert(error instanceof Error ? error.message : 'Failed to update quiz status');
    }
  };

  const handleDeleteQuiz = async (quizId: string) => {
    if (!confirm('Are you sure you want to delete this quiz? This action cannot be undone.')) {
      return;
    }

    try {
      // Get CSRF token
      const csrfResponse = await fetch('/api/csrf-token');
      const { csrfToken } = await csrfResponse.json();

      const response = await fetch(`/api/admin/quizzes/${quizId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
      });

      if (!response.ok) {
        let errorMessage = 'Failed to delete quiz';
        try {
          const errorData = await response.json();
          if (errorData.hasAttempts) {
            alert(`Cannot delete quiz with ${errorData.attemptCount} existing attempts. Consider deactivating instead.`);
            return;
          }
          errorMessage = errorData.error || errorData.message || 'Failed to delete quiz';
        } catch (parseError) {
          // If JSON parsing fails, use default error message
          console.error('Error parsing response:', parseError);
        }
        throw new Error(errorMessage);
      }

      // Remove quiz from state
      setQuizzes(prev => prev.filter(quiz => quiz.id !== quizId));

    } catch (error) {
      console.error('Error deleting quiz:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete quiz');
    }
  };

  const resetQuizForm = () => {
    setQuizFormData({
      title: '',
      description: '',
      startDate: '',
      endDate: '',
      isActive: true,
      questions: []
    });
    setEditingQuiz(null);
  };

  const _handleSelectQuiz = (quizId: string) => {
    setSelectedQuizzes(prev =>
      prev.includes(quizId)
        ? prev.filter(id => id !== quizId)
        : [...prev, quizId]
    );
  };

  const _handleSelectAll = () => {
    if (selectedQuizzes.length === (quizzes?.length || 0)) {
      setSelectedQuizzes([]);
    } else {
      setSelectedQuizzes(quizzes?.map(quiz => quiz.id) || []);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedQuizzes.length === 0) {
      alert('Please select quizzes to delete.');
      return;
    }

    const confirmed = confirm(`Are you sure you want to delete ${selectedQuizzes.length} selected quiz(es)? This action cannot be undone.`);
    if (!confirmed) return;

    setLoading(true);
    try {
      // Get CSRF token
      const csrfResponse = await fetch('/api/csrf-token');
      const { csrfToken } = await csrfResponse.json();

      const deletePromises = selectedQuizzes.map(async (quizId): Promise<BulkDeleteResult> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(`/api/admin/quizzes/${quizId}`, {
          method: 'DELETE',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
        });

        clearTimeout(timeoutId);
        return { quizId, success: response.ok, error: response.ok ? null : await response.text() };
      });

      const results = await Promise.all(deletePromises);
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      if (failed === 0) {
        alert(`Successfully deleted ${successful} quiz(es).`);
      } else {
        alert(`Deleted ${successful} quiz(es). Failed to delete ${failed} quiz(es).`);
      }

      setSelectedQuizzes([]);
      await fetchQuizzes();
    } catch (error: unknown) {
      console.error('Bulk delete error:', error);
      alert('Error during bulk delete operation. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditQuiz = async (quiz: Quiz) => {
    try {
      setLoading(true);
      console.log('Editing quiz:', quiz.id);

      // Fetch complete quiz data with questions from the admin quiz endpoint
      const response = await fetch(`/api/admin/quizzes/${quiz.id}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        console.error('Failed to fetch quiz details:', errorData);
        throw new Error(errorData.message || 'Failed to load quiz');
      }

      const responseData = await response.json();
      console.log('Fetched response data:', responseData);

      // Extract quiz data from the response - the API returns data nested under 'quiz' property
      const completeQuizData = responseData.quiz || responseData;
      console.log('Complete quiz data:', completeQuizData);

      // Process questions to ensure options are arrays and handle correct answers
      const processedQuestions = completeQuizData.questions?.map((q: QuizQuestion) => {
        console.log('Processing question:', q);
        return {
          id: q.id,
          text: q.text,
          options: Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? JSON.parse(q.options) : []),
          correctOption: q.correctOption !== null && q.correctOption !== undefined ? q.correctOption : 0
        };
      }) || [];

      console.log('Processed questions:', processedQuestions);

      setEditingQuiz(quiz);
      setQuizFormData({
        title: completeQuizData.title || '',
        description: completeQuizData.description || '',
        startDate: completeQuizData.startDate ? new Date(completeQuizData.startDate).toISOString().split('T')[0] : '',
        endDate: completeQuizData.endDate ? new Date(completeQuizData.endDate).toISOString().split('T')[0] : '',
        isActive: completeQuizData.status === 'active' || (completeQuizData.isActive !== undefined ? completeQuizData.isActive : true),
        questions: processedQuestions
      });
      setShowQuizForm(true);
    } catch (error) {
      console.error('Error fetching quiz details for editing:', error);
      alert('Failed to load quiz. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const addQuestion = () => {
    const newQuestion: Question = {
      id: `temp-${Date.now()}`,
      text: '',
      options: ['', '', '', ''],
      correctOption: 0
    };
    setQuizFormData({
      ...quizFormData,
      questions: [...quizFormData.questions, newQuestion]
    });
  };

  const removeQuestion = (index: number) => {
    const updatedQuestions = quizFormData.questions.filter((_, i) => i !== index);
    setQuizFormData({
      ...quizFormData,
      questions: updatedQuestions
    });
  };

  const updateQuestion = (questionIndex: number, field: string, value: string | string[] | number) => {
    const updatedQuestions = [...quizFormData.questions];
    updatedQuestions[questionIndex] = {
      ...updatedQuestions[questionIndex],
      [field]: value
    };
    setQuizFormData({
      ...quizFormData,
      questions: updatedQuestions
    });
  };

  const updateQuestionOption = (questionIndex: number, optionIndex: number, value: string) => {
    const updatedQuestions = [...quizFormData.questions];
    const updatedOptions = [...updatedQuestions[questionIndex].options];
    updatedOptions[optionIndex] = value;
    updatedQuestions[questionIndex] = {
      ...updatedQuestions[questionIndex],
      options: updatedOptions
    };
    setQuizFormData({
      ...quizFormData,
      questions: updatedQuestions
    });
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-400"></div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-t-2 border-b-2 border-blue-400"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-glass-dark flex items-center justify-center">
        <div className="glass-card glass-transition glass-hover p-8 rounded-lg text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Error</h1>
          <p className="text-gray-200 mb-4">{error}</p>
          <Link
            href="/"
            className="inline-flex items-center px-4 py-2 glass-card-blue glass-border-blue glass-hover-blue glass-transition text-white rounded-md"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-glass-dark">
      {/* Header */}
      <div className="glass-card-blue glass-border-blue">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4 sm:py-6">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-white truncate">Admin Dashboard</h1>
              <p className="text-gray-200 text-sm sm:text-base hidden sm:block">Manage your quiz platform</p>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-4 flex-shrink-0">
              <Link
                href="/admin/db-stats"
                className="glass-card glass-border-blue glass-hover glass-transition text-white px-2 sm:px-4 py-2 rounded-md text-xs sm:text-sm"
              >
                <span className="hidden sm:inline">Database Stats</span>
                <span className="sm:hidden">📊</span>
              </Link>
              <Link
                href="/admin/security"
                className="glass-card glass-border-blue glass-hover glass-transition text-white px-2 sm:px-4 py-2 rounded-md text-xs sm:text-sm"
              >
                <span className="hidden sm:inline">Security</span>
                <span className="sm:hidden">🔒</span>
              </Link>
              <span className="text-gray-200 text-xs sm:text-sm hidden md:block truncate max-w-[150px]">
                Welcome, {session?.user?.name}
              </span>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="md:hidden p-2 rounded-lg bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all duration-300 backdrop-blur-sm"
              >
                <div className="w-5 h-5 flex flex-col justify-center items-center space-y-0.5">
                  <div className={`w-4 h-0.5 bg-white transition-all duration-300 ${isMobileMenuOpen ? 'rotate-45 translate-y-1' : ''}`}></div>
                  <div className={`w-4 h-0.5 bg-white transition-all duration-300 ${isMobileMenuOpen ? 'opacity-0' : ''}`}></div>
                  <div className={`w-4 h-0.5 bg-white transition-all duration-300 ${isMobileMenuOpen ? '-rotate-45 -translate-y-1' : ''}`}></div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="glass-card glass-border-blue">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Desktop Navigation */}
          <nav className="hidden md:flex space-x-8 overflow-x-auto">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-2 px-1 border-b-2 font-medium text-sm glass-transition whitespace-nowrap ${activeTab === 'overview'
                  ? 'border-blue-400 text-blue-300'
                  : 'border-transparent text-gray-300 hover:text-white hover:border-blue-300'
                }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('quizzes')}
              className={`py-2 px-1 border-b-2 font-medium text-sm glass-transition whitespace-nowrap ${activeTab === 'quizzes'
                  ? 'border-blue-400 text-blue-300'
                  : 'border-transparent text-gray-300 hover:text-white hover:border-blue-300'
                }`}
            >
              Quiz Management
            </button>
            <button
              onClick={() => setActiveTab('evaluation')}
              className={`py-2 px-1 border-b-2 font-medium text-sm glass-transition whitespace-nowrap ${activeTab === 'evaluation'
                  ? 'border-blue-400 text-blue-300'
                  : 'border-transparent text-gray-300 hover:text-white hover:border-blue-300'
                }`}
            >
              Quiz Evaluation
            </button>
            <button
              onClick={() => setActiveTab('claims')}
              className={`py-2 px-1 border-b-2 font-medium text-sm glass-transition whitespace-nowrap ${activeTab === 'claims'
                  ? 'border-blue-400 text-blue-300'
                  : 'border-transparent text-gray-300 hover:text-white hover:border-blue-300'
                }`}
            >
              Player Claims
            </button>
            <button
              onClick={() => setActiveTab('streaming')}
              className={`py-2 px-1 border-b-2 font-medium text-sm glass-transition whitespace-nowrap ${activeTab === 'streaming'
                  ? 'border-blue-400 text-blue-300'
                  : 'border-transparent text-gray-300 hover:text-white hover:border-blue-300'
                }`}
            >
              Live Streaming
            </button>
            <button
              onClick={() => setActiveTab('maintenance')}
              className={`py-2 px-1 border-b-2 font-medium text-sm glass-transition whitespace-nowrap ${activeTab === 'maintenance'
                  ? 'border-blue-400 text-blue-300'
                  : 'border-transparent text-gray-300 hover:text-white hover:border-blue-300'
                }`}
            >
              Maintenance
            </button>
          </nav>

          {/* Mobile Navigation Menu */}
          <div className={`md:hidden transition-all duration-300 overflow-hidden ${isMobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="py-2 space-y-1">
              {[
                { key: 'overview', label: 'Overview', icon: '📊' },
                { key: 'quizzes', label: 'Quiz Management', icon: '📝' },
                { key: 'evaluation', label: 'Quiz Evaluation', icon: '✅' },
                { key: 'claims', label: 'Player Claims', icon: '🏆' },
                { key: 'streaming', label: 'Live Streaming', icon: '📺' },
                { key: 'maintenance', label: 'Maintenance', icon: '🔧' }
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    setActiveTab(item.key as 'overview' | 'quizzes' | 'evaluation' | 'claims' | 'streaming' | 'maintenance');
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-all duration-300 ${activeTab === item.key
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                      : 'text-gray-300 hover:text-white hover:bg-white/10'
                    }`}
                >
                  <span className="text-lg">{item.icon}</span>
                  <span className="font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {activeTab === 'overview' && (
          <div className="space-y-4 sm:space-y-6">
            {/* Stats Grid */}
            {stats && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                <div className="glass-card glass-transition glass-hover p-4 sm:p-6 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-gradient-glass-blue glass-border-blue rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">U</span>
                      </div>
                    </div>
                    <div className="ml-3 sm:ml-4 min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-medium text-gray-200 truncate">Total Users</p>
                      <p className="text-xl sm:text-2xl font-semibold text-white">{stats.totalUsers}</p>
                    </div>
                  </div>
                </div>

                <div className="glass-card glass-transition glass-hover p-4 sm:p-6 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-gradient-glass-blue glass-border-blue rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">Q</span>
                      </div>
                    </div>
                    <div className="ml-3 sm:ml-4 min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-medium text-gray-200 truncate">Total Quizzes</p>
                      <p className="text-xl sm:text-2xl font-semibold text-white">{stats.totalQuizzes}</p>
                    </div>
                  </div>
                </div>

                <div className="glass-card glass-transition glass-hover p-4 sm:p-6 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-gradient-glass-blue glass-border-blue rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">A</span>
                      </div>
                    </div>
                    <div className="ml-3 sm:ml-4 min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-medium text-gray-200 truncate">Quiz Attempts</p>
                      <p className="text-xl sm:text-2xl font-semibold text-white">{stats.totalQuizAttempts}</p>
                    </div>
                  </div>
                </div>

                <div className="glass-card glass-transition glass-hover p-4 sm:p-6 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-gradient-glass-blue glass-border-blue rounded-md flex items-center justify-center">
                        <span className="text-white font-bold text-sm">$</span>
                      </div>
                    </div>
                    <div className="ml-3 sm:ml-4 min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-200">Total Revenue</p>
                      <p className="text-2xl font-semibold text-white">PKR {stats.totalRevenue}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'quizzes' && (
          <div className="space-y-6">
            {/* Quiz Management Header */}
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-white">Quiz Management</h2>
              <button
                onClick={() => {
                  setEditingQuiz(null);
                  resetQuizForm();
                  setShowQuizForm(true);
                }}
                className="glass-card-blue glass-border-blue glass-hover-blue glass-transition text-white px-4 py-2 rounded-md"
              >
                Create New Quiz
              </button>
            </div>

            {/* Quiz Form */}
            {showQuizForm && (
              <div className="glass-card glass-transition glass-hover rounded-lg">
                <div className="px-6 py-4 border-b border-blue-400">
                  <h3 className="text-lg font-medium text-white">
                    {editingQuiz ? 'Edit Quiz' : 'Create New Quiz'}
                  </h3>
                </div>
                <div className="p-6 space-y-6">
                  {/* Basic Quiz Information */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-200 mb-2">
                        Quiz Title *
                      </label>
                      <input
                        type="text"
                        value={quizFormData.title}
                        onChange={(e) => setQuizFormData({ ...quizFormData, title: e.target.value })}
                        className="w-full px-3 py-2 glass-card border border-blue-400 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        placeholder="Enter quiz title"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-200 mb-2">
                        Description
                      </label>
                      <textarea
                        value={quizFormData.description}
                        onChange={(e) => setQuizFormData({ ...quizFormData, description: e.target.value })}
                        className="w-full px-3 py-2 glass-card border border-blue-400 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        placeholder="Enter quiz description"
                        rows={3}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-200 mb-2">
                        Start Date *
                      </label>
                      <input
                        type="date"
                        value={quizFormData.startDate}
                        onChange={(e) => setQuizFormData({ ...quizFormData, startDate: e.target.value })}
                        className="w-full px-3 py-2 glass-card border border-blue-400 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-200 mb-2">
                        End Date *
                      </label>
                      <input
                        type="date"
                        value={quizFormData.endDate}
                        onChange={(e) => setQuizFormData({ ...quizFormData, endDate: e.target.value })}
                        className="w-full px-3 py-2 glass-card border border-blue-400 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                    <div className="flex items-center">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={quizFormData.isActive}
                          onChange={(e) => setQuizFormData({ ...quizFormData, isActive: e.target.checked })}
                          className="rounded border-blue-400 text-blue-500 focus:ring-blue-400"
                        />
                        <span className="ml-2 text-sm text-gray-200">Active</span>
                      </label>
                    </div>
                  </div>

                  {/* Questions Management Section */}
                  <div className="border-t border-blue-400 pt-6">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-lg font-medium text-white">Questions</h4>
                      <button
                        onClick={addQuestion}
                        disabled={loading}
                        className="glass-card-blue glass-border-blue glass-hover-blue glass-transition text-white px-4 py-2 rounded-md disabled:opacity-50"
                      >
                        {loading ? 'Adding...' : 'Add Question'}
                      </button>
                    </div>

                    {quizFormData.questions.length === 0 ? (
                      <p className="text-gray-300 text-center py-8">No questions added yet. Click &quot;Add Question&quot; to get started.</p>
                    ) : (
                      <div className="space-y-4">
                        {quizFormData.questions.map((question, questionIndex) => (
                          <div key={`question-${questionIndex}`} className="glass-card glass-border-blue p-4 rounded-lg">
                            <div className="flex justify-between items-start mb-4">
                              <h5 className="text-white font-medium">Question {questionIndex + 1}</h5>
                              <button
                                onClick={() => removeQuestion(questionIndex)}
                                className="text-red-400 hover:text-red-300 glass-transition"
                              >
                                Remove
                              </button>
                            </div>

                            <div className="space-y-4">
                              <div>
                                <label className="block text-sm font-medium text-gray-200 mb-2">
                                  Question Text *
                                </label>
                                <input
                                  type="text"
                                  value={question.text}
                                  onChange={(e) => updateQuestion(questionIndex, 'text', e.target.value)}
                                  className="w-full px-3 py-2 glass-card border border-blue-400 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                  placeholder="Enter question text"
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-200 mb-2">
                                  Answer Options *
                                </label>
                                <div className="space-y-2">
                                  {question.options.map((option, optionIndex) => (
                                    <div key={`option-${questionIndex}-${optionIndex}`} className="flex items-center space-x-3">
                                      <input
                                        type="radio"
                                        name={`correct-${questionIndex}`}
                                        checked={question.correctOption === optionIndex}
                                        onChange={() => updateQuestion(questionIndex, 'correctOption', optionIndex)}
                                        className="rounded border-blue-400 text-blue-500 focus:ring-blue-400"
                                      />
                                      <input
                                        type="text"
                                        value={option}
                                        onChange={(e) => updateQuestionOption(questionIndex, optionIndex, e.target.value)}
                                        className="flex-1 px-3 py-2 glass-card border border-blue-400 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        placeholder={`Option ${optionIndex + 1}`}
                                      />
                                    </div>
                                  ))}
                                </div>
                                <p className="text-xs text-blue-300 mt-1">Select the radio button next to the correct answer</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Form Actions */}
                  <div className="flex justify-end space-x-4 pt-6 border-t border-blue-400">
                    <button
                      onClick={() => {
                        setShowQuizForm(false);
                        setEditingQuiz(null);
                        resetQuizForm();
                      }}
                      className="glass-card glass-border-blue glass-hover glass-transition text-gray-200 px-6 py-2 rounded-md"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={editingQuiz ? handleUpdateQuiz : handleCreateQuiz}
                      disabled={isCreatingQuiz || isUpdatingQuiz}
                      className="glass-card-blue glass-border-blue glass-hover-blue glass-transition text-white px-6 py-2 rounded-md disabled:opacity-50"
                    >
                      {isCreatingQuiz ? 'Creating...' : isUpdatingQuiz ? 'Updating...' : (editingQuiz ? 'Update Quiz' : 'Create Quiz')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Bulk Operations */}
            {selectedQuizzes.length > 0 && (
              <div className="glass-card-blue glass-border-blue p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-blue-200">
                    {selectedQuizzes.length} quiz(es) selected
                  </span>
                  <div className="flex space-x-2">
                    <button
                      onClick={handleBulkDelete}
                      disabled={loading}
                      className="bg-red-600 text-white px-4 py-2 rounded-md glass-transition hover:bg-red-700 disabled:opacity-50"
                    >
                      Delete Selected
                    </button>
                    <button
                      onClick={() => setSelectedQuizzes([])}
                      className="glass-card glass-border-blue glass-hover text-gray-200 px-4 py-2 rounded-md glass-transition"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Quiz List */}
            <div className="glass-card glass-transition glass-hover rounded-lg overflow-hidden">
              <div className="px-6 py-4 glass-card-blue border-b border-blue-400">
                <h3 className="text-lg font-medium text-white">All Quizzes</h3>
              </div>

              {loading ? (
                <div className="p-8 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-400 mx-auto"></div>
                  <p className="text-gray-200 mt-2">Loading quizzes...</p>
                </div>
              ) : quizzes.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-gray-300">No quizzes found. Create your first quiz to get started.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-blue-400">
                    <thead className="glass-card-blue">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                          <input
                            type="checkbox"
                            checked={selectedQuizzes.length === quizzes.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedQuizzes(quizzes.map(q => q.id));
                              } else {
                                setSelectedQuizzes([]);
                              }
                            }}
                            className="rounded border-blue-400 text-blue-500 focus:ring-blue-400"
                          />
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                          Title
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                          Questions
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                          Dates
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-white uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-blue-400">
                      {quizzes.map((quiz) => (
                        <tr key={quiz.id} className="glass-hover glass-transition">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <input
                              type="checkbox"
                              checked={selectedQuizzes.includes(quiz.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedQuizzes([...selectedQuizzes, quiz.id]);
                                } else {
                                  setSelectedQuizzes(selectedQuizzes.filter(id => id !== quiz.id));
                                }
                              }}
                              className="rounded border-blue-400 text-blue-500 focus:ring-blue-400"
                            />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-white">{quiz.title}</div>
                            <div className="text-sm text-gray-200">{quiz.description}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            {quiz.stats?.totalQuestions || quiz._count?.questions || 0} questions
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded ${(quiz.status === 'active' || quiz.isActive)
                                ? 'bg-green-500 bg-opacity-20 text-green-300 border border-green-400'
                                : 'bg-red-500 bg-opacity-20 text-red-300 border border-red-400'
                              }`}>
                              {(quiz.status === 'active' || quiz.isActive) ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                            <div>Created: {new Date(quiz.createdAt).toLocaleDateString()}</div>
                            {quiz.updatedAt && <div>Updated: {new Date(quiz.updatedAt).toLocaleDateString()}</div>}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <div className="flex space-x-2">
                              <Link
                                href={`/admin/quiz/${quiz.id}`}
                                className="text-green-300 hover:text-green-200 glass-transition"
                              >
                                Manage
                              </Link>
                              <button
                                onClick={() => handleEditQuiz(quiz)}
                                className="text-blue-300 hover:text-blue-200 glass-transition"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteQuiz(quiz.id)}
                                className="text-red-300 hover:text-red-200 glass-transition"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'evaluation' && (
          <div className="space-y-6">
            {/* Quiz Evaluation Section */}
            <div className="glass-card glass-transition glass-hover rounded-lg">
              <div className="px-6 py-4 border-b border-blue-400">
                <h3 className="text-lg font-medium text-white">Quiz Evaluation & Points Allocation</h3>
                <p className="text-sm text-gray-200 mt-1">Add correct answers to quizzes and allocate points to top performers</p>
              </div>
              <div className="p-6">
                <QuizEvaluationManager />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'claims' && (
          <div className="space-y-6">
            <PlayerClaimsManager />
          </div>
        )}

        {activeTab === 'streaming' && (
          <div className="space-y-6">
            <StreamingManager />
          </div>
        )}

        {activeTab === 'maintenance' && (
          <div className="space-y-6">
            <div className="glass-card glass-transition glass-hover rounded-lg">
              <div className="px-6 py-4 border-b border-blue-400">
                <h3 className="text-lg font-medium text-white">System Maintenance</h3>
              </div>
              <div className="p-6">
                <div className="space-y-4">


                  <div className="flex items-center justify-between p-4 glass-card-blue glass-border-blue rounded-md">
                    <div>
                      <h4 className="font-medium text-white">Database Statistics</h4>
                      <p className="text-sm text-gray-200">View detailed database statistics</p>
                    </div>
                    <Link
                      href="/admin/db-stats"
                      className="glass-card-blue glass-border-blue glass-hover-blue glass-transition text-white px-4 py-2 rounded-md"
                    >
                      View Stats
                    </Link>
                  </div>

                  <div className="flex items-center justify-between p-4 glass-card-blue glass-border-blue rounded-md">
                    <div>
                      <h4 className="font-medium text-white">Security Dashboard</h4>
                      <p className="text-sm text-gray-200">Monitor security events and system threats</p>
                    </div>
                    <Link
                      href="/admin/security"
                      className="glass-card-blue glass-border-blue glass-hover-blue glass-transition text-white px-4 py-2 rounded-md"
                    >
                      View Security
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}