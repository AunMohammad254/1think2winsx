import { NextRequest, NextResponse } from 'next/server';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { adminTimeline } from '@/lib/claim-tracking';

/** GET /api/admin/claims/[id]/timeline - what happened to a claim, oldest first (the Claims screen's details). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await adminApiGuard(request, '/api/admin/claims/[id]/timeline', { write: false });
  if (admin instanceof Response) return admin;
  try {
    return createSecureJsonResponse({ events: await adminTimeline(id) }, { status: 200 });
  } catch (error) {
    console.error('[claims] Reading the timeline failed:', error);
    return NextResponse.json({ error: 'Failed to load the timeline' }, { status: 500 });
  }
}
