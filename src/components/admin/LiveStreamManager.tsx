'use client';

import { useState, useEffect, useTransition } from 'react';
import {
    Video,
    Loader2,
    Save,
    RefreshCw,
    Monitor,
    Smartphone,
    Tablet,
    CheckCircle2,
    AlertCircle,
    Code2,
    Eye,
    EyeOff,
    Power,
    PowerOff,
    Youtube,
    Globe,
    Info,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    getStreamConfig,
    updateStreamConfig,
    toggleStreamStatus,
    type StreamConfig,
    type UpdateStreamConfigInput,
} from '@/actions/streaming-actions';
import { detectPlatform } from '@/utils/streaming-utils';

// ============================================
// Types
// ============================================
type PreviewMode = 'desktop' | 'tablet' | 'mobile';
type PreviewSource = 'draft' | 'saved';

const previewModes: { mode: PreviewMode; icon: typeof Monitor; label: string; width: string }[] = [
    { mode: 'desktop', icon: Monitor, label: 'Desktop', width: 'w-full' },
    { mode: 'tablet', icon: Tablet, label: 'Tablet', width: 'max-w-2xl' },
    { mode: 'mobile', icon: Smartphone, label: 'Mobile', width: 'max-w-sm' },
];

const platformIcons: Record<string, typeof Youtube> = {
    youtube: Youtube,
    facebook: Globe,
    twitch: Globe,
    custom: Code2,
};

// ============================================
// Validation helpers
// ============================================
function validateEmbed(html: string): { valid: boolean; message: string } {
    if (!html || html.trim().length < 10) {
        return { valid: false, message: 'Enter at least 10 characters' };
    }

    const hasValidTag = /<(iframe|video|embed|object|blockquote)/i.test(html);
    const hasScriptTag = /<script/i.test(html);

    if (hasScriptTag) {
        return { valid: false, message: 'Script tags are not allowed' };
    }

    if (!hasValidTag) {
        // Check if it might be a URL
        try {
            const url = new URL(html.trim());
            if (['http:', 'https:'].includes(url.protocol)) {
                return { valid: true, message: 'Valid URL detected' };
            }
        } catch {
            // Not a URL
        }
        return { valid: false, message: 'Must contain iframe, video, or embed tag' };
    }

    return { valid: true, message: 'Valid embed code' };
}

// ============================================
// Draft Preview Component
// ============================================
function DraftPreview({ embedHtml }: { embedHtml: string }) {
    const previewDoc = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { height: 100%; margin: 0; padding: 0; background: #000; }
      .wrapper { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
      iframe, video { width: 100% !important; height: 100% !important; border: 0; }
      .wrapper > * { max-width: 100%; max-height: 100%; }
    </style>
  </head><body>
    <div class="wrapper">${embedHtml}</div>
  </body></html>`;

    return (
        <iframe
            srcDoc={previewDoc}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            title="Draft embed preview"
        />
    );
}

// ============================================
// Saved Stream Preview Component
// ============================================
function SavedPreview({ config }: { config: StreamConfig | null }) {
    if (!config || !config.isActive || (!config.embedHtml && !config.embedUrl)) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <Video className="w-16 h-16 mb-4 text-gray-600" />
                <p className="text-lg font-medium">No Active Stream</p>
                <p className="text-sm text-gray-500 mt-1">Save an embed code and activate the stream</p>
            </div>
        );
    }

    const embedContent = config.embedHtml || (config.embedUrl ? `<iframe src="${config.embedUrl}" allowfullscreen></iframe>` : '');

    return <DraftPreview embedHtml={embedContent} />;
}

// ============================================
// Main Component
// ============================================
export default function LiveStreamManager() {
    // State
    const [config, setConfig] = useState<StreamConfig | null>(null);
    const [embedHtml, setEmbedHtml] = useState<string>('');
    const [title, setTitle] = useState<string>('Livestream');
    const [platform, setPlatform] = useState<UpdateStreamConfigInput['platform']>('custom');
    const [isActive, setIsActive] = useState<boolean>(false);

    const [loading, setLoading] = useState<boolean>(true);
    const [isPending, startTransition] = useTransition();
    const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');
    const [showPreview, setShowPreview] = useState<boolean>(true);
    const [previewSource, setPreviewSource] = useState<PreviewSource>('draft');

    // Derived state
    const originalEmbed = config?.embedHtml || '';
    const hasChanges = embedHtml !== originalEmbed || title !== (config?.title || 'Livestream') || isActive !== (config?.isActive || false);
    const validation = validateEmbed(embedHtml);

    // ============================================
    // Data Fetching
    // ============================================
    useEffect(() => {
        async function fetchConfig() {
            try {
                const data = await getStreamConfig();
                setConfig(data);
                setEmbedHtml(data.embedHtml || '');
                setTitle(data.title || 'Livestream');
                setPlatform(data.platform || 'custom');
                setIsActive(data.isActive || false);
            } catch (err) {
                console.error('Failed to fetch config:', err);
                toast.error('Failed to load stream configuration');
            } finally {
                setLoading(false);
            }
        }
        fetchConfig();
    }, []);

    // Auto-detect platform when embed changes
    useEffect(() => {
        if (embedHtml) {
            const detected = detectPlatform(embedHtml);
            setPlatform(detected);
        }
    }, [embedHtml]);

    // ============================================
    // Save Action
    // ============================================
    const handleSave = () => {
        if (!validation.valid) {
            toast.error(validation.message);
            return;
        }

        startTransition(async () => {
            try {
                const result = await updateStreamConfig(
                    {
                        embedHtml,
                        title,
                        platform,
                        isActive,
                    },
                    'admin' // TODO: Get actual admin email from session
                );

                if (!result.success) {
                    toast.error(result.error || 'Failed to save');
                    return;
                }

                // Update local state with saved config
                if (result.data) {
                    setConfig(result.data);
                }

                toast.success('Stream configuration saved!', {
                    icon: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
                    description: isActive ? 'Stream is now live' : 'Stream is saved but not active',
                });
            } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Failed to save');
            }
        });
    };

    // ============================================
    // Toggle Active Status
    // ============================================
    const handleToggleActive = () => {
        startTransition(async () => {
            try {
                const newStatus = !isActive;
                const result = await toggleStreamStatus(newStatus, 'admin');

                if (!result.success) {
                    toast.error(result.error || 'Failed to toggle status');
                    return;
                }

                setIsActive(newStatus);
                setConfig(prev => prev ? { ...prev, isActive: newStatus } : prev);

                toast.success(newStatus ? 'Stream activated!' : 'Stream deactivated', {
                    icon: newStatus ? (
                        <Power className="w-5 h-5 text-emerald-400" />
                    ) : (
                        <PowerOff className="w-5 h-5 text-gray-400" />
                    ),
                });
            } catch (err) {
                toast.error('Failed to toggle stream status');
            }
        });
    };

    // ============================================
    // Discard Changes
    // ============================================
    const handleDiscard = () => {
        setEmbedHtml(originalEmbed);
        setTitle(config?.title || 'Livestream');
        setIsActive(config?.isActive || false);
        toast.info('Changes discarded');
    };

    // ============================================
    // Render
    // ============================================
    const PlatformIcon = platformIcons[platform || 'custom'] || Globe;

    return (
        <div className="space-y-6">
            {/* Stream Status Card */}
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 overflow-hidden">
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${isActive ? 'bg-emerald-500/20' : 'bg-gray-500/20'}`}>
                            {isActive ? (
                                <Power className="w-5 h-5 text-emerald-400" />
                            ) : (
                                <PowerOff className="w-5 h-5 text-gray-400" />
                            )}
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white">Stream Status</h3>
                            <p className="text-sm text-gray-400">
                                {isActive ? 'Stream is live and visible to users' : 'Stream is offline'}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={handleToggleActive}
                        disabled={isPending || !config?.embedHtml}
                        className={`px-4 py-2 rounded-xl font-medium transition-all flex items-center gap-2 ${isActive
                            ? 'bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30'
                            : 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/30'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isActive ? (
                            <>
                                <PowerOff className="w-4 h-4" />
                                Go Offline
                            </>
                        ) : (
                            <>
                                <Power className="w-4 h-4" />
                                Go Live
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Embed Editor Card */}
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-red-500/20">
                            <Code2 className="w-5 h-5 text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white">Embed Configuration</h3>
                            <p className="text-sm text-gray-400">Paste your livestream embed HTML code</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {hasChanges && (
                            <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-medium flex items-center gap-1.5">
                                <AlertCircle className="w-3.5 h-3.5" />
                                Unsaved changes
                            </span>
                        )}
                        <div className="px-3 py-1 rounded-full bg-white/5 border border-white/10 flex items-center gap-2">
                            <PlatformIcon className="w-4 h-4 text-gray-400" />
                            <span className="text-xs text-gray-400 capitalize">{platform}</span>
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-gray-400">
                            <Loader2 className="w-6 h-6 animate-spin mr-3" />
                            <span>Loading configuration...</span>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Title Input */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Stream Title</label>
                                <input
                                    type="text"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Enter stream title"
                                    className="w-full bg-gray-950/50 text-gray-100 border border-white/10 rounded-xl px-4 py-2.5 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/25"
                                />
                            </div>

                            {/* Embed Editor */}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Embed Code</label>
                                <div className="relative">
                                    <textarea
                                        value={embedHtml}
                                        onChange={(e) => setEmbedHtml(e.target.value)}
                                        placeholder='Paste your livestream embed HTML here, e.g.:&#10;<iframe src="https://..." allowfullscreen></iframe>'
                                        className="w-full h-40 bg-gray-950/50 text-gray-100 border border-white/10 rounded-xl p-4 font-mono text-sm focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/25 resize-none"
                                        spellCheck={false}
                                    />
                                    <div className="absolute bottom-3 right-3 flex items-center gap-3">
                                        <span className={`text-xs ${validation.valid ? 'text-emerald-400' : 'text-gray-500'}`}>
                                            {validation.valid ? (
                                                <span className="flex items-center gap-1">
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                    {validation.message}
                                                </span>
                                            ) : (
                                                validation.message
                                            )}
                                        </span>
                                        <span className="text-xs text-gray-600">{embedHtml.length} chars</span>
                                    </div>
                                </div>
                            </div>

                            {/* Help Text */}
                            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                                <div className="flex gap-3">
                                    <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                                    <div className="text-sm">
                                        <p className="text-blue-300 font-medium">Supported Platforms</p>
                                        <p className="text-blue-200/70 mt-1">
                                            Facebook Live, YouTube Live, Twitch, and any platform that provides an embed iframe code.
                                            Simply copy the embed code from your streaming platform and paste it above.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-between pt-2">
                                <button
                                    onClick={handleDiscard}
                                    disabled={!hasChanges || isPending}
                                    className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Discard Changes
                                </button>

                                <button
                                    onClick={handleSave}
                                    disabled={isPending || !hasChanges || !validation.valid}
                                    className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-pink-500 text-white font-medium hover:from-red-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-red-500/20"
                                >
                                    {isPending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Save className="w-4 h-4" />
                                            Save Changes
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Preview Card */}
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-emerald-500/20">
                            <Eye className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-white">Live Preview</h3>
                            <p className="text-sm text-gray-400">See how the stream appears to users</p>
                        </div>
                    </div>

                    {/* Preview Controls */}
                    <div className="flex items-center gap-2">
                        {/* Device Toggle */}
                        <div className="flex rounded-lg bg-white/5 border border-white/10 p-1">
                            {previewModes.map(({ mode, icon: Icon, label }) => (
                                <button
                                    key={mode}
                                    onClick={() => setPreviewMode(mode)}
                                    title={label}
                                    className={`p-2 rounded-md transition-all ${previewMode === mode
                                        ? 'bg-white/10 text-white'
                                        : 'text-gray-400 hover:text-white'
                                        }`}
                                >
                                    <Icon className="w-4 h-4" />
                                </button>
                            ))}
                        </div>

                        {/* Toggle Preview */}
                        <button
                            onClick={() => setShowPreview(!showPreview)}
                            className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${showPreview
                                ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300'
                                : 'bg-white/5 border border-white/10 text-gray-400'
                                }`}
                        >
                            {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            {showPreview ? 'Hide' : 'Show'}
                        </button>

                        {/* Draft/Saved Toggle */}
                        <div className="flex rounded-lg bg-white/5 border border-white/10 p-1">
                            <button
                                onClick={() => setPreviewSource('draft')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${previewSource === 'draft'
                                    ? 'bg-amber-500/20 text-amber-300'
                                    : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                Draft
                            </button>
                            <button
                                onClick={() => setPreviewSource('saved')}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${previewSource === 'saved'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'text-gray-400 hover:text-white'
                                    }`}
                            >
                                Saved
                            </button>
                        </div>
                    </div>
                </div>

                {/* Preview Content */}
                <div className="p-6">
                    {showPreview ? (
                        <div className={`mx-auto transition-all duration-300 ${previewModes.find(p => p.mode === previewMode)?.width}`}>
                            {(previewSource === 'draft' ? embedHtml : config?.embedHtml) ? (
                                <div className="aspect-video rounded-xl overflow-hidden border border-white/10 bg-black">
                                    {previewSource === 'draft' ? (
                                        <DraftPreview embedHtml={embedHtml} key={`draft-${embedHtml.length}`} />
                                    ) : (
                                        <SavedPreview config={config} />
                                    )}
                                </div>
                            ) : (
                                <div className="aspect-video rounded-xl border border-white/10 bg-gray-900/50 flex flex-col items-center justify-center">
                                    <Video className="w-16 h-16 text-gray-600 mb-4" />
                                    <p className="text-gray-400 text-lg font-medium">No Stream Configured</p>
                                    <p className="text-gray-500 text-sm mt-1">Paste an embed code above to see the preview</p>
                                </div>
                            )}

                            {/* Device Frame Label */}
                            <div className="text-center mt-3 flex items-center justify-center gap-2">
                                <span className="text-xs text-gray-500 uppercase tracking-wider">
                                    {previewModes.find(p => p.mode === previewMode)?.label} View
                                </span>
                                <span className="text-xs text-gray-600">•</span>
                                <span className={`text-xs uppercase tracking-wider ${previewSource === 'draft' ? 'text-amber-400' : 'text-emerald-400'
                                    }`}>
                                    {previewSource === 'draft' ? 'Draft Preview' : 'Saved Preview'}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-12">
                            <Video className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                            <p className="text-gray-400">Preview hidden</p>
                            <button
                                onClick={() => setShowPreview(true)}
                                className="mt-3 text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1 mx-auto"
                            >
                                <Eye className="w-4 h-4" />
                                Show Preview
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Quick Tips */}
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/80 to-gray-800/60 p-6">
                <h3 className="text-lg font-semibold text-white mb-4">Quick Tips</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-white/5 rounded-xl">
                        <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mb-3">
                            <span className="text-blue-400 text-lg font-bold">1</span>
                        </div>
                        <h4 className="text-white font-medium mb-1">Get Embed Code</h4>
                        <p className="text-gray-400 text-sm">
                            Go to your streaming platform and look for &quot;Embed&quot; or &quot;Share&quot; options.
                        </p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-xl">
                        <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center mb-3">
                            <span className="text-purple-400 text-lg font-bold">2</span>
                        </div>
                        <h4 className="text-white font-medium mb-1">Copy the iframe</h4>
                        <p className="text-gray-400 text-sm">
                            Copy the entire &lt;iframe&gt; code snippet provided by the platform.
                        </p>
                    </div>
                    <div className="p-4 bg-white/5 rounded-xl">
                        <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center mb-3">
                            <span className="text-emerald-400 text-lg font-bold">3</span>
                        </div>
                        <h4 className="text-white font-medium mb-1">Paste & Save</h4>
                        <p className="text-gray-400 text-sm">
                            Paste it above, save, and activate. Users will see the stream immediately.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
