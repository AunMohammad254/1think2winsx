'use client';

import { useState } from 'react';
import { sanitizeQuizContent } from '@/lib/sanitize';

type Option = string;

type QuestionProps = {
  id: string;
  text: string;
  options: Option[];
  onAnswer: (questionId: string, selectedOption: number) => void;
  currentAnswer?: number;
  isSubmitting?: boolean;
};

export default function QuizQuestion({
  id,
  text,
  options,
  onAnswer,
  currentAnswer,
  isSubmitting = false,
}: QuestionProps) {
  const [selectedOption, setSelectedOption] = useState<number | undefined>(currentAnswer);
  
  const handleOptionSelect = (index: number) => {
    if (isSubmitting) return;
    setSelectedOption(index);
    onAnswer(id, index);
  };

  return (
    <div className="md:backdrop-blur-xl bg-white/5 border border-white/10 rounded-xl shadow-2xl p-6 mb-6 relative overflow-hidden">
      {/* Animated Background - Desktop only */}
      <div className="hidden md:block absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-purple-600/5 opacity-50"></div>
      
      {/* Mobile simplified background */}
      <div className="md:hidden absolute inset-0 bg-gradient-to-br from-cyan-500/3 to-purple-600/3"></div>
      
      <div className="relative z-10">
        <h3 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent mb-6">
          {sanitizeQuizContent(text)}
        </h3>
        
        <div className="space-y-4">
          {options.map((option, index) => (
            <button
              key={index}
              onClick={() => handleOptionSelect(index)}
              className={`w-full text-left p-4 rounded-xl border transition-all duration-300 md:transform md:hover:scale-105 ${selectedOption === index
                ? 'bg-gradient-to-r from-cyan-600/20 to-purple-600/20 border-cyan-400/50 shadow-lg md:shadow-cyan-500/20'
                : 'bg-white/5 border-white/10 md:hover:bg-white/10 md:hover:border-white/20'
              } ${isSubmitting ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} group relative overflow-hidden touch-manipulation`}
              disabled={isSubmitting}
            >
              {/* Hover Effect Background - Desktop only */}
              <div className={`hidden md:block absolute inset-0 transition-opacity duration-300 ${selectedOption === index
                ? 'bg-gradient-to-r from-cyan-500/10 to-purple-600/10 opacity-100'
                : 'bg-gradient-to-r from-blue-500/5 to-cyan-600/5 opacity-0 group-hover:opacity-100'
              }`}></div>
              
              <div className="flex items-center relative z-10">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-4 font-bold text-sm transition-all duration-300 ${selectedOption === index
                  ? 'bg-gradient-to-r from-cyan-500 to-purple-600 text-white shadow-lg'
                  : 'bg-white/10 text-gray-300 border border-white/20'
                }`}>
                  {String.fromCharCode(65 + index)} {/* A, B, C, D */}
                </div>
                <span className={`text-lg font-medium transition-colors duration-300 ${selectedOption === index
                  ? 'text-white'
                  : 'text-gray-200'
                }`}>
                  {sanitizeQuizContent(option)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}