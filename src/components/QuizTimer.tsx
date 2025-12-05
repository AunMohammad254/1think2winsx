'use client';

import { useState, useEffect } from 'react';

type QuizTimerProps = {
  duration: number; // in seconds
  onTimeUp: () => void;
};

export default function QuizTimer({ duration, onTimeUp }: QuizTimerProps) {
  const [timeLeft, setTimeLeft] = useState(duration);
  
  useEffect(() => {
    if (timeLeft <= 0) {
      onTimeUp();
      return;
    }
    
    const timer = setTimeout(() => {
      setTimeLeft(timeLeft - 1);
    }, 1000);
    
    return () => clearTimeout(timer);
  }, [timeLeft, onTimeUp]);
  
  // Format time as mm:ss
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  // Calculate percentage for progress bar
  const percentageLeft = (timeLeft / duration) * 100;
  
  return (
    <div className="mb-6 bg-white/5 border border-white/10 rounded-xl p-4">
      <div className="flex justify-between items-center mb-3">
        <span className="text-sm font-medium text-gray-300">Time Remaining</span>
        <span className={`text-lg font-bold ${
          percentageLeft > 50 ? 'text-green-400' : 
          percentageLeft > 20 ? 'text-yellow-400' : 
          'text-red-400'
        }`}>
          {formattedTime}
        </span>
      </div>
      
      <div className="w-full bg-gray-700/50 rounded-full h-3 overflow-hidden">
        <div 
          className={`h-3 rounded-full transition-all duration-1000 ease-linear ${
            percentageLeft > 50 ? 'bg-gradient-to-r from-green-500 to-green-400' : 
            percentageLeft > 20 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' : 
            'bg-gradient-to-r from-red-500 to-red-400'
          }`}
          style={{ width: `${percentageLeft}%` }}
        ></div>
      </div>
      
      {percentageLeft <= 20 && (
        <div className="mt-2 text-center">
          <span className="text-red-400 text-sm font-medium animate-pulse">
            ⚠️ Time is running out!
          </span>
        </div>
      )}
    </div>
  );
}