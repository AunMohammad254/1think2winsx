import { NextResponse } from 'next/server';
import { securityLogger } from '@/lib/security-logger';
import { createClient } from '@supabase/supabase-js';

/**
 * Public Streaming Active API
 * 
 * Returns the active stream configuration for public consumption.
 * Uses DATABASE-ONLY storage - no file-based fallback.
 */

let cachedConfig: { embedHtml: string; isActive: boolean; title?: string } | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5_000; // 5 seconds - short TTL for quick admin refresh

// Create Supabase admin client for RPC calls
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

// Get stream config from database
async function getStreamConfig(): Promise<{ embedHtml: string; isActive: boolean; title?: string } | null> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return null;

    const { data, error } = await supabase.rpc('get_live_stream_config');

    if (error) {
      console.error('RPC error fetching stream config:', error);
      return null;
    }

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
  } catch (err) {
    console.error('Error fetching stream config:', err);
    return null;
  }
}

// Get cached stream config
async function getCachedStreamConfig(): Promise<{ embedHtml: string; isActive: boolean; title?: string } | null> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL_MS) {
    return cachedConfig;
  }

  cachedConfig = await getStreamConfig();
  cachedAt = now;
  return cachedConfig;
}

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
        headers: { 'Cache-Control': 'no-store, max-age=0' }
      });
    }

    return NextResponse.json(
      { hasActiveStream: false, stream: null },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error fetching active stream:', error);
    return NextResponse.json(
      { error: 'Failed to fetch active stream' },
      { status: 500 }
    );
  }
}
