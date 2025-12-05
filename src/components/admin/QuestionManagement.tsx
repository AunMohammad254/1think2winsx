'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Trash, Check, X, AlertCircle, Edit, Pause, Play } from "lucide-react";

interface Question {
  id: string;
  quizId: string;
  text: string;
  options: string[];
  correctOption: number | null;
  hasCorrectAnswer: boolean;
  status: 'active' | 'paused';
  order: number;
  stats?: {
    totalAnswers: number;
    correctAnswers: number;
    percentageCorrect: number;
    answerDistribution: number[];
  };
}

interface QuestionFromAPI {
  id: string;
  quizId: string;
  text: string;
  options: string | string[];
  correctOption: number | null;
  status: 'active' | 'paused';
  order: number;
}

interface CreateQuestionRequest {
  quizId: string;
  text: string;
  options: string[];
  correctOption?: number;
}

interface ValidationError {
  message: string;
}

interface QuestionManagementProps {
  quizId: string;
  onQuestionsChange?: (questions: Question[]) => void;
}

export default function QuestionManagement({ quizId, onQuestionsChange }: QuestionManagementProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Form state
  const [questionForm, setQuestionForm] = useState<Omit<Question, 'id' | 'quizId' | 'stats'>>({
    text: '',
    options: ['', '', '', ''],
    correctOption: null,
    hasCorrectAnswer: false,
    status: 'active',
    order: 0
  });

  // CSRF token
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

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

  // Fetch questions for the quiz
  const fetchQuestions = useCallback(async () => {
    if (!quizId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/admin/quizzes/${quizId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch quiz questions');
      }
      
      const data = await response.json();
      const questionsData = data.quiz?.questions || [];
      
      // Parse options if they're stored as JSON strings
      const parsedQuestions = questionsData.map((q: QuestionFromAPI) => ({
        ...q,
        options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options,
        hasCorrectAnswer: q.correctOption !== null
      }));
      
      setQuestions(parsedQuestions);
      
      // Notify parent component if callback provided
      if (onQuestionsChange) {
        onQuestionsChange(parsedQuestions);
      }
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

  // Reset form
  const resetForm = () => {
    setQuestionForm({
      text: '',
      options: ['', '', '', ''],
      correctOption: null,
      hasCorrectAnswer: false,
      status: 'active',
      order: questions.length
    });
  };

  // Handle add question
  const handleAddQuestion = async () => {
    if (!csrfToken) {
      setError('CSRF token not available');
      return;
    }

    // Validation
    if (!questionForm.text.trim()) {
      setError('Question text is required');
      return;
    }

    const validOptions = questionForm.options.filter(opt => opt.trim());
    if (validOptions.length < 2) {
      setError('At least 2 options are required');
      return;
    }

    // Map the correctOption index from original array to filtered array
    let mappedCorrectOption: number | undefined = undefined;
    if (questionForm.correctOption !== null && questionForm.correctOption >= 0) {
      const originalOption = questionForm.options[questionForm.correctOption];
      if (originalOption && originalOption.trim()) {
        // Find the index in the filtered array
        mappedCorrectOption = validOptions.findIndex(opt => opt === originalOption.trim());
        if (mappedCorrectOption === -1) {
          setError('Selected correct option is empty');
          return;
        }
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      // Prepare the request body
      const requestBody: CreateQuestionRequest = {
        quizId,
        text: questionForm.text.trim(),
        options: validOptions,
      };

      // Only include correctOption if it's a valid mapped index
      if (mappedCorrectOption !== undefined && mappedCorrectOption >= 0) {
        (requestBody as CreateQuestionRequest & { correctOption: number }).correctOption = mappedCorrectOption;
      }

      console.log('Sending request body:', requestBody);
      console.log('Original correctOption:', questionForm.correctOption);
      console.log('Mapped correctOption:', mappedCorrectOption);
      console.log('Original options:', questionForm.options);
      console.log('Valid options:', validOptions);

      const response = await fetch('/api/admin/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(requestBody),
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        let errorMessage = 'Failed to create question';
        let responseText = '';
        try {
          responseText = await response.text();
          console.log('Raw response text:', responseText);
          
          const errorData = JSON.parse(responseText);
          console.log('Parsed error data:', errorData);
          
          if (errorData.error) {
            errorMessage = errorData.error;
          } else if (errorData.details && Array.isArray(errorData.details)) {
            // Handle Zod validation errors
            errorMessage = errorData.details.map((detail: ValidationError) => detail.message).join(', ');
          }
        } catch (parseError) {
          console.error('Error parsing error response:', parseError);
          console.error('Raw response was:', responseText);
          errorMessage = `Server error (${response.status}): ${responseText || 'Unknown error'}`;
        }
        throw new Error(errorMessage);
      }

      await fetchQuestions();
      setShowAddForm(false);
      resetForm();
    } catch (err) {
      console.error('Error creating question:', err);
      setError(err instanceof Error ? err.message : 'Failed to create question');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle edit question
  const handleEditQuestion = (question: Question) => {
    setEditingQuestion(question);
    setQuestionForm({
      text: question.text,
      options: [...question.options],
      correctOption: question.correctOption,
      hasCorrectAnswer: question.hasCorrectAnswer,
      status: question.status,
      order: question.order
    });
  };

  // Handle update question
  const handleUpdateQuestion = async () => {
    if (!editingQuestion || !csrfToken) return;

    // Validation
    if (!questionForm.text.trim()) {
      setError('Question text is required');
      return;
    }

    const validOptions = questionForm.options.filter(opt => opt.trim());
    if (validOptions.length < 2) {
      setError('At least 2 options are required');
      return;
    }

    if (questionForm.correctOption !== null && (questionForm.correctOption < 0 || questionForm.correctOption >= validOptions.length)) {
      setError('Invalid correct option selected');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/questions/${editingQuestion.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          text: questionForm.text,
          options: validOptions,
          correctOption: questionForm.correctOption,
          status: questionForm.status,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update question');
      }

      await fetchQuestions();
      setEditingQuestion(null);
      resetForm();
    } catch (err) {
      console.error('Error updating question:', err);
      setError(err instanceof Error ? err.message : 'Failed to update question');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle delete question
  const handleDeleteQuestion = async (questionId: string) => {
    if (!csrfToken) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/questions/${questionId}`, {
        method: 'DELETE',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
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

  // Handle toggle question status
  const handleToggleQuestionStatus = async (questionId: string, newStatus: 'active' | 'paused') => {
    if (!csrfToken) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/questions/${questionId}`, {
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

  // Handle option change
  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...questionForm.options];
    newOptions[index] = value;
    setQuestionForm({ ...questionForm, options: newOptions });
  };

  // Add option
  const addOption = () => {
    if (questionForm.options.length < 6) {
      setQuestionForm({
        ...questionForm,
        options: [...questionForm.options, '']
      });
    }
  };

  // Remove option
  const removeOption = (index: number) => {
    if (questionForm.options.length > 2) {
      const newOptions = questionForm.options.filter((_, i) => i !== index);
      let newCorrectOption = questionForm.correctOption;
      
      // Adjust correct option if necessary
      if (newCorrectOption !== null) {
        if (newCorrectOption === index) {
          newCorrectOption = null;
        } else if (newCorrectOption > index) {
          newCorrectOption--;
        }
      }
      
      setQuestionForm({
        ...questionForm,
        options: newOptions,
        correctOption: newCorrectOption
      });
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
          onClick={() => {
            resetForm();
            setShowAddForm(true);
          }}
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
      <div className="space-y-4">
        {questions.length === 0 && !isLoading ? (
          <div className="glass-card glass-border p-8 text-center">
            <div className="flex flex-col items-center space-y-4">
              <div className="w-16 h-16 rounded-full glass-card glass-border flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-gray-400" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-white mb-2">No Questions Found</h3>
                <p className="text-gray-300 mb-4">
                  This quiz doesn&apos;t have any questions yet. Add your first question to get started.
                </p>
                <Button
                  onClick={() => {
                    resetForm();
                    setShowAddForm(true);
                  }}
                  className="glass-card-blue glass-border-blue glass-hover-blue"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Question
                </Button>
              </div>
            </div>
          </div>
        ) : (
          questions.map((question, index) => (
            <Card key={question.id} className="glass-card glass-border">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="flex-1 pr-4">
                    <CardTitle className="text-base flex items-center text-white">
                      Question {index + 1}
                      <Badge className={`ml-2 ${question.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'}`}>
                        {question.status}
                      </Badge>
                      {question.hasCorrectAnswer && (
                        <Badge className="ml-2 bg-blue-500">
                          Has Answer
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-gray-300 mt-2">
                      {question.text}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditQuestion(question)}
                      className="glass-card glass-border-blue"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleToggleQuestionStatus(
                        question.id,
                        question.status === 'active' ? 'paused' : 'active'
                      )}
                      className={`glass-card ${question.status === 'active' ? 'glass-border-yellow' : 'glass-border-green'}`}
                    >
                      {question.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteConfirm(question.id)}
                      className="glass-card glass-border-red"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {question.options.map((option, optIndex) => (
                    <div
                      key={optIndex}
                      className={`p-2 rounded glass-card ${
                        question.correctOption === optIndex ? 'glass-border-green' : 'glass-border'
                      }`}
                    >
                      <div className="flex items-center">
                        <span className="text-sm font-medium text-gray-300 mr-2">
                          {String.fromCharCode(65 + optIndex)}.
                        </span>
                        <span className="text-white">{option}</span>
                        {question.correctOption === optIndex && (
                          <Check className="h-4 w-4 text-green-400 ml-auto" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add/Edit Question Dialog */}
      <Dialog open={showAddForm || editingQuestion !== null} onOpenChange={(open) => {
        if (!open) {
          setShowAddForm(false);
          setEditingQuestion(null);
          resetForm();
          setError(null);
        }
      }}>
        <DialogContent className="glass-card glass-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white">
              {editingQuestion ? 'Edit Question' : 'Add New Question'}
            </DialogTitle>
            <DialogDescription className="text-gray-300">
              {editingQuestion ? 'Update the question details below.' : 'Create a new question for this quiz.'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Question Text */}
            <div>
              <Label htmlFor="questionText" className="text-white">Question Text</Label>
              <Textarea
                id="questionText"
                value={questionForm.text}
                onChange={(e) => setQuestionForm({ ...questionForm, text: e.target.value })}
                placeholder="Enter your question..."
                className="glass-card glass-border text-white mt-1"
                rows={3}
              />
            </div>

            {/* Options */}
            <div>
              <Label className="text-white">Answer Options</Label>
              <div className="space-y-2 mt-2">
                {questionForm.options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-300 w-8">
                      {String.fromCharCode(65 + index)}.
                    </span>
                    <Input
                      value={option}
                      onChange={(e) => handleOptionChange(index, e.target.value)}
                      placeholder={`Option ${index + 1}`}
                      className="glass-card glass-border text-white flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQuestionForm({
                        ...questionForm,
                        correctOption: questionForm.correctOption === index ? null : index
                      })}
                      className={`glass-card ${
                        questionForm.correctOption === index ? 'glass-border-green' : 'glass-border'
                      }`}
                    >
                      {questionForm.correctOption === index ? <Check className="h-4 w-4" /> : 'Set Correct'}
                    </Button>
                    {questionForm.options.length > 2 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeOption(index)}
                        className="glass-card glass-border-red"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              
              {questionForm.options.length < 6 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={addOption}
                  className="glass-card glass-border-blue mt-2"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Option
                </Button>
              )}
            </div>

            {/* Status */}
            <div className="flex items-center space-x-2">
              <Switch
                id="questionStatus"
                checked={questionForm.status === 'active'}
                onCheckedChange={(checked) => 
                  setQuestionForm({ ...questionForm, status: checked ? 'active' : 'paused' })
                }
              />
              <Label htmlFor="questionStatus" className="text-white">
                Active (question will be included in quiz)
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddForm(false);
                setEditingQuestion(null);
                resetForm();
                setError(null);
              }}
              className="glass-card glass-border"
            >
              Cancel
            </Button>
            <Button
              onClick={editingQuestion ? handleUpdateQuestion : handleAddQuestion}
              disabled={isLoading}
              className="glass-card-blue glass-border-blue"
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingQuestion ? 'Update Question' : 'Add Question'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm !== null} onOpenChange={(open) => {
        if (!open) setShowDeleteConfirm(null);
      }}>
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