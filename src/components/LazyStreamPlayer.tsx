'use client';

import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { Loader2, Play, Radio } from 'lucide-react';

// Lazy load the StreamPlayer component
const StreamPlayer = lazy(() => import('./StreamPlayer'));

interface LazyStreamPlayerProps {
  className?: string;
  autoPlay?: boolean;
  showControls?: boolean;
  onError?: (error: string) => void;
  onMetrics?: (metrics: unknown) => void;
  placeholder?: React.ReactNode;
  fullscreenTargetId?: string;
}

// Loading fallback component
function StreamPlayerSkeleton() {
  return (
    <div className="yt-player-frame relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/90 to-gray-800/70 flex items-center justify-center">
      <div className="text-center text-white">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-purple-400" />
        <p className="text-sm text-gray-300">Loading stream player...</p>
      </div>
    </div>
  );
}

// Placeholder component for when stream is not loaded
function StreamPlaceholder({ onLoadStream }: { onLoadStream: () => void }) {
  return (
    <div className="yt-player-frame relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/90 via-purple-950/40 to-gray-900/90 flex items-center justify-center">
      {/* Ambient glow, matching the app's other glass cards */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_140%_at_15%_0%,rgba(147,51,234,0.18),transparent_55%),radial-gradient(120%_140%_at_85%_100%,rgba(59,130,246,0.16),transparent_55%)]" />



      <div className="relative text-center text-white p-4 sm:p-8 flex flex-col items-center justify-center h-full">
        <button
          onClick={onLoadStream}
          aria-label="Load stream"
          className="group hidden sm:flex w-16 h-16 mx-auto mb-4 rounded-full bg-white/10 border border-white/20 items-center justify-center backdrop-blur-sm hover:bg-white/20 hover:scale-105 transition-all duration-200"
        >
          <Play className="w-7 h-7 ml-1 group-hover:scale-110 transition-transform" />
        </button>
        <h3 className="text-base sm:text-lg font-bold mb-1.5 sm:mb-2 mt-4 sm:mt-0 flex items-center justify-center gap-1.5 sm:gap-2">
          <Radio className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
          Live Stream Available
        </h3>
        <p className="hidden sm:block text-sm text-gray-400 mb-5 max-w-md mx-auto">
          Watch live while you take the quiz — the admin can push new quizzes to you here.
        </p>
        <button
          onClick={onLoadStream}
          className="px-5 py-2 sm:px-6 sm:py-2.5 mt-1 sm:mt-0 text-sm sm:text-base rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 hover:shadow-lg hover:shadow-purple-500/25 transition-all duration-200 font-semibold"
        >
          Load Stream
        </button>
      </div>
    </div>
  );
}

export default function LazyStreamPlayer({
  className = '',
  autoPlay = false,
  onError,
  placeholder,
  fullscreenTargetId,
}: LazyStreamPlayerProps) {
  const [shouldLoad, setShouldLoad] = useState(autoPlay);
  const [hasStreamAvailable, setHasStreamAvailable] = useState<boolean | null>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Check if stream is available without loading the full component
  useEffect(() => {
    const checkStreamAvailability = async () => {
      try {
        const response = await fetch('/api/streaming/active', { cache: 'no-store' });
        const data = await response.json();
        setHasStreamAvailable(data.hasActiveStream);
      } catch (error) {
        console.error('Error checking stream availability:', error);
        setHasStreamAvailable(false);
      }
    };

    checkStreamAvailability();
  }, []);

  // Intersection Observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      },
      {
        threshold: 0.1,
        rootMargin: '50px',
      }
    );

    const el = containerRef.current;
    if (el) observer.observe(el);
    return () => {
      if (el) observer.unobserve(el);
    };
  }, []);

  // Auto-load when in viewport and stream is available
  useEffect(() => {
    if (isIntersecting && hasStreamAvailable && autoPlay && !shouldLoad) {
      setShouldLoad(true);
    }
  }, [isIntersecting, hasStreamAvailable, autoPlay, shouldLoad]);

  const handleLoadStream = () => {
    setShouldLoad(true);
  };

  const handleStreamError = (error: string) => {
    console.error('Stream error:', error);
    onError?.(error);
    // Optionally reset shouldLoad to show placeholder again
    // setShouldLoad(false);
  };

  // Metric callback intentionally not used here; StreamPlayer handles its own metrics

  // Don't render anything if no stream is available
  if (hasStreamAvailable === false) {
    return null;
  }

  // Show loading state while checking availability
  if (hasStreamAvailable === null) {
    return (
        <div ref={containerRef} className={`yt-responsive-player ${className}`}>
        <div className="yt-player-frame rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/90 to-gray-800/70 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className}>
      {shouldLoad ? (
        <Suspense fallback={<div className="yt-responsive-player"><StreamPlayerSkeleton /></div>}>
          <StreamPlayer
            className="yt-responsive-player"
            onError={handleStreamError}
            fullscreenTargetId={fullscreenTargetId}
          />
        </Suspense>
      ) : (
        <div className="yt-responsive-player">
          {placeholder || <StreamPlaceholder onLoadStream={handleLoadStream} />}
        </div>
      )}
    </div>
  );
}
