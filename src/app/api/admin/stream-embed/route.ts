export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getAdminDb } from '@/lib/supabase/db';
import sanitizeHtml from 'sanitize-html';

/**
 * Admin Stream Embed API
 *
 * This API now uses DATABASE-ONLY storage via Supabase RPC functions.
 * No file-based fallback - all data is stored in the StreamEmbed table.
 */

// Shared service-role client (a fresh createClient() per call leaks an auth timer each time)
function getSupabaseAdmin() {
  return getAdminDb();
}

// GET /api/admin/stream-embed - Get current livestream embed code
// Admin only: the response includes `updatedBy` (an admin's email). The public viewer reads the
// stream through /api/streaming/active instead.
export async function GET(_req: NextRequest) {
  try {
    const authResult = await requireAuth({ adminOnly: true, context: '/api/admin/stream-embed' });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc('get_live_stream_config');

    if (error) {
      console.error('RPC error fetching stream config:', error);
      return NextResponse.json({
        success: false,
        embedHtml: '',
        error: error.message
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      embedHtml: data?.embedHtml || '',
      embedUrl: data?.embedUrl || null,
      title: data?.title || 'Livestream',
      platform: data?.platform || 'custom',
      isActive: data?.isActive ?? false,
      updatedAt: data?.updatedAt,
      updatedBy: data?.updatedBy,
    });

  } catch (error) {
    console.error('Error reading stream config:', error);
    return NextResponse.json({
      success: false,
      embedHtml: '',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
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
    const embedUrl = body?.embedUrl || null;
    const title = body?.title || 'Livestream';
    const platform = body?.platform || 'custom';
    const isActive = body?.isActive ?? true;

    // Validation
    if (!embedHtmlRaw && !embedUrl) {
      return NextResponse.json({
        success: false,
        error: 'Either embedHtml or embedUrl is required'
      }, { status: 400 });
    }

    if (embedHtmlRaw && embedHtmlRaw.length < 10) {
      return NextResponse.json({
        success: false,
        error: 'Embed HTML is required (minimum 10 characters)'
      }, { status: 400 });
    }

    // Robust sanitization with sanitize-html
    const embedHtml = sanitizeHtml(embedHtmlRaw.trim(), {
      allowedTags: ['iframe', 'div', 'span', 'p', 'a', 'br', 'strong', 'em', 'u'],
      allowedAttributes: {
        'iframe': ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen', 'scrolling', 'title'],
        'div': ['class', 'id', 'style'],
        'span': ['class', 'style'],
        'a': ['href', 'target', 'rel']
      },
      allowedIframeHostnames: ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com', 'player.twitch.tv', 'player.cloudinary.com'],
      allowIframeRelativeUrls: false
    });

    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.rpc('update_live_stream_config', {
      p_embed_html: embedHtml || null,
      p_embed_url: embedUrl,
      p_title: title,
      p_platform: platform,
      p_is_active: isActive,
      p_admin_email: authResult.user?.email || 'admin'
    });

    if (error) {
      console.error('RPC error saving stream config:', error);
      return NextResponse.json({
        success: false,
        error: error.message
      }, { status: 500 });
    }

    if (!data?.success) {
      return NextResponse.json({
        success: false,
        error: data?.error || 'Failed to save stream configuration'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      embedHtml: data.embedHtml,
      embedUrl: data.embedUrl,
      title: data.title,
      platform: data.platform,
      isActive: data.isActive,
      updatedAt: data.updatedAt,
      updatedBy: data.updatedBy,
    });

  } catch (error) {
    console.error('Error saving stream config:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save embed code'
    }, { status: 500 });
  }
}
