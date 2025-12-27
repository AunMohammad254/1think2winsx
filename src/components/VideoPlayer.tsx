'use client';

/**
 * VideoPlayer Component
 * 
 * A robust, reusable video player that fetches stream configuration
 * from the database and displays it with proper error handling.
 * 
 * Features:
 * - Supports both direct URLs and raw HTML embed codes
 * - Displays "Stream Currently Offline" fallback UI when no stream
 * - Auto-refreshes configuration periodically
 * - Responsive design with fullscreen support
 * - Keyboard controls (F for fullscreen)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    Loader2,
    WifiOff,
    RefreshCw,
    Maximize2,
    Minimize2,
    Settings,
    Video,
} from 'lucide-react';
import { getStreamConfig, type StreamConfig } from '@/actions/streaming-actions';

// ============================================
// Props Interface
// ============================================
interface VideoPlayerProps {
    /** Additional CSS classes */
    className?: string;
    /** Auto-play when stream loads */
    autoPlay?: boolean;
    /** Show player controls overlay */
    showControls?: boolean;
    /** Custom message when stream is offline */
    fallbackMessage?: string;
    /** Error callback */
    onError?: (error: string) => void;
    /** Load callback */
    onLoad?: () => void;
    /** Pre-fetched config from server component */
    initialConfig?: StreamConfig | null;
    /** Refresh interval in milliseconds (0 = disabled) */
    refreshInterval?: number;
}

// ============================================
// Main Component
// ============================================
export default function VideoPlayer({
    className = '',
    autoPlay = true,
    showControls = true,
    fallbackMessage = 'Stream Currently Offline',
    onError,
    onLoad,
    initialConfig = null,
    refreshInterval = 30000, // 30 seconds default
}: VideoPlayerProps) {
    // State
    const [config, setConfig] = useState<StreamConfig | null>(initialConfig);
    const [loading, setLoading] = useState(!initialConfig);
    const [error, setError] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [iframeLoaded, setIframeLoaded] = useState(false);

    // Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // ============================================
    // Data Fetching
    // ============================================
    const fetchConfig = useCallback(async () => {
        try {
            const data = await getStreamConfig();
            setConfig(data);
            setError(null);

            if (data.success && data.isActive && (data.embedHtml || data.embedUrl)) {
                onLoad?.();
            } else if (!data.isActive) {
                setError('Stream is currently offline');
            }
        } catch (err) {
            console.error('Error fetching stream config:', err);
            const errorMsg = err instanceof Error ? err.message : 'Failed to load stream';
            setError(errorMsg);
            onError?.(errorMsg);
        } finally {
            setLoading(false);
        }
    }, [onError, onLoad]);

    // Initial fetch
    useEffect(() => {
        if (!initialConfig) {
            fetchConfig();
        }
    }, [fetchConfig, initialConfig]);

    // Periodic refresh
    useEffect(() => {
        if (refreshInterval > 0) {
            refreshIntervalRef.current = setInterval(fetchConfig, refreshInterval);
            return () => {
                if (refreshIntervalRef.current) {
                    clearInterval(refreshIntervalRef.current);
                }
            };
        }
    }, [fetchConfig, refreshInterval]);

    // ============================================
    // Fullscreen Toggle
    // ============================================
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

    // Keyboard controls
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === 'f' && containerRef.current?.contains(document.activeElement)) {
                e.preventDefault();
                toggleFullscreen();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [toggleFullscreen]);

    // Fullscreen change listener
    useEffect(() => {
        const onFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);

    // ============================================
    // Build Embed HTML
    // ============================================
    const buildEmbedDocument = (rawHtml: string): string => {
        return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        html, body { height: 100%; margin: 0; padding: 0; background: #000; overflow: hidden; }
        .wrapper { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
        iframe, video { width: 100% !important; height: 100% !important; border: 0; }
        .wrapper > * { max-width: 100%; max-height: 100%; }
      </style>
    </head><body>
      <div class="wrapper">${rawHtml}</div>
    </body></html>`;
    };

    // ============================================
    // Render: Loading State
    // ============================================
    if (loading) {
        return (
            <div
                className={`flex items-center justify-center bg-gray-900 rounded-xl aspect-video ${className}`}
                role="status"
                aria-live="polite"
            >
                <div className="text-center text-white p-8">
                    <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-gray-400" />
                    <p className="text-gray-300">Loading stream...</p>
                </div>
            </div>
        );
    }

    // ============================================
    // Render: Offline/Error State
    // ============================================
    const isOffline = !config?.isActive || (!config?.embedHtml && !config?.embedUrl) || error;

    if (isOffline) {
        return (
            <div
                className={`flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl aspect-video ${className}`}
                role="alert"
                aria-live="polite"
            >
                <div className="text-center p-8">
                    <div className="relative mb-6">
                        <div className="absolute inset-0 bg-red-500/20 blur-xl rounded-full" />
                        <WifiOff className="w-16 h-16 text-gray-400 mx-auto relative z-10" />
                    </div>
                    <h3 className="text-xl font-semibold text-white mb-2">
                        {fallbackMessage}
                    </h3>
                    <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
                        {error || 'The stream is not available at the moment. Please check back later.'}
                    </p>
                    <button
                        onClick={() => {
                            setLoading(true);
                            fetchConfig();
                        }}
                        className="px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-medium transition-all flex items-center gap-2 mx-auto"
                        aria-label="Retry loading stream"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    // ============================================
    // Render: Active Stream
    // ============================================
    const embedContent = config.embedHtml || (config.embedUrl ? `<iframe src="${config.embedUrl}" allowfullscreen></iframe>` : '');

    return (
        <div
            ref={containerRef}
            className={`relative bg-black rounded-xl overflow-hidden aspect-video ${className} ${isFullscreen ? 'fixed inset-0 z-50 rounded-none' : ''
                }`}
            role="application"
            aria-label={`Live stream: ${config.title || 'Livestream'}`}
            tabIndex={0}
        >
            {/* Stream Iframe */}
            <div className="relative w-full h-full">
                {!iframeLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
                        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                    </div>
                )}
                <iframe
                    src={`data:text/html;charset=utf-8,${encodeURIComponent(buildEmbedDocument(embedContent))}`}
                    className="w-full h-full border-0"
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    allowFullScreen
                    loading="lazy"
                    title={config.title || 'Livestream'}
                    onLoad={() => setIframeLoaded(true)}
                    onError={() => {
                        setError('Stream failed to load');
                        onError?.('Stream failed to load');
                    }}
                />
            </div>

            {/* Controls Overlay */}
            {showControls && (
                <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                    {/* Top Bar */}
                    <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-4">
                        <div className="flex items-center justify-between text-white">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                                    </span>
                                    <span className="text-sm font-medium">LIVE</span>
                                </div>
                                <span className="text-gray-300 text-sm">{config.title || 'Livestream'}</span>
                            </div>

                            <div className="flex items-center gap-2 pointer-events-auto">
                                <button
                                    onClick={() => setShowSettings(!showSettings)}
                                    className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                                    aria-label="Toggle settings"
                                >
                                    <Settings className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={toggleFullscreen}
                                    className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                                    aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                                >
                                    {isFullscreen ? (
                                        <Minimize2 className="w-4 h-4" />
                                    ) : (
                                        <Maximize2 className="w-4 h-4" />
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Settings Panel */}
                    {showSettings && (
                        <div className="absolute top-16 right-4 bg-black/90 backdrop-blur-sm rounded-xl p-4 text-white min-w-48 pointer-events-auto border border-white/10">
                            <h3 className="text-sm font-semibold mb-3">Viewer Settings</h3>
                            <div className="space-y-2 text-xs text-gray-300">
                                <p>Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white">F</kbd> to toggle fullscreen</p>
                                <p>Captions controlled by stream provider</p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================
// Skeleton Loader Component (for lazy loading)
// ============================================
export function VideoPlayerSkeleton({ className = '' }: { className?: string }) {
    return (
        <div className={`bg-gray-900 rounded-xl aspect-video animate-pulse flex items-center justify-center ${className}`}>
            <Video className="w-12 h-12 text-gray-700" />
        </div>
    );
}
