#!/usr/bin/env node
// Project settings that live outside the database (Auth + email templates, Data API, Realtime, Storage, pooler,
// SSL, network restrictions, ...), for deploy/private/SUPABASE_MUMBAI_SWITCH.md. Uses the Management API with a
// personal access token in SUPABASE_ACCESS_TOKEN (Dashboard → Account → Access Tokens). Never writes the token.
//
//   node settings.mjs export <ref> <dir>          GET every settings endpoint into <dir>/*.json, plus SUMMARY.txt
//   node settings.mjs compare <old-dir> <new-dir>  differences, project-specific values and secrets listed apart
//   node settings.mjs apply-auth <old-dir> <ref> [--dry-run] [--skip=a,b]
//                                                  PATCH the old Auth settings (templates included) onto <ref>
//
// Secret fields (SMTP password, OAuth and CAPTCHA secrets, ...) come back from the API masked or hashed, so
// apply-auth never copies them. Give each one as SECRET_<FIELD> (e.g. SECRET_SMTP_PASS) to set it in the same
// PATCH, or type it in the Dashboard. The exported files can hold those hashes: keep them out of the repo.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API = process.env.SUPABASE_API_URL ?? 'https://api.supabase.com';

// name → path; {ref} is replaced. A 404 (no custom domain, ...) is a normal answer, not a failure.
const ENDPOINTS = {
  project: '/v1/projects/{ref}',
  auth: '/v1/projects/{ref}/config/auth',
  'auth-signing-keys': '/v1/projects/{ref}/config/auth/signing-keys',
  'auth-third-party': '/v1/projects/{ref}/config/auth/third-party-auth',
  'data-api': '/v1/projects/{ref}/postgrest',
  realtime: '/v1/projects/{ref}/config/realtime',
  storage: '/v1/projects/{ref}/config/storage',
  'storage-buckets': '/v1/projects/{ref}/storage/buckets',
  pooler: '/v1/projects/{ref}/config/database/pooler',
  postgres: '/v1/projects/{ref}/config/database/postgres',
  'ssl-enforcement': '/v1/projects/{ref}/ssl-enforcement',
  'network-restrictions': '/v1/projects/{ref}/network-restrictions',
  'custom-hostname': '/v1/projects/{ref}/custom-hostname',
  'vanity-subdomain': '/v1/projects/{ref}/vanity-subdomain',
  addons: '/v1/projects/{ref}/billing/addons',
  functions: '/v1/projects/{ref}/functions',
  branches: '/v1/projects/{ref}/branches',
  readonly: '/v1/projects/{ref}/readonly',
  'all-effective': '/v2/projects/{ref}/config', // alpha: every setting incl. defaults; may be missing
};
// Must answer 200, or the export is incomplete
const REQUIRED = ['project', 'auth', 'data-api', 'realtime', 'storage', 'storage-buckets', 'pooler', 'postgres'];
// Differ between any two projects by design; listed apart by compare
const NOT_COMPARED = ['project', 'auth-signing-keys', 'addons', 'all-effective'];

// A yes/no or number setting is never a secret, whatever its name (security_update_password_require_current_password)
export const isSecret = (key, value) =>
  typeof value !== 'boolean' &&
  typeof value !== 'number' &&
  /(^|_)(secret|secrets|pass|password|auth_token|access_key|api_key|api_secret|private_key)$/i.test(key.split('.').pop());
export const isProjectSpecific = (key) =>
  /(^|\.)(id|ref|project_ref|organization_id|created_at|updated_at|inserted_at|region|host|db_host|db_port|db_user|db_name|connection_string|connectionString|identifier|endpoint|status|owner)$/i.test(
    key.replace(/\[[^\]]*\]/g, ''),
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('Set SUPABASE_ACCESS_TOKEN (a personal access token) first');
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API + p, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // A dropped connection mid-run; every call here is safe to repeat
      if (attempt < 5) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw e;
    }
    if (res.status === 429 && attempt < 5) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  }
}

// { a: { b: 1 }, list: [{ id: 'x', v: 2 }] } → { 'a.b': 1, 'list[x].v': 2 }. Arrays of objects are keyed by
// id/name/database_type when they have one, so a reordered list doesn't show as changed.
export function flatten(value, prefix = '', out = {}) {
  if (Array.isArray(value)) {
    if (value.length === 0) out[prefix || '(list)'] = [];
    value.forEach((item, i) => {
      const label = item && typeof item === 'object' ? (item.database_type ?? item.name ?? item.id ?? i) : i;
      flatten(item, `${prefix}[${label}]`, out);
    });
  } else if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out[prefix] = {};
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = value;
  }
  return out;
}

const show = (v) => {
  if (typeof v === 'string' && v.length > 100) return `${JSON.stringify(v.slice(0, 100))}… (${v.length} chars)`;
  return JSON.stringify(v);
};
const blank = (v) => v === undefined || v === null || v === '';

function readDir(dir) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const files = {};
  for (const name of Object.keys(index.endpoints)) {
    const f = path.join(dir, `${name}.json`);
    if (fs.existsSync(f)) files[name] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  return { index, files };
}

async function exportSettings(ref, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const index = { ref, exportedAt: new Date().toISOString(), endpoints: {} };
  const summary = [`Settings of project ${ref}, exported ${index.exportedAt}`, ''];
  let missing = 0;
  for (const [name, p] of Object.entries(ENDPOINTS)) {
    const { status, json } = await api('GET', p.replace('{ref}', ref));
    index.endpoints[name] = status;
    const ok = status === 200;
    if (ok) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(json, null, 2) + '\n');
    const why = `${status}: ${show(json?.message ?? json)}`;
    const note = ok ? 'saved' : status === 404 ? 'none (404)' : REQUIRED.includes(name) ? `FAILED ${why}` : `not available (${why})`;
    if (!ok && REQUIRED.includes(name)) missing++;
    console.log(`${name.padEnd(22)} ${note}`);
    if (ok && name !== 'all-effective') {
      summary.push(`## ${name}`);
      for (const [k, v] of Object.entries(flatten(json))) {
        summary.push(`${k} = ${isSecret(k, v) ? (blank(v) ? '(empty)' : '(secret, set)') : show(v)}`);
      }
      summary.push('');
    }
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'SUMMARY.txt'), summary.join('\n'));
  console.log(`\nWrote ${dir}. ${missing ? `${missing} required endpoint(s) FAILED: the export is incomplete.` : 'All required endpoints saved.'}`);
  if (Object.values(index.endpoints).includes(401)) console.log('The token was rejected (401): create a new personal access token.');
  if (missing) process.exitCode = 1;
}

export function compareFlat(a, b) {
  const real = [];
  const secrets = [];
  const specific = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = a[k];
    const y = b[k];
    if (isSecret(k, x ?? y)) {
      // Masked or hashed per project, so only "set or not" can be compared
      if (blank(x) !== blank(y)) real.push(`secret    ${k}: ${blank(x) ? 'empty' : 'set'} → ${blank(y) ? 'empty' : 'set'}`);
      else if (!blank(x)) secrets.push(k);
      continue;
    }
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    let line;
    if (!(k in a)) line = `only new  ${k} = ${show(y)}`;
    else if (!(k in b)) line = `only old  ${k} = ${show(x)}`;
    else if (typeof x === 'string' && typeof y === 'string' && (x.length > 100 || y.length > 100)) {
      let i = 0;
      while (i < x.length && x[i] === y[i]) i++;
      line = `differs   ${k}: ${x.length} → ${y.length} chars, first difference at char ${i}`;
    } else line = `differs   ${k}: ${show(x)} → ${show(y)}`;
    (isProjectSpecific(k) ? specific : real).push(line);
  }
  return { real, secrets, specific };
}

function compare(oldDir, newDir) {
  const o = readDir(oldDir);
  const n = readDir(newDir);
  let total = 0;
  for (const name of Object.keys(ENDPOINTS)) {
    if (NOT_COMPARED.includes(name)) continue;
    const so = o.index.endpoints[name];
    const sn = n.index.endpoints[name];
    if (so !== sn) {
      console.log(`\n## ${name}: answered ${so} on the old project, ${sn} on the new one`);
      total++;
    }
    if (!o.files[name] || !n.files[name]) continue;
    const { real, secrets, specific } = compareFlat(flatten(o.files[name]), flatten(n.files[name]));
    if (!real.length && !secrets.length && !specific.length) continue;
    console.log(`\n## ${name}`);
    for (const l of real) console.log('  ' + l);
    if (specific.length) console.log(`  (project-specific, expected to differ: ${specific.length} value(s))`);
    for (const l of specific) console.log('    ' + l);
    if (secrets.length) console.log(`  secrets set on both, test them instead: ${secrets.join(', ')}`);
    total += real.length;
  }
  console.log(`\n${total} difference(s) to look at (project-specific values and secrets not counted).`);
  console.log(`Not compared (differ by design, read them by hand): ${NOT_COMPARED.join(', ')}.`);
  if (total) process.exitCode = 1;
}

async function applyAuth(oldDir, ref, { dryRun, skip }) {
  const old = JSON.parse(fs.readFileSync(path.join(oldDir, 'auth.json'), 'utf8'));
  const cur = await api('GET', `/v1/projects/${ref}/config/auth`);
  if (cur.status !== 200) throw new Error(`Reading ${ref}'s Auth settings failed: ${cur.status} ${show(cur.json)}`);
  const body = {};
  const secretsNeeded = [];
  for (const [k, v] of Object.entries(old)) {
    if (skip.includes(k)) continue;
    if (isSecret(k, v)) {
      const given = process.env[`SECRET_${k.toUpperCase()}`];
      if (given) body[k] = given;
      else if (!blank(v)) secretsNeeded.push(k);
      continue;
    }
    // Only what differs; null means "never set" on the old project, so the new project's default stays
    if (v === null || JSON.stringify(v) === JSON.stringify(cur.json[k])) continue;
    body[k] = v;
  }
  const keys = Object.keys(body);
  console.log(`${keys.length} Auth setting(s) to change on ${ref}:`);
  for (const k of keys) console.log(`  ${k} = ${isSecret(k, body[k]) ? '(secret from SECRET_' + k.toUpperCase() + ')' : show(body[k])}`);
  if (secretsNeeded.length) {
    console.log(`\nSet on the old project but not given, so NOT copied (set SECRET_<FIELD> or type them in the Dashboard):`);
    for (const k of secretsNeeded) console.log(`  ${k}   (SECRET_${k.toUpperCase()})`);
  }
  if (dryRun || !keys.length) return;

  const all = await api('PATCH', `/v1/projects/${ref}/config/auth`, body);
  if (all.status >= 200 && all.status < 300) console.log(`\nSent all ${keys.length} in one request.`);
  else {
    // One bad field (a Pro-only option on a Free project, a field the API no longer takes) fails the whole
    // request, so fall back to smaller requests. Fields that only work as a set go together: custom SMTP is
    // accepted only complete (one field alone is answered 200 and dropped), likewise a provider's or the CAPTCHA's
    // fields. Others depend on an earlier set (email templates need custom SMTP), so refused units are retried
    // until a pass changes nothing.
    console.log(`\nThe single request was refused (${all.status}: ${show(all.json?.message ?? all.json)}). Sending in groups…`);
    const unitOf = (k) =>
      k.startsWith('smtp_') || k === 'rate_limit_email_sent' ? 'smtp' : (/^(external_[a-z0-9]+|security_captcha|hook_[a-z_]+?)_/.exec(k)?.[1] ?? k);
    const units = new Map();
    for (const k of keys) units.set(unitOf(k), [...(units.get(unitOf(k)) ?? []), k]);
    let left = [...units.keys()];
    let refused = new Map();
    for (let pass = 1; left.length; pass++) {
      refused = new Map();
      for (const u of left) {
        const part = Object.fromEntries(units.get(u).map((k) => [k, body[k]]));
        const r = await api('PATCH', `/v1/projects/${ref}/config/auth`, part);
        if (r.status >= 300) refused.set(u, `${units.get(u).join(', ')}: ${r.status} ${show(r.json?.message ?? r.json)}`);
        await sleep(600);
      }
      console.log(`Pass ${pass}: ${left.length - refused.size} of ${left.length} group(s) accepted.`);
      if (refused.size === left.length) break;
      left = [...refused.keys()];
    }
    if (refused.size) {
      console.log('Refused (set by hand, or again after the project is on Pro):');
      for (const l of refused.values()) console.log('  ' + l);
    }
  }
  // An accepted request isn't proof: read the settings back. Secrets can't be compared (masked), only their presence
  const after = await api('GET', `/v1/projects/${ref}/config/auth`);
  const notStored = keys.filter((k) =>
    isSecret(k, body[k]) ? blank(after.json?.[k]) : JSON.stringify(after.json?.[k]) !== JSON.stringify(body[k]),
  );
  console.log(`\nRead back: ${keys.length - notStored.length} of ${keys.length} saved on ${ref}.`);
  if (notStored.length) {
    console.log(`Not saved: ${notStored.join(', ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, a, b, ...rest] = process.argv.slice(2);
  const flag = (name) => rest.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  try {
    if (cmd === 'export' && a && b) await exportSettings(a, b);
    else if (cmd === 'compare' && a && b) compare(a, b);
    else if (cmd === 'apply-auth' && a && b)
      await applyAuth(a, b, { dryRun: !!flag('dry-run'), skip: (flag('skip')?.split('=')[1] ?? '').split(',').filter(Boolean) });
    else {
      console.log('Usage: node settings.mjs export <ref> <dir> | compare <old-dir> <new-dir> | apply-auth <old-dir> <ref> [--dry-run] [--skip=a,b]');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
