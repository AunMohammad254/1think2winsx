'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import LazyStreamPlayer from '@/components/LazyStreamPlayer';

export default function StreamingManager() {
  const [embedHtml, setEmbedHtml] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState<number>(0);

  useEffect(() => {
    const fetchEmbed = async () => {
      try {
        const resp = await fetch('/api/admin/stream-embed');
        const data = await resp.json();
        setEmbedHtml((data?.embedHtml ?? '').toString());
      } catch (_e) {
        setError('Failed to load embed code');
      } finally {
        setLoading(false);
      }
    };
    fetchEmbed();
  }, []);

  const saveEmbedHtml = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      if (!embedHtml || embedHtml.trim().length < 10) {
        throw new Error('Please paste a valid livestream embed HTML snippet.');
      }
      const resp = await fetch('/api/admin/stream-embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedHtml }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data?.error || 'Failed to save embed code');
      }
      setSuccess('Embed code saved. Preview refreshed.');
      setRefreshKey((k) => k + 1);
    } catch (_e) {
      setError(_e instanceof Error ? _e.message : 'Failed to save embed code');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="glass-card glass-transition glass-hover rounded-lg">
        <div className="px-6 py-4 border-b border-blue-400">
          <h3 className="text-lg font-medium text-white">Livestream Embed Manager</h3>
          <p className="text-sm text-gray-200 mt-1">Paste the embed HTML from your streaming provider. Facebook tokens and Page IDs are no longer used.</p>
        </div>
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-400 rounded text-red-200 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 p-3 bg-green-500/20 border border-green-400 rounded text-green-200 text-sm">
              {success}
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-300">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
            </div>
          ) : (
            <>
              <textarea
                value={embedHtml}
                onChange={(e) => setEmbedHtml(e.target.value)}
                placeholder="Paste your livestream embed HTML here (e.g., <iframe ...></iframe>)"
                className="w-full h-40 bg-gray-900 text-gray-100 border border-gray-700 rounded-md p-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="flex items-center justify-end mt-3">
                <button
                  onClick={saveEmbedHtml}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-md transition-colors flex items-center space-x-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}<span>Save Embed Code</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="glass-card glass-transition glass-hover rounded-lg">
        <div className="px-6 py-4 border-b border-blue-400">
          <h3 className="text-lg font-medium text-white">Live Preview</h3>
          <p className="text-sm text-gray-200 mt-1">Preview how the stream looks for users across devices.</p>
        </div>
        <div className="p-6">
          <div className="aspect-video">
            <LazyStreamPlayer key={refreshKey} />
          </div>
        </div>
      </div>
    </div>
  );
}
