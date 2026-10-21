#!/usr/bin/env node
// Copies Supabase Storage through a local folder, for deploy/private/SUPABASE_MUMBAI_SWITCH.md. The folder is
// also the archive: every bucket's settings and every file, kept after the old project is deleted.
//
//   node storage-copy.mjs download <dir>   old project → <dir>/files/<bucket>/<name> + <dir>/manifest.json
//   node storage-copy.mjs upload <dir> [--skip=bucket,...]
//                                          <dir> → new project: same bucket settings, content type, cache-control
//   node storage-copy.mjs verify <dir> [--skip=bucket,...]
//                                          the project's buckets and files against manifest.json
//
// The project comes from SUPABASE_URL and SUPABASE_SECRET_KEY (secret or service_role key; it bypasses RLS, so
// keep it out of files). Both download and upload skip files that are already there with the same size, so
// running them again (the second pass in the switch window) only moves what changed.
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

// Windows can't store these characters in a file name; the manifest keeps the real object name
const localName = (name) => name.replace(/[<>:"|?*\\]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function client() {
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY for the project first');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function listAll(sb, bucket, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Listing ${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) out.push(...(await listAll(sb, bucket, name))); // a folder
      else out.push({ name, size: item.metadata?.size ?? null, mimetype: item.metadata?.mimetype ?? null, cacheControl: item.metadata?.cacheControl ?? null });
    }
    if (data.length < 1000) return out;
  }
}

async function listBuckets(sb) {
  const { data, error } = await sb.storage.listBuckets();
  if (error) throw new Error(`Listing buckets: ${error.message}`);
  return data
    .map((b) => ({ id: b.id, public: b.public, file_size_limit: b.file_size_limit ?? null, allowed_mime_types: b.allowed_mime_types ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const sizeOnDisk = (f) => (fs.existsSync(f) ? fs.statSync(f).size : -1);

async function download(dir) {
  const sb = client();
  const buckets = await listBuckets(sb);
  const objects = [];
  let fetched = 0;
  for (const b of buckets) {
    const list = await listAll(sb, b.id);
    for (const o of list) {
      const file = path.join(dir, 'files', b.id, ...localName(o.name).split('/'));
      if (sizeOnDisk(file) !== o.size) {
        const { data, error } = await sb.storage.from(b.id).download(o.name);
        if (error) throw new Error(`Downloading ${b.id}/${o.name}: ${error.message}`);
        const buf = Buffer.from(await data.arrayBuffer());
        if (o.size !== null && buf.length !== o.size) throw new Error(`${b.id}/${o.name}: got ${buf.length} bytes, expected ${o.size}`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buf);
        fetched++;
      }
      objects.push({ bucket: b.id, ...o, file: path.relative(dir, file).split(path.sep).join('/') });
    }
    const bytes = list.reduce((s, o) => s + (o.size ?? 0), 0);
    console.log(`${b.id.padEnd(14)} ${String(list.length).padStart(4)} files ${(bytes / 1048576).toFixed(1).padStart(6)} MB  public=${b.public} limit=${b.file_size_limit ?? '-'} types=${b.allowed_mime_types?.join('|') ?? '-'}`);
  }
  // A file deleted on the project since an earlier run stays on disk but leaves the manifest, so it isn't uploaded
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ source: url, downloadedAt: new Date().toISOString(), buckets, objects }, null, 2) + '\n');
  console.log(`\n${objects.length} files in ${buckets.length} buckets; downloaded ${fetched}, already had ${objects.length - fetched}. Wrote ${path.join(dir, 'manifest.json')}.`);
}

const readManifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

async function upload(dir, skip) {
  const sb = client();
  const m = readManifest(dir);
  if (m.source === url) throw new Error(`manifest.json was downloaded from ${url}: refusing to upload into the same project`);
  const existing = new Map((await listBuckets(sb)).map((b) => [b.id, b]));
  let sent = 0;
  for (const b of m.buckets) {
    if (skip.includes(b.id)) {
      console.log(`${b.id}: skipped (--skip)`);
      continue;
    }
    const settings = { public: b.public, fileSizeLimit: b.file_size_limit, allowedMimeTypes: b.allowed_mime_types };
    const { error } = existing.has(b.id) ? await sb.storage.updateBucket(b.id, settings) : await sb.storage.createBucket(b.id, settings);
    if (error) throw new Error(`Bucket ${b.id}: ${error.message}`);
    const there = new Map((await listAll(sb, b.id)).map((o) => [o.name, o.size]));
    const mine = m.objects.filter((o) => o.bucket === b.id);
    for (const o of mine) {
      if (there.get(o.name) === o.size) continue;
      const body = fs.readFileSync(path.join(dir, o.file));
      const maxAge = /max-age=(\d+)/.exec(o.cacheControl ?? '')?.[1];
      const { error: e } = await sb.storage
        .from(b.id)
        .upload(o.name, body, { contentType: o.mimetype ?? undefined, cacheControl: maxAge, upsert: true });
      if (e) throw new Error(`Uploading ${b.id}/${o.name}: ${e.message}`);
      sent++;
    }
    console.log(`${b.id.padEnd(14)} ${existing.has(b.id) ? 'updated ' : 'created '} ${mine.length} files in manifest`);
  }
  console.log(`\nUploaded ${sent} file(s). Run verify next.`);
}

async function verify(dir, skip) {
  const sb = client();
  const m = readManifest(dir);
  const live = new Map((await listBuckets(sb)).map((b) => [b.id, b]));
  const problems = [];
  for (const b of m.buckets.filter((x) => !skip.includes(x.id))) {
    const l = live.get(b.id);
    if (!l) {
      problems.push(`bucket ${b.id}: missing`);
      continue;
    }
    for (const k of ['public', 'file_size_limit', 'allowed_mime_types'])
      if (JSON.stringify(l[k]) !== JSON.stringify(b[k])) problems.push(`bucket ${b.id}: ${k} is ${JSON.stringify(l[k])}, manifest says ${JSON.stringify(b[k])}`);
    const there = new Map((await listAll(sb, b.id)).map((o) => [o.name, o]));
    const mine = m.objects.filter((o) => o.bucket === b.id);
    for (const o of mine) {
      const t = there.get(o.name);
      if (!t) problems.push(`${b.id}/${o.name}: missing`);
      else {
        for (const k of ['size', 'mimetype', 'cacheControl'])
          if (t[k] !== o[k]) problems.push(`${b.id}/${o.name}: ${k} is ${JSON.stringify(t[k])}, manifest says ${JSON.stringify(o[k])}`);
        there.delete(o.name);
      }
    }
    for (const name of there.keys()) problems.push(`${b.id}/${name}: on the project but not in the manifest`);
    console.log(`${b.id.padEnd(14)} ${mine.length} in manifest`);
  }
  for (const id of live.keys()) if (!m.buckets.some((b) => b.id === id)) problems.push(`bucket ${id}: on the project but not in the manifest`);
  console.log(problems.length ? `\n${problems.length} difference(s):\n  ${problems.join('\n  ')}` : '\nEverything matches the manifest.');
  if (problems.length) process.exitCode = 1;
}

const [cmd, dir, ...rest] = process.argv.slice(2);
const skip = (rest.find((x) => x.startsWith('--skip='))?.slice(7) ?? '').split(',').filter(Boolean);
try {
  if (cmd === 'download' && dir) await download(dir);
  else if (cmd === 'upload' && dir) await upload(dir, skip);
  else if (cmd === 'verify' && dir) await verify(dir, skip);
  else {
    console.log('Usage: node storage-copy.mjs download <dir> | upload <dir> [--skip=bucket,...] | verify <dir> [--skip=bucket,...]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
