/**
 * Poll the app's process stats while a load test runs, so you can see WHERE it saturates.
 *
 *   LOADTEST_BASE_URL=https://staging.example.com LOADTEST_CRON_SECRET=... \
 *     bun load-test/monitor.ts [--interval 2000]
 *
 * Reads GET /api/health?stats=1 (authorised with the app's CRON_SECRET) and prints one line per
 * sample: event-loop delay p99, in-flight guarded requests, requests shed with 503, RSS/heap.
 * Also appends CSV rows to load-test/.data/monitor-<timestamp>.csv. Ctrl-C to stop.
 *
 * What to look for: eventLoopLagP99Ms climbing past ~200 ms means the single Node process is the
 * bottleneck (CPU-bound); a rising rssMb that never falls means a leak; shed>0 means the built-in
 * load shedder (LOAD_SHED_*) engaged.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.LOADTEST_BASE_URL?.replace(/\/$/, '');
const secret = process.env.LOADTEST_CRON_SECRET;
if (!baseUrl || !secret) {
  console.error('Set LOADTEST_BASE_URL and LOADTEST_CRON_SECRET (the target app\'s CRON_SECRET).');
  process.exit(1);
}

const i = process.argv.indexOf('--interval');
const intervalMs = i === -1 ? 2_000 : Math.max(500, Number(process.argv[i + 1]) || 2_000);

interface Stats {
  uptimeSeconds: number;
  load: { inflight: number; eventLoopLagP99Ms: number; shedTotal: number; rssMb: number; heapUsedMb: number };
}

async function main() {
  const dataDir = path.join(__dirname, '.data');
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, `monitor-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  await appendFile(file, 'time,rttMs,eventLoopLagP99Ms,inflight,shedTotal,rssMb,heapUsedMb\n');
  console.log(`sampling ${baseUrl}/api/health?stats=1 every ${intervalMs} ms -> ${path.relative(process.cwd(), file)}\n`);
  console.log('time      rtt(ms)  loopLagP99(ms)  inflight  shed  rss(MB)  heap(MB)');

  for (;;) {
    const started = Date.now();
    try {
      const res = await fetch(`${baseUrl}/api/health?stats=1`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(10_000),
      });
      const rtt = Date.now() - started;
      if (!res.ok) {
        console.log(`${new Date().toISOString().slice(11, 19)}  HTTP ${res.status} after ${rtt} ms`);
      } else {
        const { load } = (await res.json()) as Stats;
        const time = new Date().toISOString();
        console.log(
          `${time.slice(11, 19)}  ${String(rtt).padStart(7)}  ${String(load.eventLoopLagP99Ms).padStart(14)}  ` +
            `${String(load.inflight).padStart(8)}  ${String(load.shedTotal).padStart(4)}  ` +
            `${String(load.rssMb).padStart(7)}  ${String(load.heapUsedMb).padStart(8)}`
        );
        await appendFile(file, `${time},${rtt},${load.eventLoopLagP99Ms},${load.inflight},${load.shedTotal},${load.rssMb},${load.heapUsedMb}\n`);
      }
    } catch (error) {
      // A timeout here IS a finding: the process could not answer a trivial request in 10 s
      console.log(`${new Date().toISOString().slice(11, 19)}  no response (${error instanceof Error ? error.message : error})`);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - (Date.now() - started))));
  }
}

main();
