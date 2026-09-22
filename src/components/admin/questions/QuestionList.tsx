import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Edit, Pause, Play, Trash, Check, Plus } from "lucide-react";
import { Question } from './types';

interface QuestionListProps {
  questions: Question[];
  isLoading: boolean;
  onEdit: (question: Question) => void;
  onToggleStatus: (questionId: string, currentStatus: 'active' | 'paused') => void;
  onDelete: (questionId: string) => void;
  onAddFirst: () => void;
}

export default function QuestionList({
  questions,
  isLoading,
  onEdit,
  onToggleStatus,
  onDelete,
  onAddFirst
}: QuestionListProps) {
  if (questions.length === 0 && !isLoading) {
    return (
      <div className="glass-card glass-border p-8 text-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 rounded-full glass-card glass-border flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-gray-400" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-white mb-2">No Questions Found</h3>
            <p className="text-gray-300 mb-4">
              This quiz doesn't have any questions yet. Add your first question to get started.
            </p>
            <Button
              onClick={onAddFirst}
              className="glass-card-blue glass-border-blue glass-hover-blue"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add First Question
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {questions.map((question, index) => (
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
                  onClick={() => onEdit(question)}
                  className="glass-card glass-border-blue"
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onToggleStatus(question.id, question.status)}
                  className={`glass-card ${question.status === 'active' ? 'glass-border-yellow' : 'glass-border-green'}`}
                >
                  {question.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onDelete(question.id)}
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
      ))}
    </div>
  );
}
