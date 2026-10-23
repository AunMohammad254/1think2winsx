'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { buildEmbedDataUri, youTubeEmbedUrl } from '@/lib/embed-utils';
import { STREAM_FULLSCREEN_ATTR, type StreamFullscreenMode } from '@/lib/stream-fullscreen';

interface StreamData {
  id: string;
  name: string;
  title: string;
  embedHtml: string;
}

interface StreamPlayerProps {
  className?: string;
  onError?: (error: string) => void;
  /** Element that goes fullscreen instead of the player, so the quiz pop-ups beside it come along. */
  fullscreenTargetId?: string;
}

/** How long to wait for the Fullscreen API before filling the window instead. */
const FULLSCREEN_WAIT_MS = 1500;

// Responsive helper (exported for tests)
export function getResponsiveClasses(width: number): string {
  if (width >= 1920) return 'aspect-video max-w-[1600px] mx-auto';
  if (width >= 1024) return 'aspect-video max-w-[1024px] mx-auto';
  if (width >= 768) return 'aspect-video max-w-[768px] mx-auto';
  return 'aspect-video w-full';
}

/**
 * The live stream: a title bar, the video, and ONE fullscreen button.
 *
 * The embed's own fullscreen is switched off (`fs=0`, and no `fullscreen` in the iframe's `allow`
 * list, which also stops YouTube's double-click fullscreen). It could only put the video itself in
 * fullscreen, where nothing of ours can be drawn: the quiz pop-ups and toasts would be hidden. Ours
 * puts `fullscreenTargetId` in fullscreen, so they come along. Where the browser can't put a page
 * element in fullscreen (iPhone Safari), the target fills the window with CSS instead ("immersive").
 */
export default function StreamPlayer({ className = '', onError, fullscreenTargetId }: StreamPlayerProps) {
  const [streamData, setStreamData] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState<StreamFullscreenMode | null>(null);
  // The player inside the iframe has loaded
  const [frameReady, setFrameReady] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const fetchStreamData = useCallback(async () => {
    try {
      const response = await fetch('/api/streaming/active');
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

  const getTarget = useCallback(
    () => (fullscreenTargetId ? document.getElementById(fullscreenTargetId) : containerRef.current),
    [fullscreenTargetId],
  );

  const enterFullscreen = useCallback(async () => {
    const target = getTarget() as any;
    if (!target) return;
    const fullscreenEnabled = document.fullscreenEnabled || (document as any).webkitFullscreenEnabled;
    const requestFs = target.requestFullscreen || target.webkitRequestFullscreen;
    if (fullscreenEnabled && requestFs) {
      try {
        // The fullscreenchange listener below records the mode. Some in-app browsers never settle
        // the request: after a moment the window is filled instead (a late success still wins).
        const entered = await Promise.race([
          requestFs.call(target, { navigationUI: 'hide' }).then(() => true).catch(() => requestFs.call(target).then(() => true)),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), FULLSCREEN_WAIT_MS)),
        ]);
        if (entered) return;
      } catch (err) {
        console.warn('Fullscreen request refused, filling the window instead', err);
      }
    }
    setFullscreen('immersive');
  }, [getTarget]);

  const exitFullscreen = useCallback(async () => {
    if (fullscreen === 'immersive') {
      setFullscreen(null);
      return;
    }
    try {
      const exitFs = document.exitFullscreen || (document as any).webkitExitFullscreen;
      if (exitFs) await exitFs.call(document);
    } catch (err) {
      console.error('Leaving fullscreen failed', err);
    }
  }, [fullscreen]);

  const toggleFullscreen = fullscreen ? exitFullscreen : enterFullscreen;

  // Native fullscreen: follow the browser (Esc, the system back gesture), and turn phones sideways
  useEffect(() => {
    const onChange = async () => {
      const orientation: any = window.screen?.orientation;
      const fsEl = document.fullscreenElement || (document as any).webkitFullscreenElement;
      if (fsEl && fsEl === getTarget()) {
        setFullscreen('native');
        try {
          await orientation?.lock?.('landscape');
        } catch {
          // Desktop browsers and iOS refuse; the layout works in both orientations
        }
      } else {
        setFullscreen((mode) => (mode === 'native' ? null : mode));
        orientation?.unlock?.();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [getTarget]);

  // Mark the target for live-quiz.css and the quiz pop-ups. Immersive mode also stops the page
  // behind it from scrolling, and Esc leaves it like it leaves native fullscreen.
  useEffect(() => {
    const target = getTarget();
    if (!fullscreen || !target) return;
    target.setAttribute(STREAM_FULLSCREEN_ATTR, fullscreen);
    if (fullscreen === 'native') return () => target.removeAttribute(STREAM_FULLSCREEN_ATTR);
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      target.removeAttribute(STREAM_FULLSCREEN_ATTR);
      root.style.overflow = overflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [fullscreen, getTarget]);

  // F toggles fullscreen while the player has focus
  useEffect(() => {
    const node = containerRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    node?.addEventListener('keydown', onKeyDown);
    return () => node?.removeEventListener('keydown', onKeyDown);
  }, [toggleFullscreen, streamData]);

  const handleIframeLoad = useCallback(() => {
    setFrameReady(true);
  }, []);

  // Initialize stream
  useEffect(() => {
    fetchStreamData();
  }, [fetchStreamData]);

  // Memoized embed source — must be declared before any early returns to satisfy
  // the Rules of Hooks (hooks must always be called in the same order). YouTube plays in its own
  // player with our parameters (no fullscreen button, inline on iPhones); anything else is the admin's
  // embed code in an isolated document, with its fullscreen switched off too (see embed-utils).
  const embed = useMemo(() => {
    if (!streamData) return null;
    const youTubeSrc = youTubeEmbedUrl(streamData.embedHtml);
    return youTubeSrc
      ? { src: youTubeSrc, className: 'w-full h-full border-0' }
      : { src: buildEmbedDataUri(streamData.embedHtml), className: 'yt-player-frame' };
  }, [streamData]);

  if (loading) {
    return (
      <div className={`yt-responsive-player flex items-center justify-center border border-white/10 bg-gradient-to-br from-gray-900/90 to-gray-800/70 ${className}`} role="status" aria-live="polite">
        <div className="text-center text-white p-8">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-purple-400" />
          <p className="text-gray-300">Loading stream...</p>
        </div>
      </div>
    );
  }

  if (error || !streamData) {
    return (
      <div className={`yt-responsive-player flex items-center justify-center border border-white/10 bg-gradient-to-br from-gray-900/90 to-gray-800/70 ${className}`} role="alert" aria-live="assertive">
        <div className="text-center text-white p-8">
          <p className="mb-4 text-gray-300">{error /* a finished load sets either streamData or error */}</p>
          <button
            onClick={fetchStreamData}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all"
            aria-label="Retry loading stream"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const fullscreenLabel = fullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
  return (
    <div className={`stream-player flex flex-col w-full ${className}`}>
      {/* The only chrome outside the video; hidden in fullscreen so the video gets the whole screen */}
      {!fullscreen && (
        <div className="stream-bar">
          <span className="live-tag"><span className="rec" aria-hidden="true" />LIVE</span>
          <span className="stream-name">{streamData.name}</span>
          <button onClick={toggleFullscreen} className="bar-btn" aria-label={fullscreenLabel} title="Fullscreen (F)">
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="stream-video relative bg-black overflow-hidden yt-responsive-player w-full"
        role="application"
        aria-label="Live stream viewer"
        tabIndex={0}
      >
        <iframe
          src={embed!.src}
          className={embed!.className}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          // YouTube identifies the embedding site from the referrer and refuses to play without one
          // (error 153), so this is set here instead of relying on the page's header
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          aria-label={streamData.title}
          onLoad={handleIframeLoad}
          title={streamData.title}
        />

        {/* Black until the player has loaded: say so instead of showing an empty box */}
        {!frameReady && (
          <div className="stream-connecting" role="status" aria-live="polite">
            <Loader2 className="w-7 h-7 animate-spin text-purple-400" aria-hidden="true" />
            <span>Connecting to the stream…</span>
          </div>
        )}

        {fullscreen && (
          <button onClick={toggleFullscreen} className="stream-exit" aria-label={fullscreenLabel} title="Exit fullscreen (Esc)">
            <Minimize2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
