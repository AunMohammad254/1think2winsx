/**
 * First come, first served: each quiz admits its first `maxEntries` players. The limit and the
 * quiz's points pool live in the admin-only "QuizAdminSettings" table and are never sent to players;
 * submit_quiz_attempt enforces the limit (code `entries_closed`). Players only ever learn that entries
 * have closed, never the number.
 */
export const DEFAULT_MAX_ENTRIES = 2000;
export const MAX_ENTRIES_LIMIT = 100_000;
export const MAX_POINTS_POOL = 10_000_000;

/** What a player sees when they lock in after a quiz is full. */
export const ENTRIES_CLOSED_MESSAGE = 'Entries for this quiz have closed.';
