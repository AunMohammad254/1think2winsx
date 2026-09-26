import { getAdminDb } from '@/lib/supabase/db';

/**
 * Shared (not per-user) quiz catalogue: active quizzes, their active questions
 * (WITHOUT the answer key) and total attempt counts.
 *
 * Every user sees the same catalogue, so it is cached once per server process for
 * a few seconds with single-flight loading: when 5,000 players open /quizzes at the
 * same moment (e.g. after a push notification or a realtime "quiz published" event)
 * the database is queried once, not 5,000 times.
 */

export interface CatalogQuestion { id: string; text: string; options: string[] }
export interface CatalogQuiz {
  id: string;
  title: string;
  description: string;
  duration: number;
  passingScore: number;
  status: string;
  accessPrice: number;
  quizType: string;
  isBumperPrize: boolean;
  startsAt: string | null;
  createdAt: string;
  updatedAt: string;
  questions: CatalogQuestion[];
  totalAttempts: number;
}

const TTL_MS = 15_000;
let cache: { at: number; data: CatalogQuiz[] } | null = null;
let inflight: Promise<CatalogQuiz[]> | null = null;

function parseOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  try { return JSON.parse(String(raw)); } catch { return []; }
}

async function load(): Promise<CatalogQuiz[]> {
  const db = getAdminDb();
  const { data: quizzes, error } = await db
    .from('Quiz')
    .select('id, title, description, duration, passingScore, status, accessPrice, quizType, isBumperPrize, startsAt, createdAt, updatedAt')
    .eq('status', 'active')
    .order('createdAt', { ascending: false });
  if (error) throw error;
  const ids = (quizzes || []).map((q: { id: string }) => q.id);
  if (ids.length === 0) return [];

  const [questionsRes, countsRes] = await Promise.all([
    db.from('Question')
      .select('id, quizId, text, options, createdAt')
      .in('quizId', ids)
      .eq('status', 'active')
      .order('createdAt', { ascending: true }),
    // Aggregated in SQL: the old code downloaded one row per attempt (capped at
    // 1,000 by PostgREST, and filtered by RLS to the caller's own attempts, so the
    // "total attempts" figure was wrong for everyone).
    db.rpc('get_quiz_attempt_counts_by_quiz', { quiz_ids: ids }),
  ]);
  if (questionsRes.error) throw questionsRes.error;

  const byQuiz = new Map<string, CatalogQuestion[]>();
  for (const q of questionsRes.data || []) {
    const list = byQuiz.get(q.quizId) || [];
    list.push({ id: q.id, text: q.text, options: parseOptions(q.options) });
    byQuiz.set(q.quizId, list);
  }
  const counts = new Map<string, number>();
  if (!countsRes.error) {
    for (const row of (countsRes.data || []) as Array<{ quizId: string; count: number }>) {
      counts.set(row.quizId, Number(row.count) || 0);
    }
  }

  return (quizzes || []).map((q: Omit<CatalogQuiz, 'questions' | 'totalAttempts'>) => ({
    ...q,
    description: q.description || '',
    questions: byQuiz.get(q.id) || [],
    totalAttempts: counts.get(q.id) || 0,
  }));
}

export async function getActiveQuizCatalog(): Promise<CatalogQuiz[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!inflight) {
    inflight = load()
      .then((data) => { cache = { at: Date.now(), data }; return data; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export async function getCatalogQuiz(quizId: string): Promise<CatalogQuiz | undefined> {
  return (await getActiveQuizCatalog()).find((q) => q.id === quizId);
}

/** Call after admins create/update/publish/delete quizzes or questions. */
export function invalidateQuizCatalog() {
  cache = null;
}
