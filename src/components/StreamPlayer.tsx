'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, Settings, Maximize2, Minimize2 } from 'lucide-react';
import { buildEmbedDataUri, getYouTubeVideoId, isYouTubeContent } from '@/lib/embed-utils';

interface StreamData {
  id: string;
  name: string;
  title: string;
  embedHtml: string;
}

interface StreamPlayerProps {
  className?: string;
  onError?: (error: string) => void;
}

// Responsive helper (exported for tests)
export function getResponsiveClasses(width: number): string {
  if (width >= 1920) return 'aspect-video max-w-[1600px] mx-auto';
  if (width >= 1024) return 'aspect-video max-w-[1024px] mx-auto';
  if (width >= 768) return 'aspect-video max-w-[768px] mx-auto';
  return 'aspect-video w-full';
}

export default function StreamPlayer({ className = '', onError }: StreamPlayerProps) {
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // (removed) resizeTimeoutRef no longer needed

  const fetchStreamData = useCallback(async () => {
    try {
      const response = await fetch('/api/streaming/active', { cache: 'no-store' });
      const data = await response.json();
      if (data.hasActiveStream && data.stream) {
        const s = data.stream.facebookLiveVideo
          ? { id: data.stream.id, name: data.stream.name || 'Livestream', title: data.stream.facebookLiveVideo.title || 'Livestream', embedHtml: data.stream.facebookLiveVideo.embedHtml }
          : { id: data.stream.id, name: data.stream.name || 'Livestream', title: data.stream.title || 'Livestream', embedHtml: data.stream.embedHtml };
        setStreamData(s);
        setError(null);
      } else {
        setStreamData(null);
        setError('No active stream available');
      }
    } catch (err) {
      console.error('Error fetching stream data:', err);
      setError('Failed to load stream');
      onError?.('Failed to load stream');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  // (Removed) responsiveClasses state was unused; container uses fixed responsive CSS

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  }, [isFullscreen]);

  // Keyboard controls (F toggles fullscreen).
  // Uses a ref so the listener does not need to be re-attached on every
  // isFullscreen state change.
  const isFullscreenRef = useRef(isFullscreen);
  useEffect(() => { isFullscreenRef.current = isFullscreen; }, [isFullscreen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    const node = containerRef.current;
    node?.addEventListener('keydown', onKeyDown);
    return () => node?.removeEventListener('keydown', onKeyDown);
    // toggleFullscreen is stable (useCallback with no deps that change per frame)
  }, [toggleFullscreen]);

  const handleIframeLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleIframeError = useCallback(() => {
    setError('Stream failed to load');
  }, []);

  // Initialize stream
  useEffect(() => {
    fetchStreamData();
  }, [fetchStreamData]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 rounded-lg ${className}`} role="status" aria-live="polite">
        <div className="text-center text-white p-8">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p>Loading stream...</p>
        </div>
      </div>
    );
  }

  if (error || !streamData) {
    return (
      <div className={`flex items-center justify-center bg-gray-900 rounded-lg ${className}`} role="alert" aria-live="assertive">
        <div className="text-center text-white p-8">
          <p className="mb-4">{error || 'No stream available'}</p>
          <button
            onClick={fetchStreamData}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            aria-label="Retry loading stream"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  // Memoized embed source — avoids recalculating the iframe src on every render.
  const embedSrc = useMemo(() => {
    if (!streamData) return '';
    const ytId = isYouTubeContent(streamData.embedHtml)
      ? getYouTubeVideoId(streamData.embedHtml)
      : null;
    if (ytId) {
      return `https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1`;
    }
    return buildEmbedDataUri(streamData.embedHtml);
  }, [streamData]);

  // For YouTube, render iframe directly (avoids Error 153)
  const renderStreamContent = () => {
    if (!streamData) return null;
    return (
      <iframe
        ref={iframeRef}
        src={embedSrc}
        className={isYouTubeContent(streamData.embedHtml) ? 'w-full h-full border-0' : 'yt-player-frame'}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        aria-label={streamData.title}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        title={streamData.title}
      />
    );
  };

  return (
    <div
      ref={containerRef}
      className={`relative bg-black rounded-lg overflow-hidden yt-responsive-player ${className} ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}
      role="application"
      aria-label="Live stream viewer"
      tabIndex={0}
    >
      {/* Stream iframe */}
      <div className="relative w-full h-full">
        {renderStreamContent()}
      </div>

      {/* Controls overlay */}
      <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none">
        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-4">
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center space-x-3">
              <div className="text-sm text-gray-300">
                {streamData.name}
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-white/20 rounded-lg transition-colors pointer-events-auto" aria-label="Toggle settings">
                <Settings className="w-4 h-4" />
              </button>
              <button onClick={toggleFullscreen} className="p-2 hover:bg-white/20 rounded-lg transition-colors pointer-events-auto" aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="absolute top-16 right-4 bg-black/90 rounded-lg p-4 text-white min-w-48 pointer-events-auto">
            <h3 className="text-sm font-semibold mb-3">Viewer Settings</h3>
            <p className="text-xs text-gray-300">Keyboard: press F to toggle fullscreen.</p>
            <p className="text-xs text-gray-300">Captions are controlled by the embed provider.</p>
          </div>
        )}
      </div>
    </div>
  );
}

