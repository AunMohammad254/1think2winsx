import { getAdminDb } from '@/lib/supabase/db';
import type { LiveMode } from '@/lib/live-catalog';

/**
 * Live mode (see LiveMode in src/lib/live-catalog.ts): on for a big event, so 50,000 players' personal
 * requests stay under Hostinger's limit. /api/live switches it on for everyone at once.
 */

/** A quiz live or announced that admits more players than this is a big event. */
export const LIVE_MODE_MIN_ENTRIES = 5_000;
/** How often each player's personal requests run in live mode. */
export const LIVE_MODE: LiveMode = { personalPollS: 1_800 };

// AppSettings is read at most once a minute per process: /api/live answers every few seconds
const EVENT_MODE_TTL_MS = 60_000;
let cached: { at: number; on: boolean } | null = null;
let inflight: Promise<boolean> | null = null;

async function readEventMode(): Promise<boolean> {
  try {
    const { data, error } = await getAdminDb().from('AppSettings').select('value').eq('key', 'event_mode').maybeSingle();
    if (error) throw error;
    cached = { at: Date.now(), on: data?.value === 'true' };
  } catch (err) {
    // Keep the last value it had (off if it was never read), and try again in a minute
    console.error('[LiveMode] Reading event_mode failed:', err);
    cached = { at: Date.now(), on: cached?.on ?? false };
  }
  return cached.on;
}

/** AppSettings `event_mode` = 'true': an admin switched live mode on whatever the entry limits say. */
export async function isEventMode(): Promise<boolean> {
  if (cached && Date.now() - cached.at < EVENT_MODE_TTL_MS) return cached.on;
  inflight ??= readEventMode().finally(() => { inflight = null; });
  return inflight;
}

export function __resetEventModeForTests(): void {
  cached = null;
  inflight = null;
}

/**
 * Live mode, from the highest entry limit of a quiz live or announced (getMaxOpenEntryLimit, which never
 * leaves the server) and AppSettings `event_mode`.
 */
export function liveModeFor(maxOpenEntries: number, eventMode: boolean): LiveMode | undefined {
  return maxOpenEntries > LIVE_MODE_MIN_ENTRIES || eventMode ? LIVE_MODE : undefined;
}
