export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';

// File-based fallback path
const EMBED_RELATIVE_PATH = path.join('public', 'uploads', 'stream-embed.html');

// Create Supabase admin client for RPC calls
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn('Supabase credentials not configured, using file fallback');
    return null;
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

// File-based fallback functions
async function ensureUploadsDir() {
  const dirPath = path.join(process.cwd(), 'public', 'uploads');
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

async function readEmbedFile(): Promise<string | null> {
  const filePath = path.join(process.cwd(), EMBED_RELATIVE_PATH);
  try {
    const buf = await fs.readFile(filePath);
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

async function writeEmbedFile(html: string): Promise<void> {
  await ensureUploadsDir();
  const filePath = path.join(process.cwd(), EMBED_RELATIVE_PATH);
  await fs.writeFile(filePath, html, 'utf8');
}

// GET /api/admin/stream-embed - Get current livestream embed code
export async function GET(_req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();

    // Try Supabase RPC first
    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('get_stream_embed');

        if (!error && data?.success) {
          return NextResponse.json({
            embedHtml: data.embedHtml || ''
          });
        }

        if (error) {
          console.warn('Supabase RPC error, falling back to file:', error.message);
        }
      } catch (rpcError) {
        console.warn('Supabase RPC failed, falling back to file:', rpcError);
      }
    }

    // Fallback to file-based storage
    const embedHtml = await readEmbedFile();
    return NextResponse.json({
      embedHtml: embedHtml || ''
    });

  } catch (error) {
    console.error('Error reading embed code:', error);
    return NextResponse.json({
      embedHtml: ''
    });
  }
}

// POST /api/admin/stream-embed - Save livestream embed code
export async function POST(req: NextRequest) {
  try {
    // Validate admin session
    const authResult = await requireAuth({ adminOnly: true, context: '/api/admin/stream-embed' });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = await req.json();
    const embedHtmlRaw = (body?.embedHtml ?? '').toString();

    if (!embedHtmlRaw || embedHtmlRaw.length < 10) {
      return NextResponse.json({ error: 'Embed HTML is required (minimum 10 characters)' }, { status: 400 });
    }

    // Light sanitization: strip script tags
    const embedHtml = embedHtmlRaw
      .trim()
      .replace(/<script[^>]*>.*?<\/script>/gis, '');

    const supabase = getSupabaseAdmin();
    let savedToSupabase = false;

    // Try Supabase RPC first
    if (supabase) {
      try {
        const { data, error } = await supabase.rpc('update_stream_embed', {
          p_embed_html: embedHtml,
          p_admin_email: authResult.user?.email || 'admin'
        });

        if (!error && data?.success) {
          savedToSupabase = true;
        } else if (error) {
          console.warn('Supabase RPC save failed, will use file fallback:', error.message);
        }
      } catch (rpcError) {
        console.warn('Supabase RPC failed, using file fallback:', rpcError);
      }
    }

    // Always save to file as backup/fallback
    await writeEmbedFile(embedHtml);

    return NextResponse.json({
      success: true,
      savedToSupabase
    });

  } catch (error) {
    console.error('Error saving embed code:', error);
    return NextResponse.json({
      error: 'Failed to save embed code',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
