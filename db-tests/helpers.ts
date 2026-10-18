/**
 * Shared helpers for the database tests: connection, schema setup, acting as a PostgREST
 * role, and fixtures. See db-tests/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/** Server-level URL (the tests create and drop their own database on it). */
const DEFAULT_URL = 'postgres://postgres:postgres@127.0.0.1:54329/postgres';
export const TEST_DB_NAME = 't2w_db_tests';
const SCHEMA_DIR = path.join(__dirname, 'schema');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The tests TRUNCATE every table, so they must never reach a real database: only a loopback
 * host is accepted (a local Docker container, or the CI service container).
 */
export function serverUrl(): URL {
  const url = new URL(process.env.DB_TEST_URL || DEFAULT_URL);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`DB_TEST_URL must point at a local Postgres (localhost/127.0.0.1), got host "${url.hostname}"`);
  }
  return url;
}

export function testDbUrl(): string {
  const url = serverUrl();
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

/** Drop and recreate the test database, then apply the shim and the schema baseline in file order. */
export async function createTestDatabase(): Promise<void> {
  const server = new pg.Client({ connectionString: serverUrl().toString() });
  await server.connect();
  try {
    await server.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await server.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await server.end();
  }

  const db = new pg.Client({ connectionString: testDbUrl() });
  await db.connect();
  try {
    await db.query('SET client_min_messages = warning');
    for (const file of fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      try {
        await db.query(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8'));
      } catch (error) {
        throw new Error(`Applying db-tests/schema/${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await db.end();
  }
}

export function createPool(): pg.Pool {
  return new pg.Pool({ connectionString: testDbUrl(), max: 5 });
}

/** Empty every table between tests (as the superuser, so RLS does not apply). */
export async function resetData(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ t: string }>(
    `SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables WHERE schemaname IN ('public', 'auth')`,
  );
  await pool.query(`TRUNCATE ${rows.map((r) => r.t).join(', ')} CASCADE`);
}

// ─── Acting as a PostgREST role ──────────────────────────────────────────────

export type Caller =
  | { role: 'anon' }
  | { role: 'authenticated'; userId: string; email?: string }
  | { role: 'service_role' };

export const anon: Caller = { role: 'anon' };
export const serviceRole: Caller = { role: 'service_role' };
export const player = (userId: string, email?: string): Caller => ({ role: 'authenticated', userId, email });

/**
 * Run `fn` in one transaction the way PostgREST runs a request: switch to the caller's role
 * and expose the JWT claims that auth.uid() / auth.jwt() read. Commits on success.
 */
export async function as<T>(pool: pg.Pool, caller: Caller, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const claims =
    caller.role === 'authenticated'
      ? { sub: caller.userId, role: 'authenticated', email: caller.email }
      : { role: caller.role };
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`SELECT set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`, [
      caller.role,
      JSON.stringify(claims),
    ]);
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

/** Run one query as `caller` and return its rows. */
export async function queryAs<R extends pg.QueryResultRow = any>(
  pool: pg.Pool,
  caller: Caller,
  sql: string,
  params: unknown[] = [],
): Promise<R[]> {
  return as(pool, caller, async (db) => (await db.query<R>(sql, params)).rows);
}

/** Run one statement as `caller` and resolve to the Postgres error it raised (fails if none). */
export async function errorAs(pool: pg.Pool, caller: Caller, sql: string, params: unknown[] = []): Promise<pg.DatabaseError> {
  try {
    await queryAs(pool, caller, sql, params);
  } catch (error) {
    if (error instanceof pg.DatabaseError) return error;
    throw error;
  }
  throw new Error(`Expected an error from: ${sql}`);
}

// ─── RPCs ───────────────────────────────────────────────────────────────────

export type SubmitAnswer = { questionId: string; selectedOption: number };
export type SubmitResult = {
  success: boolean;
  code?: string;
  error?: string;
  attemptId?: string;
  answersSubmitted?: number;
  isReattempt?: boolean;
  totalQuestions?: number;
};

/** Call submit_quiz_attempt exactly as POST /api/quizzes/[id]/submit does (named args, null payment id). */
export async function submitQuiz(
  pool: pg.Pool,
  caller: Caller,
  args: { userId: string; quizId: string; answers: unknown },
): Promise<SubmitResult> {
  const rows = await queryAs<{ r: SubmitResult }>(
    pool,
    caller,
    `SELECT public.submit_quiz_attempt(p_user_id => $1, p_quiz_id => $2, p_answers => $3::jsonb, p_daily_payment_id => NULL) AS r`,
    [args.userId, args.quizId, JSON.stringify(args.answers)],
  );
  return rows[0].r;
}

// ─── Fixtures (inserted as the superuser) ─────────────────────────────────────

const newId = (prefix: string) => `${prefix}_${randomUUID()}`;

/** A signed-up player: an auth.users row plus the matching public."User" row (id = auth uid as text). */
export async function createUser(pool: pg.Pool, overrides: { email?: string } = {}): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = overrides.email ?? `player-${id}@example.test`;
  await pool.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [id, email]);
  await pool.query(`INSERT INTO "User" (id, email, "updatedAt") VALUES ($1, $2, now())`, [id, email]);
  return { id, email };
}

/**
 * A quiz. `pushedSecondsAgo` sets "pushedAt" relative to the database clock; null means
 * never pushed (no answering window).
 */
export async function createQuiz(
  pool: pg.Pool,
  overrides: { status?: string; duration?: number; pushedSecondsAgo?: number | null } = {},
): Promise<string> {
  const id = newId('quiz');
  const pushedSecondsAgo = overrides.pushedSecondsAgo === undefined ? 60 : overrides.pushedSecondsAgo;
  await pool.query(
    `INSERT INTO "Quiz" (id, title, status, duration, "pushedAt", "updatedAt")
     VALUES ($1, 'Test quiz', $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(secs => $4::int) END, now())`,
    [id, overrides.status ?? 'active', overrides.duration ?? 30, pushedSecondsAgo],
  );
  return id;
}

export async function createQuestion(
  pool: pg.Pool,
  quizId: string,
  overrides: { status?: string; hasCorrectAnswer?: boolean; correctOption?: number | null } = {},
): Promise<string> {
  const id = newId('q');
  await pool.query(
    `INSERT INTO "Question" (id, "quizId", text, options, status, "hasCorrectAnswer", "correctOption", "updatedAt")
     VALUES ($1, $2, 'Who wins?', '["A","B","C","D"]', $3, $4, $5, now())`,
    [id, quizId, overrides.status ?? 'active', overrides.hasCorrectAnswer ?? false, overrides.correctOption ?? null],
  );
  return id;
}

export async function createQuestions(pool: pg.Pool, quizId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) ids.push(await createQuestion(pool, quizId));
  return ids;
}

/** AppSettings.wallet_enabled: true/false writes the row, null deletes it (the RPC then defaults to on). */
export async function setWalletEnabled(pool: pg.Pool, enabled: boolean | null): Promise<void> {
  await pool.query(`DELETE FROM "AppSettings" WHERE key = 'wallet_enabled'`);
  if (enabled !== null) {
    await pool.query(`INSERT INTO "AppSettings" (key, value) VALUES ('wallet_enabled', $1)`, [String(enabled)]);
  }
}

/** A DailyPayment; `expiresInSeconds` is relative to the database clock (negative = already expired). */
export async function createDailyPayment(
  pool: pg.Pool,
  userId: string,
  overrides: { status?: string; expiresInSeconds?: number } = {},
): Promise<string> {
  const id = newId('dp');
  await pool.query(
    `INSERT INTO "DailyPayment" (id, "userId", status, "expiresAt", "updatedAt")
     VALUES ($1, $2, $3, now() + make_interval(secs => $4::int), now())`,
    [id, userId, overrides.status ?? 'completed', overrides.expiresInSeconds ?? 24 * 3600],
  );
  return id;
}

export async function createNotification(pool: pg.Pool, userId: string): Promise<string> {
  const id = newId('n');
  await pool.query(
    `INSERT INTO "Notification" (id, "userId", title, message, type) VALUES ($1, $2, 'Hello', 'Quiz is live', 'general')`,
    [id, userId],
  );
  return id;
}

export const answersFor = (questionIds: string[], selectedOption = 1): SubmitAnswer[] =>
  questionIds.map((questionId) => ({ questionId, selectedOption }));

/** Row count of a table, optionally filtered by "userId" (as the superuser). */
export async function countRows(pool: pg.Pool, table: string, userId?: string): Promise<number> {
  const { rows } = userId
    ? await pool.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "userId" = $1`, [userId])
    : await pool.query(`SELECT count(*)::int AS n FROM "${table}"`);
  return rows[0].n;
}
