'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import LazyStreamPlayer from '@/components/LazyStreamPlayer';

type QuizResultsProps = {
  success: boolean;
  message: string;
  totalQuestions: number;
  submittedAnswers: number;
  note: string;
  isInModal?: boolean;
  onClose?: () => void;
};

// Confetti particle component
const ConfettiParticle = ({ delay, color, left }: { delay: number; color: string; left: number }) => (
  <div
    className="absolute w-3 h-3 rounded-sm animate-confetti"
    style={{
      left: `${left}%`,
      backgroundColor: color,
      animationDelay: `${delay}ms`,
      top: '-10px',
    }}
  />
);

export default function QuizResults({ success, message, totalQuestions, submittedAnswers, note, isInModal = false, onClose }: QuizResultsProps) {
  const router = useRouter();
  const [showConfetti, setShowConfetti] = useState(success);
  const [animationPhase, setAnimationPhase] = useState<'initial' | 'revealed' | 'final'>('initial');

  // Generate confetti particles
  const generateConfetti = useCallback(() => {
    const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
    const particles = [];
    for (let i = 0; i < 50; i++) {
      particles.push({
        id: i,
        delay: Math.random() * 2000,
        color: colors[Math.floor(Math.random() * colors.length)],
        left: Math.random() * 100,
      });
    }
    return particles;
  }, []);

  const [confettiParticles] = useState(() => generateConfetti());

  useEffect(() => {
    if (success) {
      // Animation phases
      const reveal = setTimeout(() => setAnimationPhase('revealed'), 500);
      const final = setTimeout(() => setAnimationPhase('final'), 1500);
      const hideConfetti = setTimeout(() => setShowConfetti(false), 5000);

      return () => {
        clearTimeout(reveal);
        clearTimeout(final);
        clearTimeout(hideConfetti);
      };
    }
  }, [success]);

  return (
    <div className={`${isInModal ? '' : 'min-h-screen'} flex items-center justify-center p-4 relative overflow-hidden`}>
      {/* Confetti Animation */}
      {showConfetti && (
        <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
          {confettiParticles.map((particle) => (
            <ConfettiParticle
              key={particle.id}
              delay={particle.delay}
              color={particle.color}
              left={particle.left}
            />
          ))}
        </div>
      )}

      {/* Main Card */}
      <div className="glass-card glass-border rounded-3xl p-8 max-w-lg w-full text-center relative z-10 transform transition-all duration-700 ease-out"
        style={{
          opacity: animationPhase !== 'initial' ? 1 : 0,
          transform: animationPhase !== 'initial' ? 'scale(1) translateY(0)' : 'scale(0.8) translateY(20px)',
        }}
      >
        {/* Success Checkmark Animation */}
        <div className="mb-6 relative">
          <div className={`w-28 h-28 mx-auto rounded-full flex items-center justify-center transition-all duration-500 ${success
            ? 'bg-gradient-to-br from-green-400 to-emerald-600'
            : 'bg-gradient-to-br from-red-400 to-red-600'
            }`}
            style={{
              transform: animationPhase === 'final' ? 'scale(1)' : 'scale(0)',
              transition: 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            }}
          >
            <span className="text-5xl text-white animate-bounce">
              {success ? '✓' : '✗'}
            </span>
          </div>

          {/* Pulse rings */}
          {success && animationPhase === 'final' && (
            <>
              <div className="absolute inset-0 mx-auto w-28 h-28 rounded-full bg-green-400/30 animate-ping" style={{ animationDuration: '1.5s' }} />
              <div className="absolute inset-0 mx-auto w-28 h-28 rounded-full bg-green-400/20 animate-ping" style={{ animationDelay: '0.5s', animationDuration: '1.5s' }} />
            </>
          )}
        </div>

        {/* Title */}
        <h2 className={`text-3xl font-bold mb-3 transition-all duration-500 ${success ? 'text-green-400' : 'text-red-400'
          }`}
          style={{
            opacity: animationPhase === 'final' ? 1 : 0,
            transform: animationPhase === 'final' ? 'translateY(0)' : 'translateY(10px)',
          }}
        >
          {success ? '🎉 Predictions Locked In!' : 'Submission Failed'}
        </h2>

        {/* Subtitle message */}
        <p className="text-lg text-gray-200 mb-6 transition-all duration-500 delay-100"
          style={{
            opacity: animationPhase === 'final' ? 1 : 0,
          }}
        >
          {message}
        </p>

        {/* Stats Circle */}
        <div className="mb-8 transition-all duration-500 delay-200"
          style={{
            opacity: animationPhase === 'final' ? 1 : 0,
          }}
        >
          <div className="inline-flex items-center justify-center w-32 h-32 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border-2 border-blue-400/50 mb-4">
            <div className="text-center">
              <span className="text-4xl font-bold text-white">{submittedAnswers}</span>
              <span className="text-xl text-gray-400">/{totalQuestions}</span>
            </div>
          </div>
          <p className="text-gray-300">
            Questions Answered
          </p>
        </div>

        {/* What's Next Card */}
        <div className="mb-8 p-5 bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-400/30 rounded-2xl transition-all duration-500 delay-300"
          style={{
            opacity: animationPhase === 'final' ? 1 : 0,
          }}
        >
          <h3 className="text-lg font-bold text-white mb-3 flex items-center justify-center gap-2">
            <span>🔮</span> What&apos;s Next?
          </h3>
          <p className="text-gray-300 text-sm mb-4">{note}</p>
          <div className="flex flex-wrap justify-center gap-3 text-sm">
            <span className="px-3 py-1 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
              ✓ Admin Review
            </span>
            <span className="px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
              🏆 Top 10% Win
            </span>
            <span className="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
              🎁 Redeem Prizes
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col space-y-3 transition-all duration-500 delay-400"
          style={{
            opacity: animationPhase === 'final' ? 1 : 0,
          }}
        >
          {isInModal ? (
            <>
              <button
                onClick={onClose}
                className="w-full py-4 px-6 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-lg font-semibold rounded-xl hover:from-green-600 hover:to-emerald-700 transition-all duration-200 shadow-lg shadow-green-500/25"
              >
                🎯 Take More Quizzes
              </button>
              <button
                onClick={() => { router.push('/profile'); onClose?.(); }}
                className="w-full py-4 px-6 glass-card-blue glass-border-blue text-white font-semibold rounded-xl hover:bg-blue-500/20 transition-all duration-200"
              >
                👤 View My Points & Prizes
              </button>
            </>
          ) : (
            <>
              <Link
                href="/quizzes"
                className="w-full py-4 px-6 bg-gradient-to-r from-green-500 to-emerald-600 text-white text-lg font-semibold rounded-xl hover:from-green-600 hover:to-emerald-700 transition-all duration-200 shadow-lg shadow-green-500/25"
              >
                🎯 Take More Quizzes
              </Link>
              <Link
                href="/profile"
                className="w-full py-4 px-6 glass-card-blue glass-border-blue text-white font-semibold rounded-xl hover:bg-blue-500/20 transition-all duration-200"
              >
                👤 View My Points & Prizes
              </Link>
              <Link
                href="/"
                className="w-full py-3 px-6 text-gray-400 hover:text-white transition-colors"
              >
                Back to Lobby
              </Link>
            </>
          )}
        </div>

        {/* Live Stream Section */}
        <div className="mt-8 pt-6 border-t border-gray-700/50">
          <p className="text-gray-400 text-sm mb-4">Watch the live stream while you wait</p>
          <LazyStreamPlayer autoPlay={false} />
        </div>
      </div>
    </div>
  );
}