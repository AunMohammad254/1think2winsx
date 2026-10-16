// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, makeRequest, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let adminDb: SupabaseMock;
const auth = vi.fn();
const fetchMock = vi.fn();
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));
vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }));

let POST: typeof import('@/app/api/chatbot/route').POST;
const gemini = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
const hello = [{ role: 'user', parts: [{ text: 'hi' }] }];
const chat = (messages: unknown = hello, ip = '1.2.3.4') => POST(makeRequest('/api/chatbot', { body: { messages }, headers: { 'x-forwarded-for': ip } }));
const sentBody = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body);

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('GEMINI_API_KEY', 'gkey');
  ({ POST } = await import('@/app/api/chatbot/route'));
  adminDb = createSupabaseMock({ tables: { Quiz: { data: [{ title: 'Cricket', accessPrice: 2, duration: 10, passingScore: 60 }] } } });
  auth.mockReset().mockResolvedValue(null);
  fetchMock.mockReset().mockImplementation(async () => gemini('Hello! [REDIRECT:/quizzes] Join now [REDIRECT:/prizes]'));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('POST /api/chatbot', () => {
  it('answers with the primary model and pulls out redirect markers', async () => {
    const res = await chat();
    expect(await res.json()).toEqual({ message: 'Hello!  Join now', redirects: ['/quizzes', '/prizes'], model: 'Gemini 3 Flash' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent?key=gkey');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = sentBody();
    expect(body.contents).toEqual(hello);
    expect(body.system_instruction.parts[0].text).toContain('- "Cricket": Entry Fee PKR 2, Duration 10 min, Passing Score 60%');
    expect(body.generationConfig.maxOutputTokens).toBe(512);
  });

  it("adds a signed-in player's profile, rank, attempts and redemptions to the prompt (sent to Gemini)", async () => {
    auth.mockResolvedValue({ user: { id: 'user-1' } });
    adminDb.setTable('User', (call) => (call.ops.some((o) => o.op === 'gt') ? { count: 4 } : { data: { name: 'Ali', email: 'ali@example.test', points: 120, walletBalance: 30 } }));
    adminDb.setTable('QuizAttempt', { data: [{ id: 'a1', score: 80, points: 8, isCompleted: true }, { id: 'a2', score: 0, points: 0, isCompleted: false }] });
    adminDb.setTable('PrizeRedemption', { data: [{ prizeId: 'p1', pointsUsed: 100, status: 'pending', requestedAt: '2026-10-01', notes: null }, { prizeId: 'gone', pointsUsed: 5, status: 'approved', requestedAt: '2026-10-02', notes: 'shipped' }] });
    adminDb.setTable('Prize', (call) => ({ data: call.ops.find((o) => o.op === 'eq')?.args[1] === 'p1' ? { name: 'Watch' } : null }));

    await chat();
    const prompt = sentBody().system_instruction.parts[0].text as string;

    expect(prompt).toContain('- Email: ali@example.test');
    expect(prompt).toContain('- Wallet Balance: PKR 30');
    expect(prompt).toContain('- Current Leaderboard Rank: #5');
    expect(prompt).toContain('Quiz Attempt ID a1: Score 80%, Points Earned 8, Completed: Yes');
    expect(prompt).toContain('Prize: "Watch", Points: 100, Status: pending');
    expect(prompt).toContain('Prize: "Unknown Prize"');
    expect(prompt).toContain('Notes: shipped');
  });

  it('describes a player with no history and defaults missing profile fields', async () => {
    auth.mockResolvedValue({ user: { id: 'user-1' } });
    adminDb.setTable('User', (call) => (call.ops.some((o) => o.op === 'gt') ? { count: null } : { data: { email: 'x@y' } }));
    adminDb.setTable('QuizAttempt', { data: [] });
    adminDb.setTable('PrizeRedemption', { data: null });
    await chat();
    const prompt = sentBody().system_instruction.parts[0].text as string;
    expect(prompt).toContain('- Name: User');
    expect(prompt).toContain('- Current Leaderboard Rank: #1');
    expect(prompt).toContain('No quiz attempts recorded.');
    expect(prompt).toContain('No prize redemptions requested yet.');
  });

  it('skips the profile block when the row is missing and survives lookup failures', async () => {
    auth.mockResolvedValue({ user: { id: 'user-1' } });
    adminDb.setTable('User', { data: null });
    await chat();
    expect(sentBody(0).system_instruction.parts[0].text).not.toContain('USER STATUS');
    adminDb.client.from.mockImplementation(() => { throw new Error('db down'); });
    await chat(hello, '5.5.5.5');
    expect(console.error).toHaveBeenCalledWith('[Chatbot] Failed to query user context data:', expect.any(Error));
  });

  it('caches the active quizzes for 30 seconds and falls back to a default text', async () => {
    await chat();
    await chat(hello, '9.9.9.9');
    expect(adminDb.callsTo('Quiz')).toHaveLength(1);

    vi.resetModules();
    ({ POST } = await import('@/app/api/chatbot/route'));
    adminDb.setTable('Quiz', { data: [] });
    await chat();
    expect(sentBody(2).system_instruction.parts[0].text).toContain('No active quizzes currently.');

    vi.resetModules();
    ({ POST } = await import('@/app/api/chatbot/route'));
    adminDb.client.from.mockImplementation(() => { throw new Error('quiz read failed'); });
    await chat();
    expect(console.error).toHaveBeenCalledWith('[Chatbot] Failed to query active quizzes:', expect.any(Error));
  });

  it('falls back to the next model when one fails or returns nothing', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('quota', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] })))
      .mockResolvedValueOnce(gemini('third time lucky'));
    const body = await (await chat()).json();
    expect(body).toEqual({ message: 'third time lucky', redirects: [], model: 'Gemini 3.5 Flash Lite' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('answers 502 when every model fails', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    const res = await chat();
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('rate-limits per IP and per model, with a retry hint', async () => {
    fetchMock.mockRejectedValue(new Error('network')); // every call consumes a token on every model
    for (let i = 0; i < 4; i++) await chat(hello, '7.7.7.7');
    fetchMock.mockClear();
    // the 4-rpm models are now empty for this IP, the 14-rpm ones are not
    await chat(hello, '7.7.7.7');
    expect(fetchMock.mock.calls.map((c) => (c[0] as string).match(/models\/([^:]+)/)![1])).toEqual(['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.0-flash-lite']);

    for (let i = 0; i < 20; i++) await chat(hello, '7.7.7.7');
    const res = await chat(hello, '7.7.7.7');
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ rateLimited: true });
    expect(body.error).toMatch(/^You're sending messages too fast! Please wait \d+ seconds? before trying again/);
    // another IP is unaffected
    fetchMock.mockImplementation(async () => gemini('ok'));
    expect((await chat(hello, '8.8.8.8')).status).toBe(200);
  });

  it('says "1 second" when the next token is under a second away', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    fetchMock.mockRejectedValue(new Error('network'));
    // Every request tries each model that still has a token, so 14 requests empty all of them
    for (let i = 0; i < 14; i++) await chat(hello, '5.5.5.5');
    clock.mockReturnValue(now + 3_785); // the 14-rpm models refill every 4,285 ms, so 500 ms remain
    expect((await (await chat(hello, '5.5.5.5')).json()).error).toMatch(/Please wait 1 second before/);
    clock.mockRestore();
  });

  it('refills tokens over time', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    fetchMock.mockRejectedValue(new Error('network'));
    for (let i = 0; i < 4; i++) await chat(hello, '6.6.6.6');
    fetchMock.mockReset().mockImplementation(async () => gemini('back'));
    clock.mockReturnValue(now + 60_000);
    expect((await (await chat(hello, '6.6.6.6')).json()).model).toBe('Gemini 3 Flash');
    clock.mockRestore();
  });

  it('gives up walking the fallback chain after the 15 s budget', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    fetchMock.mockImplementation(async () => {
      clock.mockReturnValue(start + 16_000);
      throw new Error('slow');
    });
    const res = await chat();
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock.mockRestore();
  });

  it('answers 503 when too many Gemini calls are already in flight', async () => {
    vi.stubEnv('CHATBOT_MAX_CONCURRENT', '1');
    vi.resetModules();
    ({ POST } = await import('@/app/api/chatbot/route'));
    let release!: (r: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (release = r)));
    const first = chat(hello, '1.1.1.1');
    await new Promise((r) => setTimeout(r, 0));
    const second = await chat(hello, '2.2.2.2');
    expect(second.status).toBe(503);
    expect(second.headers.get('Retry-After')).toBe('5');
    release(gemini('done'));
    expect((await first).status).toBe(200);
  });

  it('keeps only the last 20 text turns, starting from a user turn', async () => {
    const long = Array.from({ length: 25 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', parts: [{ text: `m${i}` }, { inlineData: 'x' }, { text: 'y'.repeat(3000) }, { text: 'a' }, { text: 'dropped' }] }));
    await chat(long);
    const contents = sentBody().contents as { role: string; parts: { text: string }[] }[];
    expect(contents[0].role).toBe('user');
    expect(contents).toHaveLength(19); // 20 kept, the leading model turn dropped
    expect(contents[0].parts.map((p) => p.text)).toEqual(['m6', 'y'.repeat(2000), 'a']);
  });

  it.each([
    ['a non-array', { messages: 'hi' }, 'Messages array is required'],
    ['an empty array', { messages: [] }, 'Messages array is required'],
    ['a bad role', { messages: [{ role: 'system', parts: [{ text: 'x' }] }] }, 'Invalid message format'],
    ['parts that are not an array', { messages: [{ role: 'user', parts: 'x' }] }, 'Invalid message format'],
    ['no text parts', { messages: [{ role: 'user', parts: [{ inlineData: 'x' }] }] }, 'Invalid message format'],
    ['only model turns', { messages: [{ role: 'model', parts: [{ text: 'x' }] }] }, 'Invalid message format'],
    ['a null turn', { messages: [null] }, 'Invalid message format'],
  ])('rejects %s', async (_label, body, error) => {
    const res = await POST(makeRequest('/api/chatbot', { body }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
  });

  it('rejects a body that is not JSON and answers 503 without an API key', async () => {
    expect((await POST(makeRequest('/api/chatbot', { method: 'POST', rawBody: 'nope' }))).status).toBe(400);
    vi.stubEnv('GEMINI_API_KEY', '');
    expect((await chat()).status).toBe(503);
  });

  it('treats requests without a client IP as one anonymous bucket and evicts old IPs', async () => {
    const r = await POST(makeRequest('/api/chatbot', { body: { messages: hello } }));
    expect(r.status).toBe(200);
    for (let i = 0; i < 10_001; i++) await chat(hello, `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
  }, 120_000);
});
