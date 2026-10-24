#!/usr/bin/env node
/**
 * The local Supabase stack the end-to-end quiz test runs against (e2e/README.md).
 *
 *   node e2e/stack/stack.mjs up     generate the migrations, start the stack, write e2e/stack/.env.e2e
 *   node e2e/stack/stack.mjs down   stop it and delete its data
 *
 * Its schema is db-tests/schema (a copy of production plus every migration since), minus the plain
 * Postgres shim: a Supabase stack already has the API roles and the auth schema. Nothing here can reach
 * the live project: the stack runs in Docker on 127.0.0.1, and the app under test gets only these keys.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const WORKDIR = path.join(ROOT, 'e2e', 'stack');
const MIGRATIONS = path.join(WORKDIR, 'supabase', 'migrations');
const SCHEMA = path.join(ROOT, 'db-tests', 'schema');
const ENV_FILE = path.join(WORKDIR, '.env.e2e');
// Pinned: the CLI decides which service images run
const CLI = ['-y', 'supabase@2.119.0'];
// Everything but Postgres, Auth (gotrue), the REST API (postgrest) and the gateway (kong)
const EXCLUDED = 'realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';

// One command string run from the repository root, with the stack's folder relative to it: every part
// is a plain word, so nothing needs quoting whatever the checkout's path is
const supabase = (args, opts = {}) =>
  execSync(['npx', ...CLI, ...args, '--workdir', 'e2e/stack'].join(' '), { cwd: ROOT, stdio: 'inherit', ...opts });

function writeMigrations() {
  fs.rmSync(MIGRATIONS, { recursive: true, force: true });
  fs.mkdirSync(MIGRATIONS, { recursive: true });
  const files = fs.readdirSync(SCHEMA).filter((f) => f.endsWith('.sql') && !f.startsWith('00-')).sort();
  files.forEach((file, i) => {
    const version = String(20000101000000 + i);
    fs.copyFileSync(path.join(SCHEMA, file), path.join(MIGRATIONS, `${version}_${file.replace(/[^a-z0-9]+/gi, '_').replace(/_sql$/i, '')}.sql`));
  });
  fs.writeFileSync(
    path.join(MIGRATIONS, `${20000101000000 + files.length}_e2e_settings.sql`),
    [
      // Production's trigger on auth.users (the baseline dumps the public schema only): a new account
      // gets its "User" row
      'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();',
      // The wallet is off in production: players answer without a day pass
      `INSERT INTO public."AppSettings" (key, value) VALUES ('wallet_enabled', 'false');`,
      '',
    ].join('\n'),
  );
  console.log(`[e2e-stack] ${files.length} schema files + settings -> ${path.relative(ROOT, MIGRATIONS)}`);
}

function writeEnv() {
  const status = supabase(['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const vars = Object.fromEntries(
    status.split(/\r?\n/).map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
  );
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: vars.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: vars.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: vars.SERVICE_ROLE_KEY,
    E2E_DB_URL: vars.DB_URL,
  };
  for (const [key, value] of Object.entries(env)) {
    if (!value) throw new Error(`[e2e-stack] supabase status gave no value for ${key}`);
  }
  fs.writeFileSync(ENV_FILE, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  console.log(`[e2e-stack] keys -> ${path.relative(ROOT, ENV_FILE)}`);
}

const command = process.argv[2];
if (command === 'up') {
  writeMigrations();
  supabase(['start', '-x', EXCLUDED]);
  writeEnv();
} else if (command === 'down') {
  supabase(['stop', '--no-backup']);
} else {
  console.error('Usage: node e2e/stack/stack.mjs up|down');
  process.exit(1);
}
