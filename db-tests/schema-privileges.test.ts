/**
 * Privileges on schema public itself (06-20261020120000_revoke_public_create_on_public_schema.sql):
 * the API roles can still use the schema but can no longer create objects in it, so nobody can
 * plant a table, view or function that shadows a name resolved through search_path.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { anon, createPool, errorAs, player, queryAs, serviceRole, type Caller } from './helpers';

const pool = createPool();
afterAll(() => pool.end());

const API_ROLES: [string, Caller][] = [
  ['anon', anon],
  ['authenticated', player(randomUUID())],
  ['service_role', serviceRole],
];

const planted = () => `planted_${randomUUID().replace(/-/g, '')}`;

const CREATE_STATEMENTS: [string, () => string][] = [
  ['a table', () => `CREATE TABLE public.${planted()} (id int)`],
  // Unqualified, as a planted object would be: the name resolves through search_path to public
  ['a view through search_path', () => `CREATE VIEW ${planted()} AS SELECT 1 AS id`],
  ['a function', () => `CREATE FUNCTION public.${planted()}() RETURNS int LANGUAGE sql AS 'SELECT 1'`],
];

/** Privileges in schema public's ACL, by grantee ('PUBLIC' for grantee 0). */
async function schemaAcl(): Promise<Record<string, string[]>> {
  const { rows } = await pool.query<{ grantee: string; privileges: string[] }>(
    `SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
            array_agg(a.privilege_type ORDER BY a.privilege_type) AS privileges
     FROM pg_namespace n, aclexplode(n.nspacl) a
     WHERE n.nspname = 'public'
     GROUP BY 1`,
  );
  return Object.fromEntries(rows.map((r) => [r.grantee, r.privileges]));
}

describe('schema public privileges', () => {
  it('only the owner has CREATE; PUBLIC and the API roles (by name) have USAGE', async () => {
    expect(await schemaAcl()).toEqual({
      postgres: ['CREATE', 'USAGE'],
      PUBLIC: ['USAGE'],
      anon: ['USAGE'],
      authenticated: ['USAGE'],
      service_role: ['USAGE'],
    });
  });

  it.each(API_ROLES)('%s has USAGE but not CREATE on the schema', async (role) => {
    const { rows } = await pool.query(
      `SELECT has_schema_privilege($1, 'public', 'USAGE') AS usage, has_schema_privilege($1, 'public', 'CREATE') AS create`,
      [role],
    );
    expect(rows[0]).toEqual({ usage: true, create: false });
  });

  describe.each(API_ROLES)('%s', (_role, caller) => {
    it.each(CREATE_STATEMENTS)('cannot create %s in public', async (_what, statement) => {
      const error = await errorAs(pool, caller, statement());
      expect(error.code).toBe('42501');
      expect(error.message).toBe('permission denied for schema public');
    });

    it('can still read a table it has SELECT on', async () => {
      await expect(queryAs(pool, caller, `SELECT id FROM public."Prize" LIMIT 1`)).resolves.toBeInstanceOf(Array);
    });
  });
});
