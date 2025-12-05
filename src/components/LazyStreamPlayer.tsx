'use client';

import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { Loader2, Play } from 'lucide-react';

// Lazy load the StreamPlayer component
const StreamPlayer = lazy(() => import('./StreamPlayer'));

interface LazyStreamPlayerProps {
  className?: string;
  autoPlay?: boolean;
  showControls?: boolean;
  onError?: (error: string) => void;
  onMetrics?: (metrics: unknown) => void;
  placeholder?: React.ReactNode;
}

// Loading fallback component
function StreamPlayerSkeleton() {
  return (
    <div className="yt-player-frame bg-gray-900 flex items-center justify-center">
      <div className="text-center text-white">
        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
        <p className="text-sm">Loading stream player...</p>
      </div>
    </div>
  );
}

// Placeholder component for when stream is not loaded
function StreamPlaceholder({ onLoadStream }: { onLoadStream: () => void }) {
  return (
    <div className="yt-player-frame bg-gradient-to-br from-blue-900 to-purple-900 flex items-center justify-center">
      <div className="text-center text-white p-8">
        <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <Play className="w-8 h-8 ml-1" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Live Stream Available</h3>
        <p className="text-sm text-gray-300 mb-4">
          Watch live content while taking the quiz
        </p>
        <button
          onClick={onLoadStream}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-medium"
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
        <div className="yt-player-frame bg-gray-800 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
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
