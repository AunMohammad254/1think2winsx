import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { securityLogger } from '@/lib/security-logger';
import { createClient } from '@supabase/supabase-js';

let cachedHtml: string | null = null;
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

// Try to get embed HTML from Supabase RPC
async function getEmbedFromSupabase(): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return null;

    const { data, error } = await supabase.rpc('get_stream_embed');
    if (!error && data?.success && data.embedHtml) {
      return data.embedHtml;
    }
    if (error) {
      console.warn('Supabase RPC error, will try file fallback:', error.message);
    }
    return null;
  } catch (err) {
    console.warn('Supabase RPC failed:', err);
    return null;
  }
}

async function readAdminEmbedHtml(): Promise<string | null> {
  try {
    const filePath = path.join(process.cwd(), 'public', 'uploads', 'stream-embed.html');
    const buf = await fs.readFile(filePath);
    const html = buf.toString('utf8').trim();
    return html.length > 0 ? html : null;
  } catch (_) {
    return null;
  }
}

async function getCachedEmbedHtml(): Promise<string | null> {
  const now = Date.now();
  if (cachedHtml && now - cachedAt < CACHE_TTL_MS) {
    return cachedHtml;
  }

  // Try Supabase first, then fall back to file
  let html = await getEmbedFromSupabase();
  if (!html) {
    html = await readAdminEmbedHtml();
  }

  cachedHtml = html;
  cachedAt = now;
  return html;
}

// GET - Get active stream for public consumption
export async function GET() {
  try {
    const start = Date.now();
    const embedHtml = await getCachedEmbedHtml();
    if (embedHtml) {
      securityLogger.logPerformanceMetric('streaming_active', Date.now() - start, '/api/streaming/active');
      return NextResponse.json({
        hasActiveStream: true,
        stream: {
          id: 'admin-embed',
          name: 'Livestream',
          quality: 'auto',
          autoReconnect: false,
          maxReconnectAttempts: 0,
          reconnectDelay: 3000,
          facebookLiveVideo: {
            id: 'admin-embed',
            title: 'Livestream',
            description: 'Admin-provided livestream embed',
            embedHtml: embedHtml,
            streamUrl: '',
            creationTime: new Date().toISOString(),
          },
          session: null,
        },
      }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    }
    securityLogger.logPerformanceMetric('streaming_active', Date.now() - start, '/api/streaming/active');
    return NextResponse.json({ hasActiveStream: false, stream: null }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('Error fetching active stream:', error);
    return NextResponse.json(
      { error: 'Failed to fetch active stream' },
      { status: 500 }
    );
  }
}
