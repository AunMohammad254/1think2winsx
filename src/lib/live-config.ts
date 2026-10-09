/**
 * Feature flags for the live-update path. Both are inlined at build time (NEXT_PUBLIC_*).
 *
 * NEXT_PUBLIC_LIVE_BROADCAST=1  Use the private Broadcast channel (see lib/quiz-signal) for quiz changes
 *                               and poll the notification count instead of holding a per-user
 *                               `postgres_changes` subscription. Off by default: the database migration
 *                               `20261009120000_live_broadcast.sql` must be applied first, otherwise the
 *                               channel is refused and players fall back to the periodic poll.
 */
export const LIVE_BROADCAST_ENABLED = process.env.NEXT_PUBLIC_LIVE_BROADCAST === '1';
