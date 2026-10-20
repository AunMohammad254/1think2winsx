/**
 * Support tickets (migration 06-20261021120000): create_support_ticket's numbers and rate limits,
 * the table's constraints, and that only the service role can reach any of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, countRows, createPool, createUser, errorAs, player, queryAs, resetData, serviceRole } from './helpers';

const pool = createPool();
afterAll(() => pool.end());
beforeEach(() => resetData(pool));

const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '20261021120000_support_tickets.sql');

type CreateResult = {
  success: boolean;
  code?: string;
  error?: string;
  ticket?: { id: string; ticketNumber: string; userId: string; subject: string; message: string; status: string; adminReply: string | null; createdAt: string; updatedAt: string };
};

/** Calls the function the way supportTicketDb.create does (service role, named args). */
async function create(userId: string, subject = 'Deposit missing', message = 'I sent 200 PKR but my wallet still shows 0.'): Promise<CreateResult> {
  const rows = await queryAs(pool, serviceRole, `SELECT public.create_support_ticket(p_user_id => $1, p_subject => $2, p_message => $3) AS r`, [userId, subject, message]);
  return rows[0].r;
}

/** Adds a ticket directly, as the superuser, with a chosen age and status. */
async function insertTicket(userId: string, number: string, { hoursAgo = 0, status = 'open' } = {}) {
  await pool.query(
    `INSERT INTO "SupportTicket" ("ticketNumber", "userId", subject, message, status, "createdAt")
     VALUES ($1, $2, 'Old problem', 'Details', $3, now() - make_interval(hours => $4::int))`,
    [number, userId, status, hoursAgo],
  );
}

describe('create_support_ticket', () => {
  it('creates an open ticket with a TKT- number, trimming the text', async () => {
    const user = await createUser(pool);
    const r = await create(user.id, '  Deposit missing  ', '  I sent 200 PKR.  ');
    expect(r.success).toBe(true);
    expect(r.ticket).toMatchObject({ userId: user.id, subject: 'Deposit missing', message: 'I sent 200 PKR.', status: 'open', adminReply: null });
    expect(r.ticket!.ticketNumber).toMatch(/^TKT-[A-HJ-NP-Z2-9]{6}$/);
    // "updatedAt" has a default, so an insert that leaves it out works
    expect(Date.parse(r.ticket!.updatedAt)).toBeGreaterThan(0);
    expect(await countRows(pool, 'SupportTicket', user.id)).toBe(1);
  });

  it('gives every ticket its own number', async () => {
    const user = await createUser(pool);
    const numbers = new Set<string>();
    for (let i = 0; i < 3; i++) numbers.add((await create(user.id)).ticket!.ticketNumber);
    expect(numbers.size).toBe(3);
  });

  it.each([
    ['a blank subject', '   ', 'details'],
    ['a blank description', 'subject', ''],
    ['a null subject', null, 'details'],
  ])('refuses %s', async (_label, subject, message) => {
    const user = await createUser(pool);
    const rows = await queryAs(pool, serviceRole, `SELECT public.create_support_ticket($1, $2, $3) AS r`, [user.id, subject, message]);
    expect(rows[0].r).toEqual({ success: false, code: 'invalid', error: 'A ticket needs a subject and a description.' });
    expect(await countRows(pool, 'SupportTicket')).toBe(0);
  });

  it('refuses a player that does not exist', async () => {
    expect(await create('no-such-user')).toEqual({ success: false, code: 'no_user', error: 'Player not found.' });
  });

  it('allows 3 tickets an hour; older tickets do not count', async () => {
    const user = await createUser(pool);
    await insertTicket(user.id, 'TKT-AAAAAA', { hoursAgo: 2, status: 'closed' });
    for (let i = 0; i < 3; i++) expect((await create(user.id)).success).toBe(true);
    expect(await create(user.id)).toMatchObject({ success: false, code: 'rate_limited' });
    expect(await countRows(pool, 'SupportTicket', user.id)).toBe(4);

    // the limit is per player
    const other = await createUser(pool);
    expect((await create(other.id)).success).toBe(true);
  });

  it('allows at most 5 unresolved tickets; resolved and closed ones do not count', async () => {
    const user = await createUser(pool);
    const statuses = ['open', 'in_progress', 'open', 'in_progress', 'resolved', 'closed'];
    for (const [i, status] of statuses.entries()) await insertTicket(user.id, `TKT-BBBBB${'23456789'[i]}`, { hoursAgo: 3, status });
    expect((await create(user.id)).success).toBe(true); // the 5th unresolved one
    expect(await create(user.id)).toMatchObject({ success: false, code: 'too_many_open' });

    await pool.query(`UPDATE "SupportTicket" SET status = 'resolved' WHERE "ticketNumber" = 'TKT-BBBBB2'`);
    expect((await create(user.id)).success).toBe(true);
  });

  it('runs two requests sent together one after the other, so both count toward the limit', async () => {
    const user = await createUser(pool);
    await insertTicket(user.id, 'TKT-CCCCCC');
    await insertTicket(user.id, 'TKT-CCCCCD');
    const results = await Promise.all([create(user.id), create(user.id)]);
    expect(results.map((r) => r.success).sort()).toEqual([false, true]);
    expect(await countRows(pool, 'SupportTicket', user.id)).toBe(3);
  });

  it('tries another number on a clash and gives up after 10 tries', async () => {
    const user = await createUser(pool);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      // Every "random" number is the same one (rolled back below with the rest of the transaction)
      await db.query(`CREATE OR REPLACE FUNCTION public.support_ticket_number() RETURNS text LANGUAGE sql AS $$ SELECT 'TKT-DDDDDD' $$`);
      const first = await db.query(`SELECT public.create_support_ticket($1, 's', 'm') AS r`, [user.id]);
      expect(first.rows[0].r.ticket.ticketNumber).toBe('TKT-DDDDDD');
      await db.query('SAVEPOINT clash');
      await expect(db.query(`SELECT public.create_support_ticket($1, 's', 'm') AS r`, [user.id])).rejects.toThrow(
        'create_support_ticket: no free ticket number after 10 tries',
      );
      await db.query('ROLLBACK TO SAVEPOINT clash');
    } finally {
      await db.query('ROLLBACK');
      db.release();
    }
    expect(await countRows(pool, 'SupportTicket')).toBe(0);
    expect((await create(user.id)).ticket!.ticketNumber).not.toBe('TKT-DDDDDD');
  });
});

describe('SupportTicket table', () => {
  it.each([
    ['a malformed number', `'TKT-abc123'`, `'open'`, 'NULL'],
    ['a number with a look-alike character', `'TKT-AB0CDE'`, `'open'`, 'NULL'],
    ['an unknown status', `'TKT-EEEEEE'`, `'pending'`, 'NULL'],
    ['a reply over 2000 characters', `'TKT-EEEEEE'`, `'resolved'`, `repeat('x', 2001)`],
  ])('rejects %s', async (_label, number, status, reply) => {
    const user = await createUser(pool);
    const error = await errorAs(
      pool,
      serviceRole,
      `INSERT INTO "SupportTicket" ("ticketNumber", "userId", subject, message, status, "adminReply") VALUES (${number}, $1, 's', 'm', ${status}, ${reply})`,
      [user.id],
    );
    expect(error.code).toBe('23514'); // check_violation
  });

  it('rejects a duplicate number and an unknown player', async () => {
    const user = await createUser(pool);
    await insertTicket(user.id, 'TKT-FFFFFF');
    expect((await errorAs(pool, serviceRole, `INSERT INTO "SupportTicket" ("ticketNumber", "userId", subject, message) VALUES ('TKT-FFFFFF', $1, 's', 'm')`, [user.id])).code).toBe('23505');
    expect((await errorAs(pool, serviceRole, `INSERT INTO "SupportTicket" ("ticketNumber", "userId", subject, message) VALUES ('TKT-FFFFF2', 'ghost', 's', 'm')`)).code).toBe('23503');
  });

  it("goes with its player when the player's account is deleted", async () => {
    const user = await createUser(pool);
    await create(user.id);
    await pool.query(`DELETE FROM "User" WHERE id = $1`, [user.id]);
    expect(await countRows(pool, 'SupportTicket')).toBe(0);
  });

  it('lets the service role read and update tickets, but not delete them', async () => {
    const user = await createUser(pool);
    const { ticket } = await create(user.id);
    const updated = await queryAs(
      pool,
      serviceRole,
      `UPDATE "SupportTicket" SET status = 'resolved', "adminReply" = 'Fixed', "updatedAt" = now() WHERE id = $1 RETURNING status, "adminReply"`,
      [ticket!.id],
    );
    expect(updated).toEqual([{ status: 'resolved', adminReply: 'Fixed' }]);
    expect((await errorAs(pool, serviceRole, `DELETE FROM "SupportTicket" WHERE id = $1`, [ticket!.id])).code).toBe('42501');
  });

  it.each([
    ['anon', false],
    ['a signed-in player, even for their own tickets', true],
  ])('gives %s no access at all', async (_label, signedIn) => {
    const user = await createUser(pool);
    await create(user.id);
    const caller = signedIn ? player(user.id, user.email) : anon;
    for (const sql of [
      `SELECT * FROM "SupportTicket"`,
      `INSERT INTO "SupportTicket" ("ticketNumber", "userId", subject, message) VALUES ('TKT-GGGGGG', '${user.id}', 's', 'm')`,
      `UPDATE "SupportTicket" SET status = 'closed'`,
      `SELECT public.create_support_ticket('${user.id}', 's', 'm')`,
      `SELECT public.support_ticket_number()`,
    ]) {
      expect((await errorAs(pool, caller, sql)).code).toBe('42501');
    }
  });

  it('has row-level security on, with no policies', async () => {
    const { rows } = await pool.query(
      `SELECT c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_policies p WHERE p.tablename = 'SupportTicket') AS policies
         FROM pg_class c WHERE c.oid = 'public."SupportTicket"'::regclass`,
    );
    expect(rows[0]).toEqual({ rls: true, policies: 0 });
  });

  it('can be re-run, and takes away grants that default privileges would give anon and authenticated', async () => {
    await pool.query(`GRANT ALL ON public."SupportTicket" TO anon, authenticated`);
    await pool.query(`GRANT EXECUTE ON FUNCTION public.create_support_ticket(text, text, text) TO anon, authenticated`);
    await pool.query(fs.readFileSync(MIGRATION, 'utf8'));
    const { rows } = await pool.query(
      `SELECT r AS role,
              has_table_privilege(r, 'public."SupportTicket"', 'SELECT,INSERT,UPDATE,DELETE') AS any_table,
              has_function_privilege(r, 'public.create_support_ticket(text, text, text)', 'EXECUTE') AS create_fn,
              has_function_privilege(r, 'public.support_ticket_number()', 'EXECUTE') AS number_fn
         FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r ORDER BY r`,
    );
    expect(rows).toEqual([
      { role: 'anon', any_table: false, create_fn: false, number_fn: false },
      { role: 'authenticated', any_table: false, create_fn: false, number_fn: false },
      { role: 'service_role', any_table: true, create_fn: true, number_fn: true },
    ]);
  });
});
