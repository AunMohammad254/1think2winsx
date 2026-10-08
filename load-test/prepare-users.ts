/**
 * Prepare test users and signed-in sessions for the load test.
 *
 *   bun load-test/prepare-users.ts seed     --count 5000
 *   bun load-test/prepare-users.ts sessions --concurrency 5
 *
 * STAGING ONLY. This creates real auth users with the service-role key. It never reads your
 * app's .env: it takes its own LOADTEST_* variables and refuses to run against production.
 *
 *   LOADTEST_SUPABASE_URL        staging project URL
 *   LOADTEST_SERVICE_ROLE_KEY    staging service-role key   (seed)
 *   LOADTEST_ANON_KEY            staging anon/publishable key (sessions)
 *   LOADTEST_CONFIRM_STAGING=yes explicit acknowledgement
 *
 * Output (git-ignored): load-test/.data/users.json, sessions.json
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSessionCookieHeader, projectRefFromUrl, type SessionLike } from './lib/session-cookie';

// Project refs that must never be used as a load-test target (the live site).
const PRODUCTION_PROJECT_REFS = ['snhgaklxawthpihjiagh'];

const DATA_DIR = path.join(__dirname, '.data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

interface TestUser { id: string; email: string; password: string }
interface TestSession { userId: string; email: string; cookie: string }

function fail(message: string): never {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

/**
 * Auth headers for a Supabase key. Legacy keys are JWTs ("eyJ...") and may also go in Authorization.
 * The newer sb_publishable_... / sb_secret_... keys are NOT JWTs and belong in the `apikey` header
 * only (the gateway adds the right Authorization itself); sending them as a Bearer token is wrong.
 */
function keyHeaders(key: string): Record<string, string> {
  return key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };
}

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function config() {
  const url = process.env.LOADTEST_SUPABASE_URL?.replace(/\/$/, '');
  if (!url) fail('LOADTEST_SUPABASE_URL is not set (point it at a STAGING Supabase project).');
  if (process.env.LOADTEST_CONFIRM_STAGING !== 'yes') {
    fail('Set LOADTEST_CONFIRM_STAGING=yes to confirm this is a staging project, not production.');
  }
  const ref = projectRefFromUrl(url);
  const appUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; // Bun auto-loads .env; use it only as a guard
  if (PRODUCTION_PROJECT_REFS.includes(ref) || (appUrl && projectRefFromUrl(appUrl) === ref)) {
    fail(`Refusing to run: "${ref}" is the production project. Use a separate staging project or a Supabase branch.`);
  }
  return { url, ref };
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i], i);
      }
    })
  );
}

async function seed() {
  const { url } = config();
  const serviceKey = process.env.LOADTEST_SERVICE_ROLE_KEY;
  if (!serviceKey) fail('LOADTEST_SERVICE_ROLE_KEY is not set.');

  const count = arg('count', 1000);
  const concurrency = arg('concurrency', 10);
  const runTag = randomBytes(3).toString('hex');
  // One generated password per run, kept only in the git-ignored data file
  const password = randomBytes(18).toString('base64url');

  const users: TestUser[] = [];
  const indexes = Array.from({ length: count }, (_, i) => i);
  let failed = 0;

  await pool(indexes, concurrency, async (i) => {
    const email = `loadtest+${runTag}-${i}@example.test`;
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...keyHeaders(serviceKey) },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: `Load Test ${i}` } }),
    });
    if (!res.ok) {
      failed++;
      if (failed <= 3) console.error(`create user ${i} failed: ${res.status} ${await res.text()}`);
      return;
    }
    const body = (await res.json()) as { id: string };
    users.push({ id: body.id, email, password });
    if (users.length % 500 === 0) console.log(`  created ${users.length}/${count}`);
  });

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify(users));
  console.log(`\n✔ ${users.length} users written to ${path.relative(process.cwd(), USERS_FILE)} (${failed} failed)`);
}

async function sessions() {
  const { url, ref } = config();
  const anonKey = process.env.LOADTEST_ANON_KEY;
  if (!anonKey) fail('LOADTEST_ANON_KEY is not set.');

  const users = JSON.parse(await readFile(USERS_FILE, 'utf8').catch(() => fail('Run the "seed" command first.'))) as TestUser[];
  const concurrency = arg('concurrency', 5);
  const out: TestSession[] = [];
  let failed = 0;

  // Sign-ins are rate limited per IP by Supabase Auth. For thousands of users raise the limits on the
  // STAGING project (Dashboard -> Authentication -> Rate Limits) for the duration of the seeding.
  await pool(users, concurrency, async (user) => {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey }, // works for legacy and sb_publishable_ keys
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    if (!res.ok) {
      failed++;
      if (failed <= 3) console.error(`sign-in ${user.email} failed: ${res.status} ${await res.text()}`);
      return;
    }
    const session = (await res.json()) as SessionLike;
    out.push({ userId: user.id, email: user.email, cookie: buildSessionCookieHeader(ref, session) });
    if (out.length % 500 === 0) console.log(`  signed in ${out.length}/${users.length}`);
  });

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SESSIONS_FILE, JSON.stringify(out));
  console.log(`\n✔ ${out.length} sessions written to ${path.relative(process.cwd(), SESSIONS_FILE)} (${failed} failed)`);
  console.log('  Access tokens expire after ~1 hour by default: re-run "sessions" before a long test.');
}

const command = process.argv[2];
if (command === 'seed') seed().catch((e) => fail(String(e)));
else if (command === 'sessions') sessions().catch((e) => fail(String(e)));
else fail('Usage: prepare-users.ts <seed|sessions> [--count N] [--concurrency N]');
