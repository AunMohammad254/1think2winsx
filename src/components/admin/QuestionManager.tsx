'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Trash, Check, X, AlertCircle } from "lucide-react";

interface Question {
  id: string;
  quizId: string;
  text: string;
  options: string[];
  correctAnswer: number;
  isActive: boolean;
  order: number;
  stats?: {
    totalAnswers: number;
    correctAnswers: number;
    percentageCorrect: number;
    answerDistribution: number[];
  };
}

interface QuestionManagerProps {
  quizId: string;
  onQuestionsChange?: (questions: Question[]) => void;
}

export default function QuestionManager({ quizId, onQuestionsChange }: QuestionManagerProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  
  // Form state
  const [questionForm, setQuestionForm] = useState<Omit<Question, 'id' | 'quizId' | 'stats'>>({
    text: '',
    options: ['', ''],
    correctAnswer: 0,
    isActive: true,
    order: 0
  });

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
      setQuestions(data.questions || []);
      
      // Notify parent component if callback provided
      if (onQuestionsChange) {
        onQuestionsChange(data.questions || []);
      }
    } catch (err) {
      console.error('Error fetching questions:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [quizId, onQuestionsChange]);

  // Initial fetch
  useEffect(() => {
    if (quizId) {
      fetchQuestions();
    }
  }, [quizId, fetchQuestions]);

  // Create question
  const handleCreateQuestion = async () => {
    // Validation
    if (!questionForm.text.trim()) {
      alert('Please enter question text');
      return;
    }
    
    if (questionForm.options.some(opt => !opt.trim())) {
      alert('All options must have text');
      return;
    }

    setIsLoading(true);
    try {
      // Add the question to the quiz
      const response = await fetch(`/api/admin/quizzes/${quizId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: [
            ...questions,
            {
              text: questionForm.text,
              options: questionForm.options,
              correctAnswer: questionForm.correctAnswer,
              isActive: questionForm.isActive,
              order: questions.length // Add to the end
            }
          ]
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create question');
      }

      const result = await response.json();
      setQuestions(result.quiz.questions);
      
      // Notify parent component if callback provided
      if (onQuestionsChange) {
        onQuestionsChange(result.quiz.questions);
      }
      
      resetForm();
      setEditingQuestion(null);
    } catch (error) {
      console.error('Error creating question:', error);
      alert(error instanceof Error ? error.message : 'Failed to create question');
    } finally {
      setIsLoading(false);
    }
  };

  // Update question
  const handleUpdateQuestion = async () => {
    if (!editingQuestion) return;

    // Validation
    if (!questionForm.text.trim()) {
      alert('Please enter question text');
      return;
    }
    
    if (questionForm.options.some(opt => !opt.trim())) {
      alert('All options must have text');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/questions/${editingQuestion.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: questionForm.text,
          options: questionForm.options,
          correctAnswer: questionForm.correctAnswer,
          isActive: questionForm.isActive
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update question');
      }

      const updatedQuestion = await response.json();
      
      // Update questions list
      setQuestions(prev => prev.map(q => 
        q.id === editingQuestion.id ? updatedQuestion.question : q
      ));
      
      // Notify parent component if callback provided
      if (onQuestionsChange) {
        onQuestionsChange(questions.map(q => 
          q.id === editingQuestion.id ? updatedQuestion.question : q
        ));
      }
      
      setEditingQuestion(null);
      resetForm();
    } catch (error) {
      console.error('Error updating question:', error);
      alert(error instanceof Error ? error.message : 'Failed to update question');
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle question status
  const handleToggleStatus = async (questionId: string, isActive: boolean) => {
    try {
      // Optimistic update
      setQuestions(prev => prev.map(q => 
        q.id === questionId ? { ...q, isActive } : q
      ));

      const response = await fetch(`/api/admin/questions/${questionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive })
      });

      if (!response.ok) {
        // Revert on error
        setQuestions(prev => prev.map(q => 
          q.id === questionId ? { ...q, isActive: !isActive } : q
        ));
        const error = await response.json();
        throw new Error(error.error || 'Failed to update question status');
      }
      
      // Notify parent component if callback provided
      if (onQuestionsChange) {
        onQuestionsChange(questions);
      }
    } catch (error) {
      console.error('Error toggling question status:', error);
      alert(error instanceof Error ? error.message : 'Failed to update question status');
    }
  };

  // Delete question
  const handleDeleteQuestion = async (questionId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/admin/questions/${questionId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.hasAnswers) {
          alert(`Cannot delete question with ${error.answerCount} existing answers. Consider deactivating instead.`);
          return;
        }
        throw new Error(error.error || 'Failed to delete question');
      }

      // Update questions list
      setQuestions(prev => prev.filter(q => q.id !== questionId));
      
      // Notify parent component if callback provided
      if (onQuestionsChange) {
        onQuestionsChange(questions.filter(q => q.id !== questionId));
      }
      
      setShowDeleteConfirm(null);
    } catch (error) {
      console.error('Error deleting question:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete question');
    } finally {
      setIsLoading(false);
    }
  };

  // Edit question
  const handleEditQuestion = (question: Question) => {
    setEditingQuestion(question);
    setQuestionForm({
      text: question.text,
      options: [...question.options],
      correctAnswer: question.correctAnswer,
      isActive: question.isActive,
      order: question.order
    });
  };

  // Reset form
  const resetForm = () => {
    setQuestionForm({
      text: '',
      options: ['', ''],
      correctAnswer: 0,
      isActive: true,
      order: 0
    });
  };

  // Add option to form
  const addOption = () => {
    if (questionForm.options.length < 6) {
      setQuestionForm(prev => ({
        ...prev,
        options: [...prev.options, '']
      }));
    }
  };

  // Remove option from form
  const removeOption = (index: number) => {
    if (questionForm.options.length <= 2) {
      return; // Maintain at least 2 options
    }
    
    setQuestionForm(prev => {
      const updatedOptions = [...prev.options];
      updatedOptions.splice(index, 1);
      
      // Adjust correctAnswer if needed
      let correctAnswer = prev.correctAnswer;
      if (correctAnswer >= updatedOptions.length) {
        correctAnswer = 0;
      }
      
      return {
        ...prev,
        options: updatedOptions,
        correctAnswer
      };
    });
  };

  // Update option in form
  const updateOption = (index: number, value: string) => {
    setQuestionForm(prev => {
      const updatedOptions = [...prev.options];
      updatedOptions[index] = value;
      return {
        ...prev,
        options: updatedOptions
      };
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Questions</h3>
        <Button 
          onClick={() => { resetForm(); setEditingQuestion(null); }}
          variant="outline"
        >
          <Plus className="mr-2 h-4 w-4" /> Add Question
        </Button>
      </div>

      {isLoading && questions.length === 0 ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-destructive">Error: {error}</p>
          </CardContent>
        </Card>
      ) : questions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4">No questions added yet</p>
            <Button onClick={() => { resetForm(); setEditingQuestion(null); }}>
              <Plus className="mr-2 h-4 w-4" /> Add Your First Question
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {questions.map((question) => (
            <Card key={question.id}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <div className="flex-1 pr-4">
                    <CardTitle className="text-base flex items-center">
                      {question.text}
                      <Badge className={`ml-2 ${question.isActive ? 'bg-green-500' : 'bg-gray-500'}`}>
                        {question.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </CardTitle>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleEditQuestion(question)}>
                      Edit
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleToggleStatus(question.id, !question.isActive)}
                    >
                      {question.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button 
                      variant="destructive" 
                      size="sm"
                      onClick={() => setShowDeleteConfirm(question.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Options:</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {question.options.map((option, index) => (
                      <div 
                        key={index} 
                        className={`p-2 rounded-md border ${
                          index === question.correctAnswer 
                            ? 'border-green-500 bg-green-50 dark:bg-green-950/20' 
                            : 'border-gray-200 dark:border-gray-800'
                        }`}
                      >
                        <div className="flex items-center">
                          <span className="text-sm mr-2">{index + 1}.</span>
                          <span className="text-sm flex-1">{option}</span>
                          {index === question.correctAnswer && (
                            <Check className="h-4 w-4 text-green-500" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
              {question.stats && (
                <CardFooter className="pt-0 text-xs text-muted-foreground border-t">
                  <div className="w-full pt-3">
                    <div className="flex justify-between mb-1">
                      <span>Performance:</span>
                      <span>
                        {question.stats.correctAnswers} / {question.stats.totalAnswers} correct 
                        ({Math.round(question.stats.percentageCorrect)}%)
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                      <div 
                        className="h-full bg-primary" 
                        style={{ width: `${question.stats.percentageCorrect}%` }}
                      />
                    </div>
                  </div>
                </CardFooter>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Question Form */}
      {!editingQuestion && (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Add New Question</CardTitle>
            <CardDescription>Fill in the details below to add a new question</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="question-text">Question Text</Label>
              <Textarea
                id="question-text"
                value={questionForm.text}
                onChange={(e) => setQuestionForm({...questionForm, text: e.target.value})}
                placeholder="Enter question text"
                rows={2}
              />
            </div>
            
            <div className="space-y-3">
              <Label>Options</Label>
              {questionForm.options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={option}
                      onChange={(e) => updateOption(index, e.target.value)}
                      placeholder={`Option ${index + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeOption(index)}
                      disabled={questionForm.options.length <= 2}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant={questionForm.correctAnswer === index ? "default" : "outline"}
                    size="sm"
                    onClick={() => setQuestionForm({...questionForm, correctAnswer: index})}
                  >
                    {questionForm.correctAnswer === index ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      "Correct"
                    )}
                  </Button>
                </div>
              ))}
              
              {questionForm.options.length < 6 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addOption}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Option
                </Button>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              <Switch 
                id="question-active" 
                checked={questionForm.isActive} 
                onCheckedChange={(checked) => setQuestionForm({...questionForm, isActive: checked})}
              />
              <Label htmlFor="question-active">Question Active</Label>
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              onClick={handleCreateQuestion}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Question
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Edit Question Dialog */}
      <Dialog open={!!editingQuestion} onOpenChange={(open) => !open && setEditingQuestion(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Question</DialogTitle>
            <DialogDescription>
              Update the question details below
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="edit-question-text">Question Text</Label>
              <Textarea
                id="edit-question-text"
                value={questionForm.text}
                onChange={(e) => setQuestionForm({...questionForm, text: e.target.value})}
                placeholder="Enter question text"
                rows={2}
              />
            </div>
            
            <div className="space-y-3">
              <Label>Options</Label>
              {questionForm.options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={option}
                      onChange={(e) => updateOption(index, e.target.value)}
                      placeholder={`Option ${index + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeOption(index)}
                      disabled={questionForm.options.length <= 2}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant={questionForm.correctAnswer === index ? "default" : "outline"}
                    size="sm"
                    onClick={() => setQuestionForm({...questionForm, correctAnswer: index})}
                  >
                    {questionForm.correctAnswer === index ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      "Correct"
                    )}
                  </Button>
                </div>
              ))}
              
              {questionForm.options.length < 6 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addOption}
                >
                  <Plus className="h-4 w-4 mr-1" /> Add Option
                </Button>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              <Switch 
                id="edit-question-active" 
                checked={questionForm.isActive} 
                onCheckedChange={(checked) => setQuestionForm({...questionForm, isActive: checked})}
              />
              <Label htmlFor="edit-question-active">Question Active</Label>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingQuestion(null)}>
              Cancel
            </Button>
            <Button 
              onClick={handleUpdateQuestion}
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={(open) => !open && setShowDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this question? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-4">
            <AlertCircle className="h-16 w-16 text-destructive" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => showDeleteConfirm && handleDeleteQuestion(showDeleteConfirm)}
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}