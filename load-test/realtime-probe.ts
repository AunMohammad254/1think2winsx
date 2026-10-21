/**
 * Realtime probe: opens N real Supabase Realtime connections as a signed-in player, subscribes each to the
 * private `quizzes` Broadcast channel, and reports how a "Quiz changed" signal fans out.
 *
 * It also checks the security model:
 *   - an anonymous client (no sign-in) must NOT be able to join the private channel;
 *   - a signed-in client must NOT be able to publish (a forged signal must reach nobody).
 *
 * STAGING ONLY (refuses the production project). Needs the staging project's public anon/publishable key and a
 * staging test user. Typical run, with the migration 20261009120000_live_broadcast.sql applied:
 *
 *   PROBE_SUPABASE_URL=https://<staging-ref>.supabase.co PROBE_ANON_KEY=<staging anon key> \
 *   PROBE_EMAIL=... PROBE_PASSWORD=... PROBE_CLIENTS=100 PROBE_EXPECT_EVENTS=3 \
 *   bun load-test/realtime-probe.ts
 *
 * When it prints READY, change a row in "Quiz" (insert / update / delete). It prints a JSON summary when it has
 * seen PROBE_EXPECT_EVENTS signals on every client, or after PROBE_TIMEOUT_S seconds.
 *
 * Note: latency = receive time on THIS machine minus the database's send time, so it includes any clock
 * difference between the two (usually tens of ms with NTP).
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

// The live site's project (Mumbai since 2026-10-21) and the deleted Tokyo one, in case an old .env still names it
const PRODUCTION_REFS = ['eclivawqhdovsndlngfo', 'snhgaklxawthpihjiagh'];
const url = process.env.PROBE_SUPABASE_URL ?? '';
const anonKey = process.env.PROBE_ANON_KEY ?? '';
const email = process.env.PROBE_EMAIL ?? '';
const password = process.env.PROBE_PASSWORD ?? '';
const clientCount = Number(process.env.PROBE_CLIENTS ?? 50);
const expectEvents = Number(process.env.PROBE_EXPECT_EVENTS ?? 3);
const timeoutS = Number(process.env.PROBE_TIMEOUT_S ?? 120);
// PROBE_PRIVATE=0 joins a PUBLIC topic (no authorisation query on join) to measure what the private-channel check costs.
const usePrivate = (process.env.PROBE_PRIVATE ?? "1") !== "0";
const topic = usePrivate ? "quizzes" : "quizzes-public-probe";
// PROBE_MODE=pg joins the app's CURRENT mechanism instead: postgres_changes on the Quiz table (authorised per subscriber).
const legacyPgChanges = process.env.PROBE_MODE === "pg";
// How fast to open connections: PROBE_BATCH clients, then PROBE_BATCH_DELAY_MS pause.
const batch = Number(process.env.PROBE_BATCH ?? 10);
const batchDelayMs = Number(process.env.PROBE_BATCH_DELAY_MS ?? 400);

if (!url || !anonKey || !email || !password) {
  console.error('Set PROBE_SUPABASE_URL, PROBE_ANON_KEY, PROBE_EMAIL and PROBE_PASSWORD.');
  process.exit(1);
}
if (PRODUCTION_REFS.some((ref) => url.includes(ref))) {
  console.error('Refusing to run against the PRODUCTION project. Use the staging project.');
  process.exit(1);
}

interface Seen { recvAt: number; payload: { op?: string; id?: string; at?: number } }

const newClient = (): SupabaseClient =>
  createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

function subscribe(client: SupabaseClient, onEvent?: (s: Seen) => void): Promise<{ channel: RealtimeChannel; status: string }> {
  return new Promise((resolve) => {
    const base = client.channel(legacyPgChanges ? "legacy-quiz-changes" : topic, { config: { private: usePrivate && !legacyPgChanges } });
    const channel = (legacyPgChanges
      ? base.on("postgres_changes", { event: "*", schema: "public", table: "Quiz" }, () => onEvent?.({ recvAt: Date.now(), payload: {} }))
      : base.on("broadcast", { event: "quiz_changed" }, (m) => onEvent?.({ recvAt: Date.now(), payload: m.payload })))
      .subscribe((status) => {
        if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) resolve({ channel, status });
      });
    setTimeout(() => resolve({ channel, status: 'NO_ANSWER' }), 20_000);
  });
}

async function main() {
  const base = newClient();
  const { data, error } = await base.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error('Sign-in failed:', error?.message);
    process.exit(1);
  }
  const token = data.session.access_token;

  // 1. Open N authenticated connections, ramped so the join rate stays polite
  const clients: SupabaseClient[] = [];
  const channels: RealtimeChannel[] = [];
  const events: Seen[][] = [];
  const statuses: Record<string, number> = {};
  const t0 = Date.now();
  for (let i = 0; i < clientCount; i++) {
    const c = newClient();
    await c.realtime.setAuth(token);
    const bucket: Seen[] = [];
    events.push(bucket);
    clients.push(c);
    subscribe(c, (s) => bucket.push(s)).then(({ channel, status }) => {
      channels.push(channel);
      statuses[status] = (statuses[status] ?? 0) + 1;
    });
    if (i % batch === batch - 1) await sleep(batchDelayMs);
  }
  while (Object.values(statuses).reduce((a, b) => a + b, 0) < clientCount && Date.now() - t0 < 60_000) await sleep(200);
  const connectSeconds = (Date.now() - t0) / 1000;

  // 2. Security checks
  const anon = newClient(); // never signs in
  const anonResult = usePrivate ? await subscribe(anon) : { channel: null, status: "skipped (public topic)" };
  const forgedId = `FORGED-${Date.now()}`;
  let forgedSendResult = 'not attempted';
  if (channels[0]) {
    try {
      forgedSendResult = String(await channels[0].send({ type: 'broadcast', event: 'quiz_changed', payload: { op: 'DELETE', id: forgedId, at: Date.now() } }));
    } catch (e) {
      forgedSendResult = `threw: ${(e as Error).message}`;
    }
  }
  await sleep(4_000);
  const forgedDelivered = events.filter((b) => b.some((s) => s.payload.id === forgedId)).length;

  console.log(`READY connected=${statuses['SUBSCRIBED'] ?? 0}/${clientCount} in ${connectSeconds.toFixed(1)}s. Now insert/update/delete a "Quiz" row.`);

  // 3. Wait for the expected signals on every client
  const deadline = Date.now() + timeoutS * 1000;
  const real = (b: Seen[]) => b.filter((s) => s.payload.id !== forgedId);
  while (Date.now() < deadline && events.some((b) => real(b).length < expectEvents)) await sleep(250);

  // 4. Summary
  const perEvent: Array<Record<string, unknown>> = [];
  for (let e = 0; e < expectEvents; e++) {
    const got = events.map((b) => real(b)[e]).filter(Boolean) as Seen[];
    const lat = got.map((s) => s.recvAt - (s.payload.at ?? s.recvAt)).sort((a, b) => a - b);
    perEvent.push({
      event: e + 1,
      op: got[0]?.payload.op,
      id: got[0]?.payload.id,
      deliveredTo: `${got.length}/${clientCount}`,
      latencyMs: lat.length ? { min: lat[0], p50: pct(lat, 0.5), p95: pct(lat, 0.95), max: lat[lat.length - 1] } : null,
    });
  }
  console.log(JSON.stringify({
    clients: clientCount,
    statuses,
    connectSeconds,
    anonymousClientStatus: anonResult.status,
    forgedSignal: { sendResult: forgedSendResult, deliveredToClients: forgedDelivered },
    perEvent,
  }, null, 2));

  for (const c of [...clients, anon, base]) await c.removeAllChannels();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
