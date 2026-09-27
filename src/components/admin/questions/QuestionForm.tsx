'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Check, X } from "lucide-react";
import { Question } from './types';
import { useState, useEffect } from "react";

interface QuestionFormProps {
  isOpen: boolean;
  isEditing: boolean;
  initialData: Omit<Question, 'id' | 'quizId' | 'stats'>;
  isLoading: boolean;
  onSave: (formData: Omit<Question, 'id' | 'quizId' | 'stats'>) => void;
  onClose: () => void;
}

export default function QuestionForm({ isOpen, isEditing, initialData, isLoading, onSave, onClose }: QuestionFormProps) {
  const [formData, setFormData] = useState(initialData);

  // Sync form when initialData changes (e.g. switching between add/edit)
  useEffect(() => {
    if (isOpen) {
      setFormData(initialData);
    }
  }, [isOpen, initialData]);

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...formData.options];
    newOptions[index] = value;
    setFormData({ ...formData, options: newOptions });
  };

  const addOption = () => {
    if (formData.options.length < 6) {
      setFormData({
        ...formData,
        options: [...formData.options, '']
      });
    }
  };

  const removeOption = (index: number) => {
    if (formData.options.length > 2) {
      const newOptions = formData.options.filter((_, i) => i !== index);
      let newCorrectOption = formData.correctOption;
      
      // Adjust correct option if necessary
      if (newCorrectOption !== null) {
        if (newCorrectOption === index) {
          newCorrectOption = null;
        } else if (newCorrectOption > index) {
          newCorrectOption--;
        }
      }
      
      setFormData({
        ...formData,
        options: newOptions,
        correctOption: newCorrectOption
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-card glass-border max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEditing ? 'Edit Question' : 'Add New Question'}
          </DialogTitle>
          <DialogDescription className="text-gray-300">
            {isEditing ? 'Update the question details below.' : 'Create a new question for this quiz.'}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Question Text */}
          <div>
            <Label htmlFor="questionText" className="text-white">Question Text</Label>
            <Textarea
              id="questionText"
              value={formData.text}
              onChange={(e) => setFormData({ ...formData, text: e.target.value })}
              placeholder="Enter your question..."
              className="glass-card glass-border text-white mt-1"
              rows={3}
            />
          </div>

          {/* Options */}
          <div>
            <Label className="text-white">Answer Options</Label>
            <div className="space-y-2 mt-2">
              {formData.options.map((option, index) => (
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
                    onClick={() => setFormData({
                      ...formData,
                      correctOption: formData.correctOption === index ? null : index
                    })}
                    className={`glass-card ${
                      formData.correctOption === index ? 'glass-border-green' : 'glass-border'
                    }`}
                  >
                    {formData.correctOption === index ? <Check className="h-4 w-4" /> : 'Set Correct'}
                  </Button>
                  {formData.options.length > 2 && (
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
            
            {formData.options.length < 6 && (
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
              checked={formData.status === 'active'}
              onCheckedChange={(checked) => 
                setFormData({ ...formData, status: checked ? 'active' : 'paused' })
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
            onClick={onClose}
            className="glass-card glass-border"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onSave(formData)}
            disabled={isLoading}
            className="glass-card-blue glass-border-blue"
          >
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? 'Update Question' : 'Add Question'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
