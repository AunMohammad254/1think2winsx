/**
 * submit_lockin_batch (migration 06-20261104180000): the edge queue's consumer saves up to 500 lock-ins of one quiz
 * at once, each judged at "t", the time the edge-shield Worker received it. Only the service role may call it.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  anon,
  createDailyPayment,
  createPool,
  createQuestion,
  createQuestions,
  createQuiz,
  createUser,
  errorAs,
  player,
  queryAs,
  resetData,
  serviceRole,
  setWalletEnabled,
} from './helpers';

const pool = createPool();
afterAll(() => pool.end());

type Item = { u: unknown; t: unknown; a: unknown };
type Out = { u: string; s: string; n: number };

const batch = async (quizId: string, items: Item[]): Promise<Out[]> =>
  (await queryAs<{ r: Out[] }>(pool, serviceRole, `SELECT public.submit_lockin_batch($1, $2::jsonb) AS r`, [quizId, JSON.stringify(items)]))[0].r;

/** The database clock in ms, so "t" values sit where the tests mean them to. */
async function dbNow(): Promise<number> {
  const { rows } = await pool.query(`SELECT extract(epoch from now()) * 1000 AS ms`);
  return Number(rows[0].ms);
}
const iso = (ms: number) => new Date(ms).toISOString();
const picks = (qids: string[], option = 1) => qids.map((q) => ({ q, o: option }));
// Columns without a time zone hold UTC; pg would read them as this machine's local time, so they come back as text
const utcMs = (text: string) => new Date(text.replace(' ', 'T') + 'Z').getTime();

async function attempts(quizId: string) {
  return (await pool.query(`SELECT *, "completedAt"::text AS completed FROM "QuizAttempt" WHERE "quizId" = $1 ORDER BY "completedAt"`, [quizId])).rows;
}
async function answers(quizId: string, userId: string) {
  return (await pool.query(`SELECT "questionId", "selectedOption", "attemptedAt"::text AS attempted FROM "QuestionAttempt" WHERE "quizId" = $1 AND "userId" = $2 ORDER BY "questionId"`, [quizId, userId])).rows;
}
async function counter(quizId: string) {
  return (await pool.query(`SELECT entries FROM "QuizEntryCount" WHERE "quizId" = $1`, [quizId])).rows[0]?.entries ?? 0;
}
async function drained(quizId: string) {
  return (await pool.query(`SELECT processed FROM "LockinDrain" WHERE "quizId" = $1`, [quizId])).rows[0]?.processed ?? null;
}
async function notices(userId: string) {
  return (await pool.query(`SELECT title, message, type, link FROM "Notification" WHERE "userId" = $1`, [userId])).rows;
}

let now: number;
beforeEach(async () => {
  await resetData(pool);
  await setWalletEnabled(pool, false);
  now = await dbNow();
});

describe('saving a batch', () => {
  it('saves one attempt and one answer per question for each player, at the time the edge received it', async () => {
    const quizId = await createQuiz(pool);
    const qids = await createQuestions(pool, quizId, 3);
    const [a, b] = [await createUser(pool), await createUser(pool)];
    const ta = now - 4_000, tb = now - 2_000;

    const out = await batch(quizId, [{ u: a.id, t: iso(ta), a: picks(qids, 0) }, { u: b.id, t: iso(tb), a: picks(qids, 3) }]);

    expect(out).toEqual([{ u: a.id, s: 'saved', n: 3 }, { u: b.id, s: 'saved', n: 3 }]);
    const rows = await attempts(quizId);
    expect(rows.map((r) => r.userId)).toEqual([a.id, b.id]);
    expect(rows[0]).toMatchObject({ isCompleted: true, isEvaluated: false, score: 0, points: 0 });
    expect(rows[0].id).toMatch(/^qa_/);
    expect(Math.abs(utcMs(rows[0].completed) - ta)).toBeLessThan(2);
    const saved = await answers(quizId, b.id);
    expect(saved.map((r) => r.selectedOption)).toEqual([3, 3, 3]);
    expect(Math.abs(utcMs(saved[0].attempted) - tb)).toBeLessThan(2);
    // The entry counter moves once for the batch, and every lock-in counts as processed
    expect(await counter(quizId)).toBe(2);
    expect(await drained(quizId)).toBe(2);
  });

  it('answers in the order sent, and adds each batch to the processed count', async () => {
    const quizId = await createQuiz(pool);
    const qids = await createQuestions(pool, quizId, 1);
    const users = await Promise.all([1, 2, 3].map(() => createUser(pool)));
    await batch(quizId, users.slice(0, 2).map((u) => ({ u: u.id, t: iso(now), a: picks(qids) })));
    const out = await batch(quizId, [{ u: users[2].id, t: iso(now), a: picks(qids) }, { u: users[0].id, t: iso(now), a: picks(qids) }]);
    expect(out.map((r) => r.u)).toEqual([users[2].id, users[0].id]);
    expect(await drained(quizId)).toBe(4);
  });

  it('is for the service role only', async () => {
    const quizId = await createQuiz(pool);
    const user = await createUser(pool);
    const sql = `SELECT public.submit_lockin_batch($1, '[{"u":"x","t":"2026-01-01T00:00:00.000Z","a":[]}]'::jsonb)`;
    for (const caller of [anon, player(user.id)]) {
      const err = await errorAs(pool, caller, sql, [quizId]);
      expect(err.code).toBe('42501');
    }
    const priv = await errorAs(pool, player(user.id), `SELECT private_hardened.submit_lockin_batch($1, '[]'::jsonb)`, [quizId]);
    expect(priv.code).toBe('42501');
    const table = await errorAs(pool, player(user.id), `SELECT * FROM "LockinDrain"`);
    expect(table.code).toBe('42501');
  });

  it('refuses an empty or oversized batch as a whole', async () => {
    const quizId = await createQuiz(pool);
    for (const items of ['[]', JSON.stringify(Array.from({ length: 501 }, () => ({}))), '{}']) {
      const err = await errorAs(pool, serviceRole, `SELECT public.submit_lockin_batch($1, $2::jsonb)`, [quizId, items]);
      expect(err.code).toBe('22023');
    }
  });
});

describe('the answering window, at the time the edge received each lock-in', () => {
  it('saves what arrived up to 30 s after the countdown and refuses what came later, with a bell notice', async () => {
    // pushed 40 min ago for 30 min: the countdown ended 10 min ago, the grace 9.5 min ago
    const quizId = await createQuiz(pool, { pushedSecondsAgo: 2400, duration: 30 });
    const qids = await createQuestions(pool, quizId, 2);
    const [inTime, late] = [await createUser(pool), await createUser(pool)];
    const end = now - 600_000;

    const out = await batch(quizId, [{ u: inTime.id, t: iso(end + 29_000), a: picks(qids) }, { u: late.id, t: iso(end + 31_000), a: picks(qids) }]);

    expect(out.map((r) => r.s)).toEqual(['saved', 'closed']);
    expect(await notices(inTime.id)).toEqual([]);
    const [notice] = await notices(late.id);
    expect(notice).toMatchObject({ title: 'Answers not saved', type: 'quiz_attempt', link: '/quizzes' });
    expect(notice.message).toContain('arrived after the quiz closed');
    expect(await drained(quizId)).toBe(2);
  });

  it('still takes lock-ins received in time once the scheduler has paused the quiz after its grace', async () => {
    const quizId = await createQuiz(pool, { pushedSecondsAgo: 2400, duration: 30 });
    const qids = await createQuestions(pool, quizId, 1);
    await pool.query(`UPDATE "Quiz" SET status = 'paused', "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '9 minutes' WHERE id = $1`, [quizId]);
    const [a, b] = [await createUser(pool), await createUser(pool)];
    const end = now - 600_000;
    const out = await batch(quizId, [{ u: a.id, t: iso(end + 10_000), a: picks(qids) }, { u: b.id, t: iso(end + 40_000), a: picks(qids) }]);
    expect(out.map((r) => r.s)).toEqual(['saved', 'closed']);
  });

  it('a quiz paused during its window takes only the lock-ins received before the pause', async () => {
    const quizId = await createQuiz(pool, { pushedSecondsAgo: 60, duration: 30 });
    const qids = await createQuestions(pool, quizId, 1);
    await pool.query(`UPDATE "Quiz" SET status = 'paused', "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '20 seconds' WHERE id = $1`, [quizId]);
    const [a, b] = [await createUser(pool), await createUser(pool)];
    const out = await batch(quizId, [{ u: a.id, t: iso(now - 30_000), a: picks(qids) }, { u: b.id, t: iso(now - 5_000), a: picks(qids) }]);
    expect(out.map((r) => r.s)).toEqual(['saved', 'closed']);
  });

  it('refuses every lock-in of a quiz that is not taking answers, and counts them as processed', async () => {
    const quizId = await createQuiz(pool, { status: 'draft' });
    const qids = await createQuestions(pool, quizId, 1);
    const user = await createUser(pool);
    const out = await batch(quizId, [{ u: user.id, t: iso(now), a: picks(qids) }]);
    expect(out).toEqual([{ u: user.id, s: 'not_found', n: 0 }]);
    expect((await notices(user.id))[0].message).toContain('had stopped taking answers');
    expect(await drained(quizId)).toBe(1);
  });

  it('answers not_found for a quiz that does not exist, writing nothing', async () => {
    const user = await createUser(pool);
    const out = await batch('quiz_missing', [{ u: user.id, t: iso(now), a: [{ q: 'q1', o: 1 }] }]);
    expect(out).toEqual([{ u: user.id, s: 'not_found', n: 0 }]);
    expect(await notices(user.id)).toEqual([]);
    expect(await drained('quiz_missing')).toBeNull();
  });
});

describe('copies and second tabs', () => {
  it('in one batch, a player\'s earliest lock-in counts and the later copies are duplicates', async () => {
    const quizId = await createQuiz(pool);
    const qids = await createQuestions(pool, quizId, 2);
    const user = await createUser(pool);
    const out = await batch(quizId, [
      { u: user.id, t: iso(now - 1_000), a: picks(qids, 2) },
      { u: user.id, t: iso(now - 3_000), a: picks(qids, 0) },
      { u: user.id, t: iso(now - 2_000), a: picks(qids, 1) },
    ]);
    expect(out.map((r) => r.s)).toEqual(['duplicate', 'saved', 'duplicate']);
    expect((await answers(quizId, user.id)).map((r) => r.selectedOption)).toEqual([0, 0]);
    expect(await attempts(quizId)).toHaveLength(1);
    expect(await notices(user.id)).toEqual([]);
  });

  it('across batches, an earlier-received pick replaces a later one the queue delivered first', async () => {
    const quizId = await createQuiz(pool);
    const qids = await createQuestions(pool, quizId, 2);
    const user = await createUser(pool);
    await batch(quizId, [{ u: user.id, t: iso(now - 1_000), a: picks(qids, 3) }]);
    const out = await batch(quizId, [{ u: user.id, t: iso(now - 5_000), a: picks(qids, 0) }]);
    expect(out).toEqual([{ u: user.id, s: 'reattempt', n: 2 }]);
    expect((await answers(quizId, user.id)).map((r) => r.selectedOption)).toEqual([0, 0]);
  });

  it('a later copy changes nothing, and saves the answers to questions added since', async () => {
    const quizId = await createQuiz(pool);
    const [q1] = await createQuestions(pool, quizId, 1);
    const user = await createUser(pool);
    await batch(quizId, [{ u: user.id, t: iso(now - 9_000), a: [{ q: q1, o: 1 }] }]);
    const before = (await attempts(quizId))[0].completed;
    const q2 = await createQuestion(pool, quizId);

    const repeat = await batch(quizId, [{ u: user.id, t: iso(now - 8_000), a: [{ q: q1, o: 2 }] }]);
    expect(repeat).toEqual([{ u: user.id, s: 'reattempt', n: 0 }]);
    expect((await attempts(quizId))[0].completed).toEqual(before);

    const more = await batch(quizId, [{ u: user.id, t: iso(now - 1_000), a: [{ q: q1, o: 3 }, { q: q2, o: 2 }] }]);
    expect(more).toEqual([{ u: user.id, s: 'reattempt', n: 1 }]);
    expect((await answers(quizId, user.id)).find((r) => r.questionId === q1)?.selectedOption).toBe(1);
    expect((await attempts(quizId))[0].completed).not.toEqual(before);
    expect(await counter(quizId)).toBe(1);
  });

  it('two batches holding the same new player at once save one attempt (the counter lock comes first)', async () => {
    const quizId = await createQuiz(pool);
    const qids = await createQuestions(pool, quizId, 2);
    const users = await Promise.all(Array.from({ length: 20 }, () => createUser(pool)));
    const items = users.map((u, i) => ({ u: u.id, t: iso(now - 5_000 + i), a: picks(qids) }));
    const copies = users.map((u, i) => ({ u: u.id, t: iso(now - 4_000 + i), a: picks(qids, 2) }));
    const [first, second] = await Promise.all([batch(quizId, items), batch(quizId, copies)]);
    expect([...first, ...second].filter((r) => r.s === 'saved')).toHaveLength(20);
    expect(await attempts(quizId)).toHaveLength(20);
    expect(await counter(quizId)).toBe(20);
    for (const u of users.slice(0, 3)) expect((await answers(quizId, u.id)).map((r) => r.selectedOption)).toEqual([1, 1]);
  });
});

describe('the entry limit', () => {
  it('takes new players first come first served by the time the edge received them, up to the limit', async () => {
    const quizId = await createQuiz(pool);
    const qids = await createQuestions(pool, quizId, 1);
    await pool.query(`INSERT INTO "QuizAdminSettings" ("quizId", "maxEntries") VALUES ($1, 3)`, [quizId]);
    const users = await Promise.all(Array.from({ length: 5 }, () => createUser(pool)));
    // Sent in reverse: the three received first get in
    const out = await batch(quizId, users.map((u, i) => ({ u: u.id, t: iso(now - 10_000 + i * 1_000), a: picks(qids) })).reverse());
    expect(out.map((r) => r.s)).toEqual(['entries_closed', 'entries_closed', 'saved', 'saved', 'saved']);
    expect(await counter(quizId)).toBe(3);
    expect((await notices(users[4].id))[0].message).toContain('Entries for');
  });

  it('still takes a player who already entered once the quiz is full', async () => {
    const quizId = await createQuiz(pool);
    const [q1] = await createQuestions(pool, quizId, 1);
    await pool.query(`INSERT INTO "QuizAdminSettings" ("quizId", "maxEntries") VALUES ($1, 1)`, [quizId]);
    const [inside, outside] = [await createUser(pool), await createUser(pool)];
    await batch(quizId, [{ u: inside.id, t: iso(now - 5_000), a: [{ q: q1, o: 1 }] }]);
    const q2 = await createQuestion(pool, quizId);
    const out = await batch(quizId, [{ u: outside.id, t: iso(now - 2_000), a: [{ q: q2, o: 1 }] }, { u: inside.id, t: iso(now - 1_000), a: [{ q: q2, o: 1 }] }]);
    expect(out.map((r) => r.s)).toEqual(['entries_closed', 'reattempt']);
  });
});

describe('the day pass', () => {
  it('needs a pass valid at "t" when the wallet is on, and none for a free-entry quiz', async () => {
    await setWalletEnabled(pool, true);
    const paid = await createQuiz(pool);
    const free = await createQuiz(pool);
    await pool.query(`UPDATE "Quiz" SET "freeEntry" = true WHERE id = $1`, [free]);
    const [pq] = await createQuestions(pool, paid, 1);
    const [fq] = await createQuestions(pool, free, 1);
    const [withPass, expired, none] = [await createUser(pool), await createUser(pool), await createUser(pool)];
    const pass = await createDailyPayment(pool, withPass.id);
    await createDailyPayment(pool, expired.id, { expiresInSeconds: -60 });

    const out = await batch(paid, [
      { u: withPass.id, t: iso(now), a: [{ q: pq, o: 1 }] },
      { u: expired.id, t: iso(now), a: [{ q: pq, o: 1 }] },
      { u: none.id, t: iso(now), a: [{ q: pq, o: 1 }] },
    ]);
    expect(out.map((r) => r.s)).toEqual(['saved', 'payment_required', 'payment_required']);
    expect((await attempts(paid))[0].dailyPaymentId).toBe(pass);
    expect((await notices(none.id))[0].message).toContain('needs a day pass');

    expect((await batch(free, [{ u: none.id, t: iso(now), a: [{ q: fq, o: 1 }] }]))[0].s).toBe('saved');
  });

  it('accepts a pass that expired after the lock-in arrived', async () => {
    await setWalletEnabled(pool, true);
    const quizId = await createQuiz(pool);
    const [q] = await createQuestions(pool, quizId, 1);
    const user = await createUser(pool);
    await createDailyPayment(pool, user.id, { expiresInSeconds: -30 });
    expect((await batch(quizId, [{ u: user.id, t: iso(now - 60_000), a: [{ q, o: 1 }] }]))[0].s).toBe('saved');
  });
});

describe('bad lock-ins', () => {
  it('refuses each malformed or closed lock-in on its own, and saves the rest of the batch', async () => {
    const quizId = await createQuiz(pool);
    const qids = await createQuestions(pool, quizId, 2);
    const answered = await createQuestion(pool, quizId, { hasCorrectAnswer: true, correctOption: 1 });
    const closed = await createQuestion(pool, quizId);
    await pool.query(`UPDATE "Question" SET "closesAt" = now() - interval '1 minute' WHERE id = $1`, [closed]);
    const other = await createQuiz(pool);
    const [foreign] = await createQuestions(pool, other, 1);
    const users = await Promise.all(Array.from({ length: 14 }, () => createUser(pool)));
    const good = users[13];
    const t = iso(now);

    const out = await batch(quizId, [
      { u: 'not-a-player', t, a: picks(qids) },
      { u: users[1].id, t: 'yesterday', a: picks(qids) },
      { u: users[2].id, t, a: 'nope' },
      { u: users[3].id, t, a: [] },
      { u: users[4].id, t, a: Array.from({ length: 201 }, (_, i) => ({ q: `q${i}`, o: 1 })) },
      { u: users[5].id, t, a: [{ q: qids[0], o: 1 }, { q: qids[0], o: 2 }] },
      { u: users[6].id, t, a: [{ q: qids[0], o: 10 }] },
      { u: users[7].id, t, a: [{ q: qids[0], o: 'x' }] },
      { u: users[8].id, t, a: [{ q: foreign, o: 1 }] },
      { u: users[9].id, t, a: [{ q: answered, o: 1 }] },
      { u: users[10].id, t, a: [{ q: closed, o: 1 }] },
      { u: 42, t, a: picks(qids) },
      { u: users[12].id, t, a: [{ q: qids[0], o: 1.5 }] },
      { u: good.id, t, a: picks(qids) },
    ]);

    expect(out.slice(0, 13).map((r) => r.s)).toEqual(Array(13).fill('invalid'));
    expect(out[13]).toEqual({ u: good.id, s: 'saved', n: 2 });
    expect(await attempts(quizId)).toHaveLength(1);
    expect((await notices(users[10].id))[0].message).toContain('a question had closed');
    expect(await drained(quizId)).toBe(14);
  });

  it('takes a match question until its own closing time, judged at "t"', async () => {
    const quizId = await createQuiz(pool, { pushedSecondsAgo: null });
    await pool.query(
      `INSERT INTO "LiveMatch" ("quizId", "teamA", "teamB", "oversPerInnings", status, "createdBy") VALUES ($1, 'Lahore', 'Karachi', 20, 'live', 'admin@example.test')`,
      [quizId],
    );
    const q = await createQuestion(pool, quizId);
    await pool.query(`UPDATE "Question" SET "closesAt" = now() - interval '10 seconds' WHERE id = $1`, [q]);
    const [early, late] = [await createUser(pool), await createUser(pool)];
    const out = await batch(quizId, [{ u: early.id, t: iso(now - 20_000), a: [{ q, o: 1 }] }, { u: late.id, t: iso(now - 5_000), a: [{ q, o: 1 }] }]);
    expect(out.map((r) => r.s)).toEqual(['saved', 'invalid']);
  });
});
