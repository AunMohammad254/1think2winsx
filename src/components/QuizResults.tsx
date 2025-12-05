'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import LazyStreamPlayer from '@/components/LazyStreamPlayer';

type QuizResultsProps = {
  success: boolean;
  message: string;
  totalQuestions: number;
  submittedAnswers: number;
  note: string;
};

export default function QuizResults({ success, message, totalQuestions, submittedAnswers, note }: QuizResultsProps) {
  const [showAnimation, setShowAnimation] = useState(success);
  
  useEffect(() => {
    if (success) {
      // Hide animation after 3 seconds
      const timer = setTimeout(() => {
        setShowAnimation(false);
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [success]);
  
  return (
    <div className="glass-card glass-transition glass-hover rounded-lg p-6 text-center">
      {showAnimation && (
        <div className="fixed inset-0 z-10 pointer-events-none">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-4xl animate-bounce">✅</div>
          </div>
        </div>
      )}
      
      <h2 className="text-2xl font-bold mb-4 text-blue-300">
        {success ? 'Predictions Submitted!' : 'Submission Failed'}
      </h2>
      
      <div className="mb-6">
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-glass-blue glass-border-blue mb-4">
          <span className="text-2xl font-bold text-white">
            {submittedAnswers}/{totalQuestions}
          </span>
        </div>
        <p className="text-lg mb-2 text-white">
          You submitted <span className="font-bold text-blue-300">{submittedAnswers}</span> predictions out of <span className="font-bold text-blue-300">{totalQuestions}</span> questions
        </p>
        <p className="text-blue-300 font-medium">{message}</p>
      </div>
      
      <div className="mb-6 p-4 glass-card-blue glass-border-blue rounded-lg">
        <h3 className="text-lg font-bold text-white mb-2">What&apos;s Next?</h3>
        <p className="text-gray-200 text-sm">{note}</p>
        <div className="mt-3 text-sm text-gray-200">
          <p>• Admin will add correct answers</p>
          <p>• Top 10% performers will receive points</p>
          <p>• Use points to redeem amazing prizes!</p>
        </div>
      </div>
      
      <div className="flex flex-col space-y-3">
        <Link 
          href="/quizzes" 
          className="px-6 py-3 glass-card-blue glass-border-blue glass-hover-blue glass-transition text-white rounded-md"
        >
          Take More Quizzes
        </Link>
        
        <Link 
          href="/profile" 
          className="px-6 py-3 glass-card-blue glass-border-blue glass-hover-blue glass-transition text-white rounded-md"
        >
          View My Points & Prizes
        </Link>
      </div>

      {/* Live Stream after results (optional) */}
      <div className="mt-8">
        <LazyStreamPlayer autoPlay={false} />
      </div>
    </div>
  );
}