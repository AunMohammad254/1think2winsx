import { cookieFor } from './keys.mjs';
import { Agent, request } from 'undici';
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const CONC = +(process.env.CONC || 100), DUR = +(process.env.DUR || 30) * 1000;
const ONLY = process.env.ONLY; // run a single scenario
const agent = new Agent({ connections: CONC * 2, pipelining: 1, keepAliveTimeout: 10000 });
const cookies = new Map();
const ck = (n) => { let c = cookies.get(n); if (!c) { c = cookieFor(n); cookies.set(n, c); } return c; };
const rnd = (n) => 1 + Math.floor(Math.random() * n);
const answers = (q) => JSON.stringify({ answers: Array.from({ length: 20 }, (_, i) => ({ questionId: `q${q}_${i + 1}`, selectedOption: rnd(4) - 1 })) });
const SCEN = {
  quizList:   { w: 40, f: (u) => ({ path: '/api/quizzes', method: 'GET', headers: { cookie: ck(u) } }) },
  leaderboard:{ w: 20, f: () => ({ path: `/api/leaderboard?limit=10&timeframe=${['allTime','weekly','monthly'][rnd(3)-1]}`, method: 'GET', headers: {} }) },
  quizDetail: { w: 15, f: (u) => ({ path: `/api/quizzes/quiz${rnd(5)}`, method: 'GET', headers: { cookie: ck(u) } }) },
  submit:     { w: 10, f: (u) => { const q = rnd(5); return { path: `/api/quizzes/quiz${q}/submit`, method: 'POST', headers: { cookie: ck(u), 'content-type': 'application/json', 'x-csrf-token': 'x'.repeat(43), origin: BASE }, body: answers(q) }; } },
  landing:    { w: 15, f: () => ({ path: '/', method: 'GET', headers: {} }) },
};
const names = ONLY ? [ONLY] : Object.keys(SCEN);
const bag = names.flatMap((n) => Array(SCEN[n].w).fill(n));
const stats = {}; const all = [];
let stop = false;
async function worker() {
  while (!stop) {
    const name = bag[Math.floor(Math.random() * bag.length)];
    const r = SCEN[name].f(rnd(50000));
    const t = performance.now(); let code = 0;
    try { const res = await request(BASE + r.path, { method: r.method, headers: r.headers, body: r.body, dispatcher: agent, headersTimeout: 60000, bodyTimeout: 60000 }); code = res.statusCode; await res.body.dump(); } catch { code = -1; }
    const dt = performance.now() - t;
    const s = (stats[name] ||= { n: 0, lat: [], codes: {} }); s.n++; s.lat.push(dt); s.codes[code] = (s.codes[code] || 0) + 1; all.push(dt);
  }
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
await fetch('http://127.0.0.1:54321/__reset');
const t0 = Date.now(); setTimeout(() => (stop = true), DUR);
await Promise.all(Array.from({ length: CONC }, worker));
const secs = (Date.now() - t0) / 1000;
const up = await (await fetch('http://127.0.0.1:54321/__stats')).json();
const upTotal = Object.values(up).reduce((a, b) => a + b, 0);
const out = { conc: CONC, secs, total: all.length, rps: +(all.length / secs).toFixed(1), p50: +pct(all, .5).toFixed(0), p95: +pct(all, .95).toFixed(0), p99: +pct(all, .99).toFixed(0), upstreamCalls: upTotal, upstreamPerReq: +(upTotal / all.length).toFixed(2), scenarios: {} };
for (const [k, s] of Object.entries(stats)) out.scenarios[k] = { n: s.n, p50: +pct(s.lat, .5).toFixed(0), p95: +pct(s.lat, .95).toFixed(0), codes: s.codes };
out.upstream = up;
console.log(JSON.stringify(out, null, 1));
process.exit(0);
