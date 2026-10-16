import { NextResponse } from 'next/server';
import { securityLogger } from '@/lib/security-logger';
import { getAdminDb } from '@/lib/supabase/db';

/**
 * Public Streaming Active API
 *
 * Returns the active stream configuration for public consumption.
 * Uses DATABASE-ONLY storage - no file-based fallback.
 *
 * SCALE: this is polled by every player on /quizzes and /quiz/[id], and the answer is the same
 * for everybody. It therefore
 *   - reuses the shared admin client (the old code built a brand-new Supabase client on every
 *     cache miss; each one started a never-stopped auth timer, leaking memory),
 *   - loads with single-flight (all concurrent callers share ONE RPC) and
 *   - serves the last value while a refresh is in flight / the DB is slow (stale-while-revalidate),
 *     so a database blip doesn't make a live stream disappear for every viewer.
 */

type StreamConfigData = { embedHtml: string; isActive: boolean; title?: string } | null;

const CACHE_TTL_MS = 5_000; // short TTL so an admin start/stop shows up quickly
const STALE_MAX_MS = 60_000; // how long a stale value may be served while refreshing/failing

let cached: { value: StreamConfigData; at: number } | null = null;
let inflight: Promise<StreamConfigData> | null = null;

// Get stream config from database (throws on RPC failure so callers can fall back to stale)
async function fetchStreamConfig(): Promise<StreamConfigData> {
  const { data, error } = await getAdminDb().rpc('get_live_stream_config');
  if (error) throw error;

  if (!data?.success || !data.isActive) {
    return null;
  }

  // Return config if there's embed content
  if (data.embedHtml || data.embedUrl) {
    return {
      embedHtml: data.embedHtml || (data.embedUrl ? `<iframe src="${data.embedUrl}" allowfullscreen></iframe>` : ''),
      isActive: data.isActive,
      title: data.title,
    };
  }

  return null;
}

function refresh(): Promise<StreamConfigData> {
  if (!inflight) {
    inflight = fetchStreamConfig()
      .then((value) => {
        cached = { value, at: Date.now() };
        return value;
      })
      .catch((err) => {
        console.error('Error fetching stream config:', err);
        if (cached && Date.now() - cached.at < STALE_MAX_MS) return cached.value;
        // Nothing usable: remember "no stream" briefly so a failing DB isn't re-queried per request
        cached = { value: null, at: Date.now() };
        return null;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// Get cached stream config
async function getCachedStreamConfig(): Promise<StreamConfigData> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  const pending = refresh();
  // Stale-while-revalidate: answer instantly from the previous value, refresh in the background.
  if (cached && now - cached.at < STALE_MAX_MS) {
    return cached.value;
  }
  return pending;
}

// Identical for every viewer, so shared caches (CDN / host proxy) may hold it briefly.
const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=30' };

// GET - Get active stream for public consumption
export async function GET() {
  try {
    const start = Date.now();
    const config = await getCachedStreamConfig();

    securityLogger.logPerformanceMetric('streaming_active', Date.now() - start, '/api/streaming/active');

    if (config && config.embedHtml) {
      return NextResponse.json({
        hasActiveStream: true,
        stream: {
          id: 'admin-embed',
          name: config.title || 'Livestream',
          quality: 'auto',
          autoReconnect: false,
          maxReconnectAttempts: 0,
          reconnectDelay: 3000,
          facebookLiveVideo: {
            id: 'admin-embed',
            title: config.title || 'Livestream',
            description: 'Admin-provided livestream embed',
            embedHtml: config.embedHtml,
            streamUrl: '',
            creationTime: new Date().toISOString(),
          },
          session: null,
        },
      }, {
        headers: CACHE_HEADERS
      });
    }

    return NextResponse.json(
      { hasActiveStream: false, stream: null },
      { headers: CACHE_HEADERS }
    );
  } catch (error) {
    console.error('Error fetching active stream:', error);
    return NextResponse.json(
      { error: 'Failed to fetch active stream' },
      { status: 500 }
    );
  }
}
