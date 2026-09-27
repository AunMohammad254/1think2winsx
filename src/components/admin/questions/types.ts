export interface Question {
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

export interface QuestionFromAPI {
  id: string;
  quizId: string;
  text: string;
  options: string | string[];
  correctOption: number | null;
  status: 'active' | 'paused';
  order: number;
}

export interface CreateQuestionRequest {
  quizId: string;
  text: string;
  options: string[];
  correctOption?: number;
}

export interface ValidationError {
  message: string;
}

export interface QuestionManagementProps {
  quizId: string;
  onQuestionsChange?: (questions: Question[]) => void;
}
