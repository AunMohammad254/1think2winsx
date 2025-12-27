'use client';

import { useState, useEffect } from 'react';
import {
  Video,
  Loader2,
  Save,
  RefreshCw,
  Monitor,
  Smartphone,
  Tablet,
  CheckCircle,
  AlertCircle,
  Code2,
  Eye,
  ExternalLink
} from 'lucide-react';
import { toast } from 'sonner';
import LazyStreamPlayer from '@/components/LazyStreamPlayer';

// ============================================
// Preview Modes
// ============================================
type PreviewMode = 'desktop' | 'tablet' | 'mobile';
type PreviewSource = 'draft' | 'saved';

const previewModes: { mode: PreviewMode; icon: typeof Monitor; label: string; width: string }[] = [
  { mode: 'desktop', icon: Monitor, label: 'Desktop', width: 'w-full' },
  { mode: 'tablet', icon: Tablet, label: 'Tablet', width: 'max-w-2xl' },
  { mode: 'mobile', icon: Smartphone, label: 'Mobile', width: 'max-w-sm' },
];

// ============================================
// Draft Preview Component - Renders current unsaved embed HTML
// ============================================
function DraftPreview({ embedHtml }: { embedHtml: string }) {
  // Build a sandboxed HTML document for the embed
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
// Main Component
// ============================================
export default function StreamingManager() {
  // State
  const [embedHtml, setEmbedHtml] = useState<string>('');
  const [originalEmbed, setOriginalEmbed] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');
  const [showPreview, setShowPreview] = useState<boolean>(true);
  const [previewSource, setPreviewSource] = useState<PreviewSource>('draft');

  // ============================================
  // Check if there are unsaved changes
  // ============================================
  const hasChanges = embedHtml !== originalEmbed;

  // ============================================
  // Data Fetching
  // ============================================
  useEffect(() => {
    const fetchEmbed = async () => {
      try {
        const resp = await fetch('/api/admin/stream-embed');
        const data = await resp.json();
        // Handle both success and error responses gracefully
        const html = (data?.embedHtml ?? '').toString();
        setEmbedHtml(html);
        setOriginalEmbed(html);

        if (!resp.ok && data?.error) {
          console.warn('Stream embed API warning:', data.error);
        }
      } catch (err) {
        console.error('Failed to fetch embed:', err);
        // Don't show toast for initial load failures - just start with empty
        setEmbedHtml('');
        setOriginalEmbed('');
      } finally {
        setLoading(false);
      }
    };
    fetchEmbed();
  }, []);

  // ============================================
  // Save Action
  // ============================================
  const saveEmbedHtml = async () => {
    // Validation
    if (!embedHtml || embedHtml.trim().length < 10) {
      toast.error('Please paste a valid embed HTML snippet (at least 10 characters)');
      return;
    }

    // Basic HTML validation
    if (!embedHtml.includes('<iframe') && !embedHtml.includes('<video') && !embedHtml.includes('<embed')) {
      toast.warning('The embed code should contain an iframe, video, or embed element', {
        description: 'This may not display correctly.',
      });
    }

    try {
      setSaving(true);

      const resp = await fetch('/api/admin/stream-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedHtml }),
      });

      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data?.error || 'Failed to save');
      }

      setOriginalEmbed(embedHtml);
      setRefreshKey((k) => k + 1);

      toast.success('Stream embed saved successfully!', {
        icon: <CheckCircle className="w-5 h-5 text-emerald-400" />,
        description: 'Preview has been refreshed.',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save embed code');
    } finally {
      setSaving(false);
    }
  };

  // ============================================
  // Render
  // ============================================
  return (
    <div className="space-y-6">
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

          {hasChanges && (
            <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-medium flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              Unsaved changes
            </span>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mr-3" />
              <span>Loading embed configuration...</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Editor */}
              <div className="relative">
                <textarea
                  value={embedHtml}
                  onChange={(e) => setEmbedHtml(e.target.value)}
                  placeholder='Paste your livestream embed HTML here, e.g.:&#10;<iframe src="https://..." allowfullscreen></iframe>'
                  className="w-full h-40 bg-gray-950/50 text-gray-100 border border-white/10 rounded-xl p-4 font-mono text-sm focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/25 resize-none"
                  spellCheck={false}
                />
                <div className="absolute bottom-3 right-3 text-xs text-gray-500">
                  {embedHtml.length} characters
                </div>
              </div>

              {/* Help Text */}
              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                <div className="flex gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
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
                  onClick={() => {
                    setEmbedHtml(originalEmbed);
                    toast.info('Changes discarded');
                  }}
                  disabled={!hasChanges}
                  className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Discard Changes
                </button>

                <button
                  onClick={saveEmbedHtml}
                  disabled={saving || !hasChanges}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-pink-500 text-white font-medium hover:from-red-600 hover:to-pink-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-red-500/20"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Embed Code
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
              <Video className="w-4 h-4" />
              {showPreview ? 'Hide' : 'Show'} Preview
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

            {/* Refresh */}
            <button
              onClick={() => {
                setRefreshKey(k => k + 1);
                toast.success('Preview refreshed');
              }}
              className="p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all"
              title="Refresh Preview"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Preview Content */}
        <div className="p-6">
          {showPreview ? (
            <div className={`mx-auto transition-all duration-300 ${previewModes.find(p => p.mode === previewMode)?.width
              }`}>
              {embedHtml ? (
                <div className="aspect-video rounded-xl overflow-hidden border border-white/10 bg-black">
                  {previewSource === 'draft' ? (
                    <DraftPreview embedHtml={embedHtml} key={`draft-${embedHtml.length}`} />
                  ) : (
                    <LazyStreamPlayer key={refreshKey} autoPlay={true} />
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
                <ExternalLink className="w-4 h-4" />
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
              Paste it above and save. Users will see the stream on the quiz pages.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
