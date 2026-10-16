/**
 * "A quiz changed" signal, delivered over a private Supabase Realtime Broadcast channel.
 *
 * Why not `postgres_changes` (what the app used before)? Supabase checks Row Level Security for every
 * subscriber on every change and decodes the replication stream on a single thread, so 50,000 players
 * listening to the `Quiz` table make each admin edit very expensive for the database. With Broadcast the
 * database sends ONE small message per change and authorises each player once, when they join.
 *
 * Security: the channel is private and the policy on `realtime.messages` only lets signed-in users
 * RECEIVE. Nobody can publish from a browser, so a visitor cannot fake a signal to make every player
 * refetch at once. Only database writes (a trigger on "Quiz") produce messages. The message carries no
 * answers or questions, only fields the player's quiz list already shows.
 */

export const QUIZ_SIGNAL_TOPIC = 'quizzes';
export const QUIZ_SIGNAL_EVENT = 'quiz_changed';

export type QuizSignalOp = 'INSERT' | 'UPDATE' | 'DELETE';

export interface QuizSignal {
  op: QuizSignalOp;
  id: string;
  title: string;
  status: string;
  pushedAt: string | null;
}

/** Statuses the quiz list shows to players (same set the server catalogue loads). */
const LIST_STATUSES = new Set(['active', 'upcoming', 'paused']);

/**
 * Validate what arrived over the wire. Accepts the whole broadcast message (`{ payload }`) or just the
 * payload. Returns null for anything malformed, so a bad message can never crash the page.
 */
export function parseQuizSignal(message: unknown): QuizSignal | null {
  if (!message || typeof message !== 'object') return null;
  const maybeWrapped = message as { payload?: unknown };
  const raw = (maybeWrapped.payload && typeof maybeWrapped.payload === 'object' ? maybeWrapped.payload : message) as Record<string, unknown>;
  const { op, id, title, status, pushedAt } = raw;
  if (op !== 'INSERT' && op !== 'UPDATE' && op !== 'DELETE') return null;
  if (typeof id !== 'string' || id.length === 0) return null;
  return {
    op,
    id,
    title: typeof title === 'string' ? title : '',
    status: typeof status === 'string' ? status : '',
    pushedAt: typeof pushedAt === 'string' ? pushedAt : null,
  };
}

export interface SignalListItem {
  id: string;
  title: string;
  status: string;
  pushedAt?: string | null;
}

/**
 * Apply a signal to the quiz list the page already holds.
 *
 * The expensive case is the moment a quiz goes live: every player already has it in their list (as
 * "upcoming"), so patching status and pushedAt locally means NO request to the server, instead of
 * tens of thousands of players refetching at once. Only a quiz the player does not have yet needs a
 * fetch (`needsFetch`), and the page spreads that over a random delay.
 */
export function applyQuizSignal<T extends SignalListItem>(list: T[], signal: QuizSignal): { list: T[]; needsFetch: boolean } {
  const known = list.some((q) => q.id === signal.id);

  if (signal.op === 'DELETE' || (signal.status !== '' && !LIST_STATUSES.has(signal.status))) {
    return { list: known ? list.filter((q) => q.id !== signal.id) : list, needsFetch: false };
  }
  if (!known) return { list, needsFetch: true };

  return {
    list: list.map((q) =>
      q.id === signal.id
        ? { ...q, title: signal.title || q.title, status: (signal.status || q.status) as T['status'], pushedAt: signal.pushedAt }
        : q,
    ),
    needsFetch: false,
  };
}
