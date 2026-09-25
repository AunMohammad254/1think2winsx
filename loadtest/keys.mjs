import crypto from 'crypto';
export const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
export function sign(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64(payload);
  const s = crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url');
  return `${h}.${p}.${s}`;
}
export const ANON = sign({ role: 'anon', iss: 'supabase', exp: 2000000000 });
export const SERVICE = sign({ role: 'service_role', iss: 'supabase', exp: 2000000000 });
export function userId(n) { return [...Buffer.from(crypto.createHash('md5').update('u' + n).digest())].map(b=>b.toString(16).padStart(2,'0')).join('').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
export function userToken(n) {
  const id = userId(n);
  return sign({ sub: id, role: 'authenticated', aud: 'authenticated', email: `user${n}@test.pk`, exp: 2000000000, iat: 1700000000, session_id: 's' + n, user_metadata: { name: 'User ' + n }, app_metadata: { provider: 'email' } });
}
export function cookieFor(n) {
  const at = userToken(n); const id = userId(n);
  const session = { access_token: at, refresh_token: 'r' + n, expires_at: 2000000000, expires_in: 3600, token_type: 'bearer', user: { id, aud: 'authenticated', role: 'authenticated', email: `user${n}@test.pk`, user_metadata: { name: 'User ' + n }, app_metadata: { provider: 'email' } } };
  return 'sb-127-auth-token=base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
}
if (process.argv[2] === 'print') console.log(JSON.stringify({ ANON, SERVICE, cookie: cookieFor(7) }));
