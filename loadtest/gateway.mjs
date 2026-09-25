// Fake Supabase edge: /rest/v1 -> PostgREST, /auth/v1/user -> JWT decode. Counts upstream calls.
import http from 'http';
import crypto from 'crypto';
import { SECRET } from './keys.mjs';
const PGRST = { host: '127.0.0.1', port: 3001 };
const AUTH_LATENCY = +(process.env.AUTH_LATENCY || 20); // simulate network RTT to Supabase Auth
const NET_LATENCY = +(process.env.NET_LATENCY || 20);   // simulate RTT to Supabase REST
const counts = {};
const agent = new http.Agent({ keepAlive: true, maxSockets: 512 });
function verify(tok) {
  const [h, p, s] = tok.split('.');
  const ok = crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url') === s;
  return ok ? JSON.parse(Buffer.from(p, 'base64url')) : null;
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__stats') { res.end(JSON.stringify(counts)); return; }
  if (u.pathname === '/__reset') { for (const k in counts) delete counts[k]; res.end('ok'); return; }
  const key = req.method + ' ' + u.pathname.replace(/\/rpc\//, '/rpc/').replace(/(rest\/v1\/)([^/?]+).*/, '$1$2');
  counts[key] = (counts[key] || 0) + 1;
  if (u.pathname.startsWith('/auth/v1/user')) {
    const tok = (req.headers.authorization || '').replace('Bearer ', '');
    const c = verify(tok);
    setTimeout(() => {
      if (!c || !c.sub) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"code":401,"msg":"invalid"}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: c.sub, aud: 'authenticated', role: 'authenticated', email: c.email, user_metadata: c.user_metadata, app_metadata: c.app_metadata, created_at: '2026-01-01T00:00:00Z' }));
    }, AUTH_LATENCY);
    return;
  }
  if (u.pathname.startsWith('/rest/v1')) {
    const path = req.url.replace('/rest/v1', '') || '/';
    const headers = { ...req.headers, host: 'localhost:3001' };
    setTimeout(() => {
      const p = http.request({ ...PGRST, path, method: req.method, headers, agent }, (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
      p.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
      req.pipe(p);
    }, NET_LATENCY / 2);
    return;
  }
  res.writeHead(404); res.end('{}');
}).listen(54321, () => console.log('gateway on 54321'));
