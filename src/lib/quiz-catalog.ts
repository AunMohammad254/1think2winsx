import { getAdminDb } from '@/lib/supabase/db';
import { activateDueQuizzes, broadcastQuizLive } from '@/lib/quiz-scheduler';

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
  timeUpDuration: number;
  passingScore: number;
  status: string;
  accessPrice: number;
  quizType: string;
  isBumperPrize: boolean;
  startsAt: string | null;
  pushedAt: string | null;
  /** When players were last told this upcoming quiz is coming (it pops up on the stream). */
  announcedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The questions players can still answer: active, and without a saved result. */
  questions: CatalogQuestion[];
  /** Active questions whose result is saved: closed, so submit_quiz_attempt refuses answers to them. */
  closedQuestionCount: number;
  /** Every active question has its result (saved or settled): nothing is left to answer. */
  ended: boolean;
  totalAttempts: number;
  /** Name of the linked lucky-draw prize, for public listings such as the landing page. */
  prizeName: string | null;
}

/** What the quiz routes tell a player who opens a quiz whose results are already in. */
export const QUIZ_ENDED_MESSAGE = 'This quiz has ended: its results are already in.';

const TTL_MS = 15_000;
// After the TTL the previous catalogue keeps being served (and refreshed in the background) for up to
// this long; only beyond it, or before the first load, do callers wait for the database
const STALE_MAX_MS = 5 * 60_000;
// `nextDueAt`: start time of the next scheduled/upcoming quiz. The cache is dropped at
// that moment so a quiz going live is never held back by the TTL.
let cache: { at: number; data: CatalogQuiz[]; nextDueAt: number | null } | null = null;
let inflight: Promise<{ data: CatalogQuiz[]; nextDueAt: number | null }> | null = null;

function parseOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  try { return JSON.parse(String(raw)); } catch { return []; }
}

async function load(): Promise<{ data: CatalogQuiz[]; nextDueAt: number | null }> {
  // Go live any scheduled quiz whose time has come, so it appears in this very read
  // even when no external cron is running. The "live now" broadcast is slow on big
  // user bases, so it must not hold up the response.
  let nextDueAt: number | null = null;
  try {
    const due = await activateDueQuizzes();
    nextDueAt = due.nextDueAt;
    for (const quiz of due.activated) {
      broadcastQuizLive(quiz).catch((err) =>
        console.error(`[QuizCatalog] Failed to broadcast live quiz ${quiz.id}:`, err));
    }
  } catch (err) {
    console.error('[QuizCatalog] Failed to activate due quizzes:', err);
  }

  const data = await loadCatalog();
  return { data, nextDueAt };
}

async function loadCatalog(): Promise<CatalogQuiz[]> {
  const db = getAdminDb();
  // `*` rather than a column list: "announcedAt" comes from a migration that may not be applied yet
  // (db-tests/schema/06-20261019200000_quiz_announced_at.sql), and naming a missing column would
  // fail the whole read. The routes pick the fields they send, so other columns stay on the server.
  const { data: rawQuizzes, error } = await db
    .from('Quiz')
    .select('*')
    .in('status', ['active', 'upcoming', 'paused', 'scheduled'])
    .order('createdAt', { ascending: false });
  if (error) throw error;

  // Include upcoming, and scheduled quizzes once players were told about them (listed as upcoming:
  // the quiz routes refuse their questions until the scheduler makes them active). Include
  // active/paused only within their (duration + timeUpDuration) window from pushedAt
  const now = Date.now();
  const quizzes = (rawQuizzes || []).filter((q: any) => {
    if (q.status === 'scheduled') return !!q.announcedAt;
    if (q.status === 'upcoming') return true;
    // Never-pushed quizzes: active ones stay listed as before; paused ones were hidden
    // by an admin and must not reappear
    if (!q.pushedAt || !q.duration) return q.status === 'active';
    
    const timeUpMins = q.timeUpDuration ?? 60;
    const publishTime = new Date(q.pushedAt).getTime();
    const absoluteExpiryTime = publishTime + ((q.duration + timeUpMins) * 60 * 1000);
    
    return now <= absoluteExpiryTime;
  });

  const ids = quizzes.map((q: { id: string }) => q.id);
  if (ids.length === 0) return [];
  const prizeIds = [...new Set(quizzes.map((q: { prizeId?: string | null }) => q.prizeId).filter(Boolean))] as string[];

  const [questionsRes, countsRes, prizesRes] = await Promise.all([
    db.from('Question')
      .select('id, quizId, text, options, hasCorrectAnswer, createdAt')
      .in('quizId', ids)
      .eq('status', 'active')
      .order('createdAt', { ascending: true }),
    // Aggregated in SQL: the old code downloaded one row per attempt (capped at
    // 1,000 by PostgREST, and filtered by RLS to the caller's own attempts, so the
    // "total attempts" figure was wrong for everyone).
    db.rpc('get_quiz_attempt_counts_by_quiz', { quiz_ids: ids }),
    // Prize names for public listings; most quizzes have no prize, and then there is no query at all
    prizeIds.length > 0 ? db.from('Prize').select('id, name, category').in('id', prizeIds) : { data: [], error: null },
  ]);
  if (questionsRes.error) throw questionsRes.error;

  const byQuiz = new Map<string, CatalogQuestion[]>();
  const closedByQuiz = new Map<string, number>();
  for (const q of questionsRes.data || []) {
    // A question with a saved result is closed: offering it made "Lock in" fail with "Invalid or
    // closed question IDs in submission"
    if (q.hasCorrectAnswer) {
      closedByQuiz.set(q.quizId, (closedByQuiz.get(q.quizId) || 0) + 1);
      continue;
    }
    const list = byQuiz.get(q.quizId) || [];
    list.push({ id: q.id, text: q.text, options: parseOptions(q.options) });
    byQuiz.set(q.quizId, list);
  }
  const counts = new Map<string, number>();
  if (countsRes.error) {
    // Counts are cosmetic: keep serving the catalogue, but do not hide the failure
    console.error('[QuizCatalog] get_quiz_attempt_counts_by_quiz failed:', countsRes.error);
  } else {
    // The RPC returns `{ quiz_id, attempt_count }` (this used to read `quizId`/`count`,
    // so every quiz showed 0 attempts)
    for (const row of (countsRes.data || []) as Array<{ quiz_id: string; attempt_count: number | string }>) {
      counts.set(row.quiz_id, Number(row.attempt_count) || 0);
    }
  }

  const prizeNames = new Map<string, string>();
  const bumperPrizes = new Set<string>();
  if (prizesRes.error) {
    // Cosmetic too: listings then show the quiz without its prize's name
    console.error('[QuizCatalog] Prize names failed:', prizesRes.error);
  } else {
    for (const row of (prizesRes.data || []) as Array<{ id: string; name: string; category?: string }>) {
      // A bumper prize is a secret until it is won: public listings say "Bumper prize", never its name
      if (row.category === 'bumper') bumperPrizes.add(row.id);
      else prizeNames.set(row.id, row.name);
    }
  }

  type QuizRow = Omit<CatalogQuiz, 'questions' | 'closedQuestionCount' | 'ended' | 'totalAttempts' | 'prizeName'> & { prizeId?: string | null };
  return quizzes.flatMap((q: QuizRow): CatalogQuiz[] => {
    const questions = byQuiz.get(q.id) || [];
    const closedQuestionCount = closedByQuiz.get(q.id) || 0;
    // Saving the result (or settling) doesn't change the quiz's status, so an active quiz can be over.
    // Never pushed, it has no window that would ever drop it from the list, so it leaves now; pushed,
    // it shows as time-up (paused) until its window has passed.
    const ended = q.status === 'active' && questions.length === 0 && closedQuestionCount > 0;
    if (ended && !q.pushedAt) return [];
    return [{
      ...q,
      // Players only ever see "upcoming" before a quiz starts, whichever status the admin used
      status: ended ? 'paused' : q.status === 'scheduled' ? 'upcoming' : q.status,
      announcedAt: q.announcedAt ?? null,
      description: q.description || '',
      isBumperPrize: q.isBumperPrize || (!!q.prizeId && bumperPrizes.has(q.prizeId)),
      questions,
      closedQuestionCount,
      ended,
      totalAttempts: counts.get(q.id) || 0,
      prizeName: (q.prizeId && prizeNames.get(q.prizeId)) || null,
    }];
  });
}

function refresh(): Promise<{ data: CatalogQuiz[]; nextDueAt: number | null }> {
  if (!inflight) {
    inflight = load()
      .then((result) => { cache = { at: Date.now(), ...result }; return result; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export async function getActiveQuizCatalog(): Promise<CatalogQuiz[]> {
  const now = Date.now();
  if (cache && (cache.nextDueAt === null || now < cache.nextDueAt)) {
    if (now - cache.at < TTL_MS) return cache.data;
    // Stale: answer from it at once and refresh in the background. A refresh is several sequential
    // round trips to the database (Hostinger in Paris, Supabase in Tokyo), and every request that
    // arrived meanwhile used to wait for it: a 1-2 s stall every 15 s. A quiz whose start time has
    // come (`nextDueAt`) still waits, so it goes live on time.
    if (now - cache.at < STALE_MAX_MS) {
      if (!inflight) {
        refresh().catch((err) => console.error('[QuizCatalog] Background refresh failed, serving the previous catalogue:', err));
      }
      return cache.data;
    }
  }
  return (await refresh()).data;
}

export async function getCatalogQuiz(quizId: string): Promise<CatalogQuiz | undefined> {
  return (await getActiveQuizCatalog()).find((q) => q.id === quizId);
}

/** Call after admins create/update/publish/delete quizzes or questions. */
export function invalidateQuizCatalog() {
  cache = null;
}
