/**
 * Data for the end-to-end quiz test, written straight into the local Supabase stack (e2e/README.md):
 * players through the Auth admin API (production's trigger then makes their "User" row), quizzes and
 * reads through Postgres. Never points anywhere but the stack's 127.0.0.1 ports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const STACK_ENV_FILE = path.join(__dirname, '.env.e2e');

/** The stack's URL and keys, written by `node e2e/stack/stack.mjs up`; null before that. */
export function readStackEnv(): Record<string, string> | null {
  if (!fs.existsSync(STACK_ENV_FILE)) return null;
  const env = Object.fromEntries(
    fs.readFileSync(STACK_ENV_FILE, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
  );
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'E2E_DB_URL']) {
    const host = new URL(env[key]).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`${key} must point at the local stack, not ${host}`);
  }
  return env;
}

export const ADMIN = { email: 'admin@e2e.test', password: 'e2e-admin-password' };

let pool: pg.Pool | null = null;
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: readStackEnv()!.E2E_DB_URL, max: 2 });
  return pool;
}
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

/** A confirmed player who can sign in with `password`. */
export async function createPlayer(name: string): Promise<{ id: string; email: string; password: string }> {
  const env = readStackEnv()!;
  const email = `player-${randomUUID().slice(0, 8)}@e2e.test`;
  const password = `pw-${randomUUID()}`;
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
  });
  if (!response.ok) throw new Error(`Creating the player failed: ${response.status} ${await response.text()}`);
  const { id } = (await response.json()) as { id: string };
  return { id, email, password };
}

export interface QuizSpec {
  title: string;
  durationMinutes: number;
  /** How long ago the quiz was pushed live (it closes durationMinutes after that) */
  pushedSecondsAgo: number;
  questions: Array<{ text: string; options: string[] }>;
}

/** An active prediction quiz, pushed live, with open questions in order. */
export async function createLiveQuiz(spec: QuizSpec): Promise<{ id: string; questionIds: string[] }> {
  const id = `e2e_${randomUUID()}`;
  await db().query(
    `INSERT INTO "Quiz" (id, title, status, duration, "timeUpDuration", "passingScore", "quizType", "pushedAt", "updatedAt")
     VALUES ($1, $2, 'active', $3, 30, 50, 'predictable', now() - make_interval(secs => $4), now())`,
    [id, spec.title, spec.durationMinutes, spec.pushedSecondsAgo],
  );
  const questionIds: string[] = [];
  for (const [i, q] of spec.questions.entries()) {
    const questionId = `${id}_q${i}`;
    await db().query(
      `INSERT INTO "Question" (id, "quizId", text, options, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'active', now() + make_interval(secs => $5), now())`,
      [questionId, id, q.text, JSON.stringify(q.options), i],
    );
    questionIds.push(questionId);
  }
  return { id, questionIds };
}
