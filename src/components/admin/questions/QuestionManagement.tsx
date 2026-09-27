'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, AlertCircle } from "lucide-react";
import { Question, QuestionFromAPI, CreateQuestionRequest, ValidationError, QuestionManagementProps } from './types';
import QuestionForm from './QuestionForm';
import QuestionList from './QuestionList';

export default function QuestionManagement({ quizId, onQuestionsChange }: QuestionManagementProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  const defaultFormState: Omit<Question, 'id' | 'quizId' | 'stats'> = {
    text: '',
    options: ['', '', '', ''],
    correctOption: null,
    hasCorrectAnswer: false,
    status: 'active',
    order: questions.length
  };

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

  const fetchQuestions = useCallback(async () => {
    if (!quizId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/admin/quizzes/${quizId}`);
      if (!response.ok) throw new Error('Failed to fetch quiz questions');
      
      const data = await response.json();
      const questionsData = data.quiz?.questions || [];
      
      const parsedQuestions = questionsData.map((q: QuestionFromAPI) => ({
        ...q,
        options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
        hasCorrectAnswer: q.correctOption !== null
      }));
      
      setQuestions(parsedQuestions);
      if (onQuestionsChange) onQuestionsChange(parsedQuestions);
    } catch (err) {
      console.error('Error fetching questions:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [quizId, onQuestionsChange]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const validateForm = (formData: Omit<Question, 'id' | 'quizId' | 'stats'>) => {
    if (!formData.text.trim()) {
      setError('Question text is required');
      return null;
    }

    const validOptions = formData.options.filter(opt => opt.trim());
    if (validOptions.length < 2) {
      setError('At least 2 options are required');
      return null;
    }

    let mappedCorrectOption: number | undefined = undefined;
    if (formData.correctOption !== null && formData.correctOption >= 0) {
      if (formData.correctOption >= formData.options.length) {
         setError('Invalid correct option selected');
         return null;
      }
      const originalOption = formData.options[formData.correctOption];
      if (originalOption && originalOption.trim()) {
        mappedCorrectOption = validOptions.findIndex(opt => opt === originalOption.trim());
        if (mappedCorrectOption === -1) {
          setError('Selected correct option is empty');
          return null;
        }
      }
    }

    return { validOptions, mappedCorrectOption };
  };

  const handleSaveQuestion = async (formData: Omit<Question, 'id' | 'quizId' | 'stats'>) => {
    if (!csrfToken) {
      setError('CSRF token not available');
      return;
    }

    const validation = validateForm(formData);
    if (!validation) return;
    
    const { validOptions, mappedCorrectOption } = validation;

    setIsLoading(true);
    setError(null);

    try {
      if (editingQuestion) {
        const response = await fetch(`/api/admin/questions/${editingQuestion.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({
            text: formData.text.trim(),
            options: validOptions,
            correctOption: mappedCorrectOption !== undefined ? mappedCorrectOption : null,
            status: formData.status,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to update question');
        }
      } else {
        const requestBody: CreateQuestionRequest = {
          quizId,
          text: formData.text.trim(),
          options: validOptions,
        };

        if (mappedCorrectOption !== undefined && mappedCorrectOption >= 0) {
          (requestBody as CreateQuestionRequest & { correctOption: number }).correctOption = mappedCorrectOption;
        }

        const response = await fetch('/api/admin/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          let errorMessage = 'Failed to create question';
          try {
            const responseText = await response.text();
            const errorData = JSON.parse(responseText);
            if (errorData.error) {
              errorMessage = errorData.error;
            } else if (errorData.details && Array.isArray(errorData.details)) {
              errorMessage = errorData.details.map((d: ValidationError) => d.message).join(', ');
            }
          } catch (_e) {
            errorMessage = 'Server error occurred';
          }
          throw new Error(errorMessage);
        }
      }

      await fetchQuestions();
      setShowAddForm(false);
      setEditingQuestion(null);
    } catch (err) {
      console.error('Error saving question:', err);
      setError(err instanceof Error ? err.message : 'Failed to save question');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!csrfToken) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/questions/${questionId}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete question');
      }

      await fetchQuestions();
      setShowDeleteConfirm(null);
    } catch (err) {
      console.error('Error deleting question:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete question');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleQuestionStatus = async (questionId: string, currentStatus: 'active' | 'paused') => {
    if (!csrfToken) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/questions/${questionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ status: currentStatus === 'active' ? 'paused' : 'active' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update question status');
      }

      await fetchQuestions();
    } catch (err) {
      console.error('Error updating question status:', err);
      setError(err instanceof Error ? err.message : 'Failed to update question status');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading && questions.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading questions...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-white">Question Management</h3>
          <p className="text-sm text-gray-300">Manage individual questions for this quiz</p>
        </div>
        <Button
          onClick={() => setShowAddForm(true)}
          className="glass-card-blue glass-border-blue glass-hover-blue"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Question
        </Button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="glass-card border-red-500 p-4 rounded-lg">
          <div className="flex items-center">
            <AlertCircle className="h-5 w-5 text-red-400 mr-2" />
            <span className="text-red-300">{error}</span>
          </div>
        </div>
      )}

      {/* Questions List */}
      <QuestionList 
        questions={questions}
        isLoading={isLoading}
        onEdit={(q) => setEditingQuestion(q)}
        onToggleStatus={handleToggleQuestionStatus}
        onDelete={(id) => setShowDeleteConfirm(id)}
        onAddFirst={() => setShowAddForm(true)}
      />

      {/* Add/Edit Form */}
      <QuestionForm
        isOpen={showAddForm || editingQuestion !== null}
        isEditing={editingQuestion !== null}
        initialData={editingQuestion ? {
          text: editingQuestion.text,
          options: [...editingQuestion.options],
          correctOption: editingQuestion.correctOption,
          hasCorrectAnswer: editingQuestion.hasCorrectAnswer,
          status: editingQuestion.status,
          order: editingQuestion.order
        } : defaultFormState}
        isLoading={isLoading}
        onSave={handleSaveQuestion}
        onClose={() => {
          setShowAddForm(false);
          setEditingQuestion(null);
          setError(null);
        }}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm !== null} onOpenChange={(open) => !open && setShowDeleteConfirm(null)}>
        <DialogContent className="glass-card glass-border">
          <DialogHeader>
            <DialogTitle className="text-white">Delete Question</DialogTitle>
            <DialogDescription className="text-gray-300">
              Are you sure you want to delete this question? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteConfirm(null)}
              className="glass-card glass-border"
            >
              Cancel
            </Button>
            <Button
              onClick={() => showDeleteConfirm && handleDeleteQuestion(showDeleteConfirm)}
              disabled={isLoading}
              className="glass-card glass-border-red bg-red-500/20"
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete Question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
