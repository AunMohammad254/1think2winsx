/**
 * In-memory stand-in for a Supabase client, shared by the route, action and db-module tests.
 *
 * Every query builder call (`from('T').select().eq(...)...`) is recorded and the chain resolves
 * to whatever the test configured for that table, so a test can both feed rows in and assert on
 * what the code asked for (filters, inserted rows, updated fields).
 */
import { vi } from 'vitest';
import { NextRequest } from 'next/server';

export type MockResult = { data?: unknown; error?: unknown; count?: number | null };

/** One recorded builder chain: the table plus every method called on it, in order. */
export interface QueryCall {
  table: string;
  ops: { op: string; args: unknown[] }[];
}

type TableHandler = MockResult | MockResult[] | ((call: QueryCall) => MockResult);
type RpcHandler = MockResult | ((args: Record<string, unknown>) => MockResult);

export interface MockUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  identities?: unknown[];
}

export interface SupabaseMockOptions {
  /** Per-table result ('*' for any table). An array is consumed one entry per query, the last entry repeating. */
  tables?: Record<string, TableHandler>;
  rpc?: Record<string, RpcHandler>;
  /** The signed-in user, or null for an anonymous client. */
  user?: MockUser | null;
}

/** Returns the first argument of the first call to `op` in a recorded chain. */
export function argOf(call: QueryCall | undefined, op: string): unknown {
  return call?.ops.find((o) => o.op === op)?.args[0];
}

/** True when the chain contains `op` (e.g. 'insert', 'update', 'delete'). */
export function hasOp(call: QueryCall | undefined, op: string): boolean {
  return !!call?.ops.some((o) => o.op === op);
}

/** Returns the value passed to `.eq(column, value)` in a chain. */
export function eqValue(call: QueryCall | undefined, column: string): unknown {
  return call?.ops.find((o) => o.op === 'eq' && o.args[0] === column)?.args[1];
}

export function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const tables: Record<string, TableHandler> = { ...(options.tables || {}) };
  const rpcs: Record<string, RpcHandler> = { ...(options.rpc || {}) };
  const counters: Record<string, number> = {};
  const calls: QueryCall[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  let user: MockUser | null = options.user === undefined ? null : options.user;

  const resolveTable = (call: QueryCall): MockResult => {
    // '*' answers every table that has no handler of its own
    const handler = tables[call.table] ?? tables['*'];
    if (handler === undefined) return { data: null, error: null };
    if (typeof handler === 'function') return handler(call);
    if (Array.isArray(handler)) {
      const i = counters[call.table] ?? 0;
      counters[call.table] = i + 1;
      return handler[Math.min(i, handler.length - 1)] ?? { data: null, error: null };
    }
    return handler;
  };

  const builder = (table: string) => {
    const call: QueryCall = { table, ops: [] };
    calls.push(call);
    const settle = () => {
      const r = resolveTable(call);
      return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
    };
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
              Promise.resolve().then(settle).then(onOk, onErr);
          }
          if (prop === 'catch' || prop === 'finally') {
            const p = Promise.resolve().then(settle);
            return (p as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string].bind(p);
          }
          if (typeof prop === 'symbol') return undefined;
          return (...args: unknown[]) => {
            call.ops.push({ op: prop, args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const sessionFor = (u: MockUser | null) =>
    u ? { access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_at: 4102444800, user: u } : null;

  const auth = {
    getClaims: vi.fn(async () =>
      user
        ? { data: { claims: { sub: user.id, email: user.email, user_metadata: user.user_metadata || {} } }, error: null }
        : { data: null, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' } },
    ),
    getUser: vi.fn(async () =>
      user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'Auth session missing!' } },
    ),
    getSession: vi.fn(async () => ({ data: { session: sessionFor(user) }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { user, session: sessionFor(user) }, error: null })),
    signUp: vi.fn(async () => ({ data: { user, session: sessionFor(user) }, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: { url: 'https://accounts.example.test/oauth' }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ data: { user }, error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { user, session: sessionFor(user) }, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { user, session: sessionFor(user) }, error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    admin: {
      getUserById: vi.fn(async () => ({ data: { user }, error: null })),
      listUsers: vi.fn(async () => ({ data: { users: user ? [user] : [] }, error: null })),
      updateUserById: vi.fn(async () => ({ data: { user }, error: null })),
      deleteUser: vi.fn(async () => ({ data: {}, error: null })),
      createUser: vi.fn(async () => ({ data: { user }, error: null })),
      generateLink: vi.fn(async () => ({ data: { properties: { action_link: 'https://example.test/link' } }, error: null })),
    },
  };

  const bucketApi = {
    upload: vi.fn(async (path: string) => ({ data: { path }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://storage.example.test/${path}` } })),
    createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://storage.example.test/${path}?sig=1` }, error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
  };

  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn((cb?: (status: string) => void) => {
      cb?.('SUBSCRIBED');
      return channel;
    }),
    send: vi.fn(async () => 'ok'),
    unsubscribe: vi.fn(async () => 'ok'),
  };

  const client = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn((fn: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ fn, args });
      const handler = rpcs[fn];
      const r: MockResult = handler === undefined ? { data: null, error: null } : typeof handler === 'function' ? handler(args) : handler;
      const result = { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
      // rpc() is awaited directly but some callers chain .single()/.maybeSingle() first
      const thenable: Record<string, unknown> = {
        then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, err),
      };
      for (const m of ['single', 'maybeSingle', 'select', 'abortSignal', 'returns']) thenable[m] = () => thenable;
      return thenable;
    }),
    auth,
    storage: { from: vi.fn(() => bucketApi) },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => 'ok'),
  };

  return {
    client,
    auth,
    storage: bucketApi,
    channel,
    /** Every `from()` chain the code built, in order. */
    calls,
    rpcCalls,
    /** Chains for one table, optionally only those containing a given op ('insert', 'update', ...). */
    callsTo(table: string, op?: string) {
      return calls.filter((c) => c.table === table && (!op || hasOp(c, op)));
    },
    setTable(table: string, handler: TableHandler) {
      tables[table] = handler;
      delete counters[table];
    },
    setRpc(fn: string, handler: RpcHandler) {
      rpcs[fn] = handler;
    },
    setUser(next: MockUser | null) {
      user = next;
    },
  };
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;

/** Builds a NextRequest with an optional JSON body. */
export function makeRequest(
  url: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string } = {},
) {
  const headers: Record<string, string> = { ...(init.headers || {}) };
  let body: string | undefined;
  if (init.rawBody !== undefined) body = init.rawBody;
  else if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers['content-type'] ??= 'application/json';
  }
  const full = url.startsWith('http') ? url : `http://localhost${url}`;
  return new NextRequest(full, { method: init.method || (body !== undefined ? 'POST' : 'GET'), headers, body });
}

/** The `{ params }` second argument Next passes to dynamic route handlers. */
export function routeParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

/** A successful `requireAuth()` result for the given user. */
export function authOk(id = 'user-1', email = 'player@example.test', extra: Record<string, unknown> = {}) {
  return {
    session: { user: { id, email, user_metadata: {} }, expires: new Date(Date.now() + 86_400_000).toISOString() },
    user: { id, email, name: email.split('@')[0], image: undefined, ...extra },
  };
}

/** Argument `arg` of call `call` on a vi.fn() whose parameters are untyped (its calls are typed as `[]`). */
export const mockArg = (fn: { mock: { calls: unknown } }, call = 0, arg = 0): any => (fn.mock.calls as unknown[][])[call][arg];
