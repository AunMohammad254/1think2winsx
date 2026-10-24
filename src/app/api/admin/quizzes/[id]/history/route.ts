import { NextRequest, NextResponse } from 'next/server';
import { adminApiGuard } from '@/lib/admin-api-guard';
import { createSecureJsonResponse } from '@/lib/security-headers';
import { listQuizActions } from '@/lib/admin-action-log';

/** GET /api/admin/quizzes/[id]/history - who did what to the quiz, newest first (the History tab). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await adminApiGuard(request, '/api/admin/quizzes/[id]/history', { write: false });
  if (admin instanceof Response) return admin;
  try {
    return createSecureJsonResponse({ actions: await listQuizActions(id) }, { status: 200 });
  } catch (error) {
    console.error('[admin-action-log] Reading the history failed:', error);
    return NextResponse.json({ error: 'Failed to load the history' }, { status: 500 });
  }
}
