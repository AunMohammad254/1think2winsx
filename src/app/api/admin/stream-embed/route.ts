export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import fs from 'fs/promises';
import path from 'path';

const EMBED_RELATIVE_PATH = path.join('public', 'uploads', 'stream-embed.html');

async function ensureUploadsDir() {
  const dirPath = path.join(process.cwd(), 'public', 'uploads');
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (_) {
    // ignore
  }
}

async function readEmbedFile(): Promise<string | null> {
  const filePath = path.join(process.cwd(), EMBED_RELATIVE_PATH);
  try {
    const buf = await fs.readFile(filePath);
    return buf.toString('utf8');
  } catch (_) {
    return null;
  }
}

function basicStripScripts(html: string): string {
  return html.replace(/<script[^>]*>.*?<\/script>/gis, '');
}

// GET /api/admin/stream-embed - Get current admin-provided livestream embed code
export async function GET(_req: NextRequest) {
  try {
    const authResult = await requireAuth({ adminOnly: true, context: '/api/admin/stream-embed' });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const embedHtml = await readEmbedFile();
    return NextResponse.json({ embedHtml });
  } catch (error) {
    console.error('Error reading embed code:', error);
    return NextResponse.json({ error: 'Failed to read embed code', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

// POST /api/admin/stream-embed - Save livestream embed code provided by admin
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth({ adminOnly: true, context: '/api/admin/stream-embed' });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = await req.json();
    const embedHtmlRaw = (body?.embedHtml ?? '').toString();
    if (!embedHtmlRaw || embedHtmlRaw.length < 10) {
      return NextResponse.json({ error: 'Embed HTML is required' }, { status: 400 });
    }

    // Light sanitization: strip script tags; content loads inside an iframe for isolation
    const embedHtml = basicStripScripts(embedHtmlRaw.trim());

    await ensureUploadsDir();
    const filePath = path.join(process.cwd(), EMBED_RELATIVE_PATH);
    await fs.writeFile(filePath, embedHtml, 'utf8');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving embed code:', error);
    return NextResponse.json({ error: 'Failed to save embed code', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
