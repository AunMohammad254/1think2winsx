// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { argOf, createSupabaseMock, type SupabaseMock } from '@/tests/helpers/supabase-mock';

const quiet = () => {
  for (const level of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {});
};
beforeEach(quiet);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.doUnmock('@/lib/supabase/db');
  vi.doUnmock('@/lib/security-logger');
  vi.doUnmock('@/lib/quiz-scheduler');
  vi.doUnmock('@supabase/ssr');
  vi.doUnmock('@supabase/supabase-js');
  vi.doUnmock('next/headers');
  vi.doUnmock('cloudinary');
  vi.doUnmock('@/lib/scheduler-loop');
  vi.resetModules();
});

describe('security monitor', () => {
  const logSecurityEvent = vi.fn();
  let mon: typeof import('@/lib/security-monitoring');
  beforeEach(async () => {
    vi.resetModules();
    logSecurityEvent.mockReset();
    vi.doMock('@/lib/security-logger', () => ({ securityLogger: { logSecurityEvent: (...a: unknown[]) => logSecurityEvent(...a) } }));
    mon = await import('@/lib/security-monitoring');
  });
  const ev = (type: string, userId?: string, ip = '1.1.1.1') => mon.securityMonitor.recordEvent({ type: type as never, userId, ip });
  const alerts = () => logSecurityEvent.mock.calls.map((c) => c[0].details.alertType);

  it('alerts on repeated rate-limit, CSRF, file and login abuse, once per cooldown', () => {
    for (let i = 0; i < 10; i++) ev('RATE_LIMIT_EXCEEDED', 'u1');
    for (let i = 0; i < 3; i++) ev('CSRF_TOKEN_VIOLATION', 'u2');
    for (let i = 0; i < 5; i++) ev(['INVALID_FILE_TYPE', 'FILE_SIZE_EXCEEDED', 'INVALID_FILE_MAGIC_BYTES'][i % 3], 'u3');
    for (let i = 0; i < 20; i++) ev('FAILED_LOGIN', undefined, '6.6.6.6');
    expect(alerts()).toEqual(['EXCESSIVE_RATE_LIMIT_VIOLATIONS', 'CSRF_ATTACK_DETECTED', 'SUSPICIOUS_FILE_UPLOAD_ACTIVITY', 'BRUTE_FORCE_DETECTED']);
    ev('RATE_LIMIT_EXCEEDED', 'u1');
    expect(alerts()).toHaveLength(4); // still cooling down
    expect(console.error).toHaveBeenCalledWith('SECURITY ALERT: BRUTE_FORCE_DETECTED', expect.objectContaining({ ip: '6.6.6.6' }));
  });

  it('alerts again after the 30-minute cooldown', () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    for (let i = 0; i < 10; i++) ev('RATE_LIMIT_EXCEEDED', 'u1');
    clock.mockReturnValue(now + 31 * 60_000);
    ev('RATE_LIMIT_EXCEEDED', 'u1');
    expect(alerts()).toEqual(['EXCESSIVE_RATE_LIMIT_VIOLATIONS', 'EXCESSIVE_RATE_LIMIT_VIOLATIONS']);
  });

  it('flags users and blocks IPs with too much suspicious activity, and resets counters each hour', () => {
    for (let i = 0; i < 15; i++) ev('UNAUTHORIZED_ACCESS', 'u9', '7.7.7.7');
    expect(alerts()).toContain('SUSPICIOUS_USER_ACTIVITY');
    expect(mon.securityMonitor.shouldFlagUser('u9')).toBe(true);
    expect(mon.securityMonitor.shouldBlockIP('7.7.7.7')).toBe(true);
    expect(mon.securityMonitor.shouldBlockIP('8.8.8.8')).toBe(false);
    for (let i = 0; i < 20; i++) ev('FAILED_LOGIN', undefined, '9.9.9.9');
    expect(mon.securityMonitor.shouldBlockIP('9.9.9.9')).toBe(true);

    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 60_000);
    expect(mon.securityMonitor.shouldFlagUser('u9')).toBe(false);
    ev('UNAUTHORIZED_ACCESS', 'u9', '7.7.7.7');
    expect(mon.securityMonitor.shouldBlockIP('7.7.7.7')).toBe(false);
    clock.mockRestore();
    // ordinary traffic never counts as suspicious
    for (let i = 0; i < 30; i++) ev('QUIZ_ACCESSED', 'u10');
    expect(mon.securityMonitor.shouldFlagUser('u10')).toBe(false);
  });

  it('summarises the last hour of events from a bounded ring buffer', () => {
    for (let i = 0; i < 2_005; i++) ev('QUIZ_ACCESSED', i % 2 ? 'u1' : undefined, `10.0.0.${i % 3}`);
    const stats = mon.securityMonitor.getSecurityStats();
    expect(stats.totalEvents).toBe(2_000);
    expect(stats.eventsByType).toEqual({ QUIZ_ACCESSED: 2_000 });
    expect(Object.keys(stats.topIPs)).toHaveLength(3);
    expect(stats.topUsers.u1).toBe(1_000);
  });

  it('keeps the counter map bounded under a flood of distinct keys', () => {
    for (let i = 0; i < 50_001; i++) ev('QUIZ_ACCESSED', undefined, `ip-${i}`);
    expect(mon.securityMonitor.shouldBlockIP('ip-0')).toBe(false);
  });

  it('records performance metrics, keeping the last 300', () => {
    for (let i = 1; i <= 301; i++) mon.securityMonitor.recordPerfMetric('quiz_list', i);
    const s = mon.securityMonitor.getPerfSummary().quiz_list;
    expect(s).toMatchObject({ count: 300, last: 301, p50: 151 });
    expect(mon.securityMonitor.getPerfSummary()).not.toHaveProperty('nothing');
  });

  it('recordSecurityEvent takes the IP from the request and the path from its URL', () => {
    mon.recordSecurityEvent('FAILED_LOGIN', new Request('http://x/api/login', { headers: { 'x-forwarded-for': '2.2.2.2' } }), 'u');
    const withIp = Object.assign(new Request('http://x/api/other'), { ip: '3.3.3.3' });
    mon.recordSecurityEvent('FAILED_LOGIN', withIp);
    expect(Object.keys(mon.securityMonitor.getSecurityStats().topIPs)).toEqual(expect.arrayContaining(['3.3.3.3']));
  });
});

describe('security logger', () => {
  let log: typeof import('@/lib/security-logger').securityLogger;
  beforeEach(async () => {
    vi.resetModules();
    log = (await import('@/lib/security-logger')).securityLogger;
  });
  const lastEvent = () => JSON.parse((console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]);

  it('redacts sensitive keys, including nested ones, and adds client info', () => {
    const req = new NextRequest('http://x/', { headers: { 'x-real-ip': '4.4.4.4', 'user-agent': 'UA' } });
    log.logSecurityEvent({ type: 'ADMIN_ACCESS', details: { email: 'a@b', nested: { apiKey: 'k', ok: 1 }, list: ['x'] } }, req);
    expect(lastEvent()).toMatchObject({ ip: '4.4.4.4', userAgent: 'UA', details: { email: '[REDACTED]', nested: { apiKey: '[REDACTED]', ok: 1 } } });
    log.logSecurityEvent({ type: 'ADMIN_ACCESS' }, new NextRequest('http://x/'));
    expect(lastEvent()).toMatchObject({ ip: 'unknown', userAgent: 'unknown' });
  });

  it('mutates the caller\'s NESTED detail objects while redacting (the copy is shallow)', () => {
    const nested = { password: 'p' };
    log.logSecurityEvent({ type: 'ADMIN_ACCESS', details: { nested } });
    expect(nested.password).toBe('[REDACTED]');
  });

  it('has a helper per event type', () => {
    log.logAuthFailure('u', '/e', 'bad');
    expect(lastEvent()).toMatchObject({ type: 'AUTH_FAILURE', details: { reason: 'bad' } });
    log.logRateLimitExceeded('u', '/e');
    expect(lastEvent().type).toBe('RATE_LIMIT_EXCEEDED');
    log.logInvalidInput('u', '/e', ['x']);
    expect(lastEvent().details).toEqual({ errors: ['x'] });
    log.logUnauthorizedAccess(undefined, '/e');
    expect(lastEvent().type).toBe('UNAUTHORIZED_ACCESS');
    log.logSuspiciousActivity('u', '/e', 'odd');
    expect(lastEvent().details).toEqual({ activity: 'odd' });
    log.logSystemError('u', '/e', new Error('boom'));
    expect(lastEvent().details).toMatchObject({ error: 'boom', stack: expect.any(String) });
    const stackless = new Error('quiet');
    stackless.stack = undefined;
    log.logSystemError('u', '/e', stackless);
    expect(lastEvent().details).toEqual({ error: 'quiet' });
    log.logSystemError('u', '/e', 'plain');
    expect(lastEvent().details).toEqual({ error: 'plain' });
    log.logPerformanceMetric('x', 12, '/e');
  });
});

describe('logger', () => {
  it('is silent for log/info in production but always warns and errors', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const logger = (await import('@/lib/logger')).default;
    logger.log('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');
    expect(console.log).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('c');
    expect(console.error).toHaveBeenCalledWith('d');
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const dev = (await import('@/lib/logger')).default;
    dev.log('e');
    dev.info('f');
    expect(console.log).toHaveBeenCalledWith('e');
    expect(console.info).toHaveBeenCalledWith('f');
  });
});

describe('load shedding', () => {
  it('samples event-loop lag every 5 s and can be disabled by env', async () => {
    vi.useFakeTimers();
    const ls = await import('@/lib/load-shed');
    ls.__resetLoadShedForTests();
    expect(ls.getLoadStats()).toMatchObject({ inflight: 0, shedTotal: 0 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ls.getLoadStats().eventLoopLagP99Ms).toBeGreaterThanOrEqual(0);
    vi.stubEnv('LOAD_SHED_MAX_INFLIGHT', '0');
    vi.stubEnv('LOAD_SHED_MAX_LAG_MS', '0');
    ls.__setLagForTests(99_999);
    expect(ls.isOverloaded()).toBe(false);
    ls.__resetLoadShedForTests();
  });
});

describe('small helpers', () => {
  it('fetchWithRetry honours a Retry-After date header', async () => {
    const { fetchWithRetry } = await import('@/lib/fetch-retry');
    const later = new Date(Date.now() + 4000).toUTCString();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503, headers: { 'retry-after': later } }))
      .mockResolvedValueOnce(new Response('', { status: 503, headers: { 'retry-after': 'not a date' } }))
      .mockResolvedValueOnce(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const waits: number[] = [];
    const res = await fetchWithRetry('/x', undefined, { sleep: async (ms) => void waits.push(ms), random: () => 0 });
    expect(res.status).toBe(200);
    expect(waits[0]).toBeGreaterThan(2000);
    expect(waits[1]).toBe(0);
  });

  it('security headers on plain and file-upload responses', async () => {
    const h = await import('@/lib/security-headers');
    const res = h.createSecureResponse('hi', { status: 201 });
    expect(res.status).toBe(201);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    const up = h.createSecureFileUploadResponse({ ok: true });
    expect(up.headers.get('X-Permitted-Cross-Domain-Policies')).toBe('none');
  });

  it('auth detection falls back to the sign-up provider without token details', async () => {
    const { detectAuth } = await import('@/lib/auth-detection');
    expect(detectAuth({ app_metadata: { provider: 'github' } } as never).currentMethod).toBe('other_oauth');
    expect(detectAuth({ app_metadata: { provider: 'github' } } as never).label).toBe('GitHub sign-in');
    expect(detectAuth({ app_metadata: { provider: 'google' } } as never).currentMethod).toBe('google');
    expect(detectAuth({ app_metadata: { provider: 'email' } } as never).currentMethod).toBe('password');
    expect(detectAuth({} as never).currentMethod).toBe('unknown');
  });

  it('getCSRFHeaders sends no header when no token can be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    const csrf = await import('@/lib/csrf');
    csrf.clearCSRFTokenCache();
    expect(await csrf.getCSRFHeaders()).toEqual({});
  });

  it('the newsletter mailer skips an empty recipient list', async () => {
    vi.stubEnv('BREVO_API_KEY', 'k');
    const { sendNewsletterEmail } = await import('@/lib/email-service');
    expect(await sendNewsletterEmail({ senderEmail: 'a@b.co', subject: 's', content: 'c', recipients: [] })).toEqual({ success: true, sentCount: 0, failedCount: 0 });
  });

  it('formatBusinessTime labels zones it has no short name for', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_TIME_ZONE', 'Europe/Berlin');
    const { formatBusinessTime } = await import('@/lib/schedule-time');
    expect(formatBusinessTime('2026-01-15T12:00:00Z')).toMatch(/Jan 15, 2026, 1:00 PM GMT\+1$/);
  });

  it('convertYouTubeToEmbed leaves non-YouTube input alone', async () => {
    const { convertYouTubeToEmbed } = await import('@/utils/streaming-utils');
    expect(convertYouTubeToEmbed('https://youtube.com/channel/abc')).toBe('https://youtube.com/channel/abc');
  });

  it('cn merges Tailwind classes; quiz helpers; prize constants; live flag', async () => {
    const { cn } = await import('@/lib/utils');
    expect(cn('p-2', false && 'hidden', 'p-4')).toBe('p-4');
    const quiz = await import('@/utils/quiz');
    expect(quiz.calculateAccuracy(15, 2)).toBe(75);
    expect(quiz.calculateAccuracy(5, 0)).toBe(0);
    expect(quiz.calculateAccuracy(4, 1, 5)).toBe(80);
    expect(quiz.getUserDisplayName(null)).toBe('Guest');
    expect(quiz.getUserDisplayName({ user_metadata: { name: 'N' } } as never)).toBe('N');
    expect(quiz.getUserDisplayName({ user_metadata: { full_name: 'F' } } as never)).toBe('F');
    expect(quiz.getUserDisplayName({ user_metadata: {}, email: 'e@x' } as never)).toBe('e');
    expect(quiz.getUserDisplayName({ user_metadata: {} } as never)).toBe('User');
    const prize = await import('@/types/prize');
    expect(prize.PRIZE_CATEGORIES.map((c) => c.value)).toEqual(['all', 'electronics', 'vehicles', 'accessories', 'general']);
    expect(prize.SORT_OPTIONS).toHaveLength(5);
    expect(Object.keys(prize.STATUS_COLORS)).toEqual(['draft', 'published']);
    expect(Object.keys(prize.REDEMPTION_STATUS_COLORS)).toEqual(['pending', 'approved', 'rejected', 'fulfilled']);
  });
});

describe('embed utils', () => {
  it('finds YouTube ids and detects YouTube content', async () => {
    const e = await import('@/lib/embed-utils');
    expect(e.getYouTubeVideoId('https://youtu.be/abc_123')).toBe('abc_123');
    expect(e.getYouTubeVideoId('https://www.youtube.com/live/LIVE1')).toBe('LIVE1');
    expect(e.getYouTubeVideoId('https://vimeo.com/1')).toBeNull();
    expect(e.isYouTubeContent('https://YouTu.be/x')).toBe(true);
    expect(e.isYouTubeContent('<iframe src="https://player.twitch.tv"/>')).toBe(false);
  });

  it('finds the video in every form an admin might paste: privacy-mode embeds, Shorts, extra watch parameters', async () => {
    const e = await import('@/lib/embed-utils');
    expect(e.getYouTubeVideoId('<iframe src="https://www.youtube-nocookie.com/embed/NOCOOK1?si=x" allowfullscreen></iframe>')).toBe('NOCOOK1');
    expect(e.getYouTubeVideoId('https://youtube.com/shorts/SHORT_1')).toBe('SHORT_1');
    expect(e.getYouTubeVideoId('https://m.youtube.com/watch?app=desktop&v=MOBILE1&t=4')).toBe('MOBILE1');
    // A channel's live stream has no video id
    expect(e.getYouTubeVideoId('https://www.youtube.com/embed/live_stream?channel=UC123')).toBeNull();
    expect(e.isYouTubeContent('https://www.youtube-nocookie.com/embed/x')).toBe(true);
  });

  it("builds the live stream's player URL with our parameters, whatever the pasted code asked for", async () => {
    const e = await import('@/lib/embed-utils');
    const params = 'autoplay=1&playsinline=1&fs=0&rel=0&iv_load_policy=3';
    expect(e.youTubeEmbedUrl('<iframe src="https://www.youtube.com/embed/HBmgriPFYT8?fs=1&autoplay=0" allowfullscreen></iframe>'))
      .toBe(`https://www.youtube.com/embed/HBmgriPFYT8?${params}`);
    expect(e.youTubeEmbedUrl('<iframe src="https://www.youtube.com/embed/live_stream?autoplay=1&channel=UCabc-_1"></iframe>'))
      .toBe(`https://www.youtube.com/embed/live_stream?channel=UCabc-_1&${params}`);
    // Not YouTube, or YouTube with nothing to play
    expect(e.youTubeEmbedUrl('<iframe src="https://player.twitch.tv/?channel=x"></iframe>')).toBeNull();
    expect(e.youTubeEmbedUrl('https://www.youtube.com/@somechannel')).toBeNull();
  });

  it("switches off the embed's own fullscreen in pasted embed code", async () => {
    const e = await import('@/lib/embed-utils');
    expect(e.withoutEmbedFullscreen('<iframe src="https://x.test/p" allowfullscreen webkitallowfullscreen="true" mozAllowFullScreen=\'\' allow="autoplay; fullscreen; encrypted-media"></iframe>'))
      .toBe('<iframe src="https://x.test/p" allow="autoplay; encrypted-media"></iframe>');
    expect(e.withoutEmbedFullscreen('<iframe src="https://www.facebook.com/plugins/video.php?href=v&amp;allowfullscreen=true" allowFullScreen></iframe>'))
      .toBe('<iframe src="https://www.facebook.com/plugins/video.php?href=v&amp;allowfullscreen=false"></iframe>');
    expect(e.withoutEmbedFullscreen("<iframe src='?allowfullscreen=TRUE' allow='fullscreen'></iframe>")).toBe("<iframe src='?allowfullscreen=false' allow=''></iframe>");
    expect(e.withoutEmbedFullscreen('<video src="a.mp4" controls></video>')).toBe('<video playsinline controlslist="nofullscreen" src="a.mp4" controls></video>');
    // A video that already sets its controls is left as it is
    expect(e.withoutEmbedFullscreen('<video controlslist="nodownload" src="a.mp4"></video>')).toBe('<video controlslist="nodownload" src="a.mp4"></video>');
    // The wrapped document applies it too
    expect(e.buildResponsiveEmbedDocument('<iframe src="https://player.twitch.tv/?channel=x" allowfullscreen></iframe>')).not.toContain('allowfullscreen');
  });

  it('turns a bare YouTube URL into an embed and normalises iframe URLs', async () => {
    const e = await import('@/lib/embed-utils');
    expect(e.buildResponsiveEmbedDocument('https://www.youtube.com/watch?v=VID')).toContain('<iframe src="https://www.youtube.com/embed/VID?autoplay=1&playsinline=1&fs=0&rel=0&iv_load_policy=3"');
    const doc = e.buildResponsiveEmbedDocument('<iframe src="https://youtube.com/watch?v=A"></iframe><iframe src="https://youtu.be/B"></iframe><iframe src="https://www.youtube.com/live/C"></iframe>');
    expect(doc.match(/youtube\.com\/embed\/[ABC]/g)).toEqual(['youtube.com/embed/A', 'youtube.com/embed/B', 'youtube.com/embed/C']);
    expect(e.buildResponsiveEmbedDocument('youtube.com/channel/x')).toContain('<div class="wrapper">youtube.com/channel/x</div>');
    expect(e.buildResponsiveEmbedDocument('<video src="a.mp4"></video>')).toContain('<video playsinline controlslist="nofullscreen" src="a.mp4"></video>');
    const uri = e.buildEmbedDataUri('<b>hi</b>');
    expect(uri.startsWith('data:text/html;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(uri.split(',')[1])).toContain('<b>hi</b>');
  });
});

describe('cloudinary helpers', () => {
  const CLOUD = 'https://res.cloudinary.com/dszrz6s6u/image/upload';

  it('the image loader adds sizing after existing transformations and the house template once', async () => {
    const { cloudinaryLoader, loaderFor, isCloudinaryUrl } = await import('@/lib/cloudinary');
    expect(cloudinaryLoader({ src: `${CLOUD}/v17/prizes/phone.jpg`, width: 400 })).toBe(`${CLOUD}/t_1Think2win/w_400,c_limit,q_auto,f_auto/v17/prizes/phone.jpg`);
    expect(cloudinaryLoader({ src: `${CLOUD}/t_1Think2win,e_sharpen/v1/a.png`, width: 64, quality: 50 })).toBe(`${CLOUD}/t_1Think2win,e_sharpen/w_64,c_limit,q_50,f_auto/v1/a.png`);
    expect(cloudinaryLoader({ src: `${CLOUD}/my_prizes/a.png`, width: 10 })).toBe(`${CLOUD}/t_1Think2win/w_10,c_limit,q_auto,f_auto/my_prizes/a.png`);
    expect(cloudinaryLoader({ src: '/local.png', width: 10 })).toBe('/local.png');
    expect(cloudinaryLoader({ src: 'https://other.example/x/y.png', width: 10 })).toBe('https://other.example/x/y.png');
    expect(loaderFor(`${CLOUD}/v1/a.png`)).toBe(cloudinaryLoader);
    expect(loaderFor('/a.png')).toBeUndefined();
    expect(isCloudinaryUrl('http://res.cloudinary.com/dszrz6s6u/image/upload/a.png')).toBe(false);
    expect(isCloudinaryUrl('https://res.cloudinary.com/someone-else/image/upload/a.png')).toBe(false);
  });

  it('public ids, allowed prize image hosts', async () => {
    const c = await import('@/lib/cloudinary');
    expect(c.cloudinaryPublicIdFromUrl(`${CLOUD}/t_1Think2win/f_auto/v17/prizes/my%20phone.jpg`)).toBe('prizes/my phone');
    expect(c.cloudinaryPublicIdFromUrl('https://res.cloudinary.com/dszrz6s6u/video/upload/v1/clip.mp4')).toBeNull();
    expect(c.cloudinaryPublicIdFromUrl(`${CLOUD}/v1/`)).toBeNull();
    expect(c.cloudinaryPublicIdFromUrl(null)).toBeNull();
    for (const ok of ['/earbuds.svg', 'data:image/png;base64,AAAA', `${CLOUD}/v1/a.png`, 'https://lh3.googleusercontent.com/a', 'https://cache.pakwheels.com/bike.jpg']) expect(c.isAllowedPrizeImageUrl(ok)).toBe(true);
    for (const bad of ['//evil.example/a.png', 'http://lh3.googleusercontent.com/a', 'https://evil.example/a.png', 'not a url', 'data:text/html;base64,AAAA']) expect(c.isAllowedPrizeImageUrl(bad)).toBe(false);
  });

  it('deleteCloudinaryImageByUrl only deletes this account\'s images', async () => {
    const destroy = vi.fn().mockResolvedValue({ result: 'ok' });
    vi.doMock('cloudinary', () => ({ v2: { config: vi.fn(), uploader: { destroy } } }));
    vi.resetModules();
    const s = await import('@/lib/cloudinary-server');
    expect(await s.deleteCloudinaryImageByUrl(`${CLOUD}/v1/prizes/a.jpg`)).toBe(true);
    expect(destroy).toHaveBeenCalledWith('prizes/a');
    expect(await s.deleteCloudinaryImageByUrl('https://evil.example/a.jpg')).toBe(false);
    destroy.mockResolvedValueOnce({ result: 'not found' });
    expect(await s.deleteCloudinaryImageByUrl(`${CLOUD}/v1/b.jpg`)).toBe(false);
    destroy.mockRejectedValueOnce(new Error('api'));
    expect(await s.deleteCloudinaryImageByUrl(`${CLOUD}/v1/c.jpg`)).toBe(false);
    expect(s.getPublicIdFromUrl(`${CLOUD}/v1/d.jpg`)).toBe('d');
  });

  it('checks upload folder names and streams uploads to Cloudinary', async () => {
    type Done = (error?: unknown, result?: Record<string, unknown>) => void;
    const answers: Parameters<Done>[] = [];
    const sent: Buffer[] = [];
    const upload_stream = vi.fn((_options: unknown, done: Done) => ({
      end: (data: Buffer) => {
        sent.push(data);
        done(...answers.shift()!);
      },
    }));
    vi.doMock('cloudinary', () => ({ v2: { config: vi.fn(), uploader: { upload_stream } } }));
    vi.resetModules();
    const s = await import('@/lib/cloudinary-server');

    for (const ok of ['prizes', 'site/banners', 'a_b-c/d/e/f']) expect(s.isCloudinaryFolder(ok)).toBe(true);
    for (const bad of ['', '../x', 'a//b', '/abs', 'a/b/c/d/e', 'has space', 'x'.repeat(65), 7, null]) expect(s.isCloudinaryFolder(bad)).toBe(false);

    answers.push([undefined, { public_id: 'prizes/a', secure_url: `${CLOUD}/v1/prizes/a.png`, format: 'png', bytes: 3, width: 1, height: 2, created_at: '2026-10-19T00:00:00Z' }]);
    expect(await s.uploadImageToCloudinary(Buffer.from([1, 2, 3]), 'prizes')).toEqual({
      publicId: 'prizes/a', url: `${CLOUD}/v1/prizes/a.png`, format: 'png', bytes: 3, width: 1, height: 2, createdAt: '2026-10-19T00:00:00Z',
    });
    expect(upload_stream).toHaveBeenCalledWith({ folder: 'prizes', resource_type: 'image' }, expect.any(Function));
    expect(sent[0]).toEqual(Buffer.from([1, 2, 3]));

    answers.push([{ message: 'Invalid image file' }]);
    await expect(s.uploadImageToCloudinary(Buffer.from([0]), 'prizes')).rejects.toEqual({ message: 'Invalid image file' });
    answers.push([undefined, undefined]);
    await expect(s.uploadImageToCloudinary(Buffer.from([0]), 'prizes')).rejects.toThrow('Cloudinary sent no upload result');
  });
});

describe('auth helpers', () => {
  it('isOAuthOnlyUser', async () => {
    const h = await import('@/lib/auth-helpers');
    expect(h.isOAuthOnlyUser(null)).toBe(false);
    expect(h.isOAuthOnlyUser({ app_metadata: { has_password: true }, identities: [{ provider: 'google' }] } as never)).toBe(false);
    expect(h.isOAuthOnlyUser({ app_metadata: {}, identities: [{ provider: 'google' }] } as never)).toBe(true);
    expect(h.isOAuthOnlyUser({ app_metadata: {}, identities: [{ provider: 'email' }] } as never)).toBe(false);
    expect(h.isOAuthOnlyUser({ app_metadata: { provider: 'google', providers: ['google'] }, identities: [] } as never)).toBe(true);
    expect(h.isOAuthOnlyUser({ app_metadata: { provider: 'google', providers: ['google', 'email'] } } as never)).toBe(false);
    expect(h.isOAuthOnlyUser({ app_metadata: { provider: 'email' } } as never)).toBe(false);
  });

  it('getUserAuthMethods and provider names', async () => {
    const h = await import('@/lib/auth-helpers');
    expect(h.getUserAuthMethods(null)).toEqual({ hasEmailPassword: false, hasOAuth: false, oAuthProviders: [], canChangePassword: false, primaryAuthMethod: 'unknown' });
    expect(h.getUserAuthMethods({ app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }, { provider: 'google' }, { provider: '' }] } as never))
      .toMatchObject({ hasOAuth: true, oAuthProviders: ['google'], primaryAuthMethod: 'email' });
    expect(h.getUserAuthMethods({ app_metadata: { provider: 'google' }, identities: [] } as never).primaryAuthMethod).toBe('oauth');
    expect(h.getUserAuthMethods({ app_metadata: {}, identities: [{ provider: 'email' }] } as never).primaryAuthMethod).toBe('email');
    expect(h.getUserAuthMethods({ app_metadata: {}, identities: [{ provider: 'github' }] } as never).primaryAuthMethod).toBe('oauth');
    expect(h.getUserAuthMethods({ app_metadata: {} } as never).primaryAuthMethod).toBe('unknown');
    expect(h.getProviderDisplayName('GitHub')).toBe('GitHub');
    expect(h.getProviderDisplayName('myidp')).toBe('myidp');
  });

  it('checkAuthMethodsClient uses the browser client', async () => {
    const sb = createSupabaseMock({ user: { id: 'u', app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }] } as never });
    vi.doMock('@supabase/ssr', () => ({ createBrowserClient: () => sb.client }));
    vi.resetModules();
    const h = await import('@/lib/auth-helpers');
    expect((await h.checkAuthMethodsClient()).primaryAuthMethod).toBe('email');
  });
});

describe('quiz catalogue', () => {
  let adminDb: SupabaseMock;
  const activateDueQuizzes = vi.fn();
  const broadcastQuizLive = vi.fn();
  let cat: typeof import('@/lib/quiz-catalog');
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  beforeEach(async () => {
    vi.resetModules();
    adminDb = createSupabaseMock();
    activateDueQuizzes.mockReset().mockResolvedValue({ activated: [], nextDueAt: null });
    broadcastQuizLive.mockReset().mockResolvedValue(undefined);
    vi.doMock('@/lib/supabase/db', () => ({ getAdminDb: () => adminDb.client }));
    vi.doMock('@/lib/quiz-scheduler', () => ({ activateDueQuizzes: () => activateDueQuizzes(), broadcastQuizLive: (q: unknown) => broadcastQuizLive(q) }));
    cat = await import('@/lib/quiz-catalog');
  });

  it('lists live quizzes within their window with active questions and attempt counts', async () => {
    adminDb.setTable('Quiz', {
      data: [
        { id: 'live', status: 'active', pushedAt: minutesAgo(5), duration: 10, timeUpDuration: 60, description: null },
        { id: 'expired', status: 'active', pushedAt: minutesAgo(200), duration: 10, timeUpDuration: null },
        { id: 'soon', status: 'upcoming' },
        { id: 'never-pushed', status: 'active', pushedAt: null },
        { id: 'hidden', status: 'paused', pushedAt: null },
        { id: 'timeup', status: 'paused', pushedAt: minutesAgo(30), duration: 10, timeUpDuration: 60 },
      ],
    });
    adminDb.setTable('Question', { data: [{ id: 'q1', quizId: 'live', text: 'T', options: '["A","B"]' }, { id: 'q2', quizId: 'live', text: 'U', options: ['C'] }, { id: 'q3', quizId: 'soon', text: 'V', options: '{bad json' }] });
    adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { data: [{ quiz_id: 'live', attempt_count: '7' }, { quiz_id: 'soon', attempt_count: 'x' }] });

    const list = await cat.getActiveQuizCatalog();

    expect(list.map((q) => q.id)).toEqual(['live', 'soon', 'never-pushed', 'timeup']);
    expect(list[0]).toMatchObject({ description: '', totalAttempts: 7, questions: [{ id: 'q1', text: 'T', options: ['A', 'B'] }, { id: 'q2', text: 'U', options: ['C'] }] });
    expect(list[1]).toMatchObject({ totalAttempts: 0, questions: [{ id: 'q3', options: [] }] });
    expect(await cat.getCatalogQuiz('soon')).toMatchObject({ id: 'soon' });
    expect(await cat.getCatalogQuiz('ghost')).toBeUndefined();
  });

  it('lists a scheduled quiz as upcoming once players were told about it, and reads every column so it works before the migration', async () => {
    adminDb.setTable('Quiz', {
      data: [
        { id: 'announced', status: 'scheduled', startsAt: '2026-10-20T15:00:00Z', announcedAt: '2026-10-20T14:50:00Z' },
        { id: 'secret', status: 'scheduled', startsAt: '2026-10-20T16:00:00Z', announcedAt: null },
        // Before the migration the column is simply missing
        { id: 'pre-migration', status: 'scheduled', startsAt: '2026-10-20T17:00:00Z' },
        { id: 'legacy', status: 'upcoming', startsAt: '2026-10-20T18:00:00Z' },
      ],
    });
    adminDb.setTable('Question', { data: [] });

    const list = await cat.getActiveQuizCatalog();

    expect(list.map((q) => [q.id, q.status, q.announcedAt])).toEqual([
      ['announced', 'upcoming', '2026-10-20T14:50:00Z'],
      ['legacy', 'upcoming', null],
    ]);
    const [read] = adminDb.callsTo('Quiz');
    expect(argOf(read, 'select')).toBe('*');
    expect(read.ops.find((o) => o.op === 'in')?.args).toEqual(['status', ['active', 'upcoming', 'paused', 'scheduled']]);
  });

  it('shows 0 attempts when the count RPC returns no rows', async () => {
    cat.invalidateQuizCatalog();
    adminDb.setTable('Quiz', { data: [{ id: 'soon', status: 'upcoming' }] });
    adminDb.setTable('Question', { data: [] });
    expect((await cat.getActiveQuizCatalog())[0].totalAttempts).toBe(0);
  });

  it('caches for 15 s, shares one load, and is invalidated on demand or when a quiz is due', async () => {
    adminDb.setTable('Quiz', { data: [] });
    await Promise.all([cat.getActiveQuizCatalog(), cat.getActiveQuizCatalog()]);
    await cat.getActiveQuizCatalog();
    expect(adminDb.callsTo('Quiz')).toHaveLength(1);
    cat.invalidateQuizCatalog();
    await cat.getActiveQuizCatalog();
    expect(adminDb.callsTo('Quiz')).toHaveLength(2);

    activateDueQuizzes.mockResolvedValue({ activated: [], nextDueAt: Date.now() - 1 });
    cat.invalidateQuizCatalog();
    await cat.getActiveQuizCatalog();
    await cat.getActiveQuizCatalog();
    expect(adminDb.callsTo('Quiz')).toHaveLength(4);
  });

  it('answers from a stale catalogue at once while one background load refreshes it, and waits once it is too old', async () => {
    const t0 = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      adminDb.setTable('Quiz', { data: [{ id: 'v1', status: 'upcoming' }] });
      adminDb.setTable('Question', { data: [] });
      await cat.getActiveQuizCatalog();
      expect(adminDb.callsTo('Quiz')).toHaveLength(1);

      // Stale: both callers get the previous catalogue without waiting, and only one refresh starts
      adminDb.setTable('Quiz', { data: [{ id: 'v2', status: 'upcoming' }] });
      clock.mockReturnValue(t0 + 16_000);
      const [a, b] = await Promise.all([cat.getActiveQuizCatalog(), cat.getActiveQuizCatalog()]);
      expect([a[0].id, b[0].id]).toEqual(['v1', 'v1']);
      await vi.waitFor(() => expect(adminDb.callsTo('Quiz')).toHaveLength(2));
      await vi.waitFor(async () => expect((await cat.getActiveQuizCatalog())[0].id).toBe('v2'));

      // A failed background refresh keeps serving the previous catalogue, and says so
      adminDb.setTable('Quiz', { error: { message: 'down' } });
      clock.mockReturnValue(t0 + 40_000);
      expect((await cat.getActiveQuizCatalog())[0].id).toBe('v2');
      await vi.waitFor(() =>
        expect(console.error).toHaveBeenCalledWith('[QuizCatalog] Background refresh failed, serving the previous catalogue:', expect.anything()));

      // Too old to serve: the caller waits for the database again (and gets its error)
      clock.mockReturnValue(t0 + 16_000 + 5 * 60_000 + 1);
      await expect(cat.getActiveQuizCatalog()).rejects.toBeDefined();
    } finally {
      clock.mockRestore();
    }
  });

  it('activates due quizzes first and announces them without waiting', async () => {
    adminDb.setTable('Quiz', { data: [] });
    activateDueQuizzes.mockResolvedValue({ activated: [{ id: 'q1', title: 'T' }], nextDueAt: null });
    broadcastQuizLive.mockRejectedValue(new Error('push down'));
    await cat.getActiveQuizCatalog();
    await new Promise((r) => setTimeout(r, 0));
    expect(broadcastQuizLive).toHaveBeenCalledWith({ id: 'q1', title: 'T' });
    expect(console.error).toHaveBeenCalledWith('[QuizCatalog] Failed to broadcast live quiz q1:', expect.any(Error));

    cat.invalidateQuizCatalog();
    activateDueQuizzes.mockRejectedValue(new Error('db'));
    expect(await cat.getActiveQuizCatalog()).toEqual([]);
    expect(console.error).toHaveBeenCalledWith('[QuizCatalog] Failed to activate due quizzes:', expect.any(Error));
  });

  it('keeps serving when the counts RPC fails, and throws when the quiz or question read fails', async () => {
    adminDb.setTable('Quiz', { data: [{ id: 'q', status: 'active' }] });
    adminDb.setTable('Question', { data: null });
    adminDb.setRpc('get_quiz_attempt_counts_by_quiz', { error: { message: 'rpc' } });
    expect((await cat.getActiveQuizCatalog())[0]).toMatchObject({ totalAttempts: 0, questions: [] });
    cat.invalidateQuizCatalog();
    adminDb.setTable('Question', { error: { message: 'questions down' } });
    await expect(cat.getActiveQuizCatalog()).rejects.toEqual({ message: 'questions down' });
    cat.invalidateQuizCatalog();
    adminDb.setTable('Quiz', { error: { message: 'quiz down' } });
    await expect(cat.getActiveQuizCatalog()).rejects.toEqual({ message: 'quiz down' });
    adminDb.setTable('Quiz', { data: null });
    cat.invalidateQuizCatalog();
    expect(await cat.getActiveQuizCatalog()).toEqual([]);
  });

  it('names linked prizes with one query, only when a quiz has one, and lists quizzes without names if it fails', async () => {
    adminDb.setTable('Quiz', {
      data: [
        { id: 'a', status: 'upcoming', prizeId: 'p1' },
        { id: 'b', status: 'upcoming', prizeId: 'p1' },
        { id: 'c', status: 'upcoming', prizeId: 'deleted' },
        { id: 'd', status: 'upcoming', prizeId: null },
      ],
    });
    adminDb.setTable('Question', { data: [] });
    adminDb.setTable('Prize', { data: [{ id: 'p1', name: 'Ronin Earbuds' }] });
    expect((await cat.getActiveQuizCatalog()).map((q) => q.prizeName)).toEqual(['Ronin Earbuds', 'Ronin Earbuds', null, null]);
    expect(adminDb.callsTo('Prize')).toHaveLength(1);
    expect(adminDb.callsTo('Prize')[0].ops.find((o) => o.op === 'in')?.args).toEqual(['id', ['p1', 'deleted']]);

    cat.invalidateQuizCatalog();
    adminDb.setTable('Prize', { data: null });
    expect((await cat.getActiveQuizCatalog())[0].prizeName).toBeNull();

    // Prize names are cosmetic: the catalogue still loads, and the failure is logged
    cat.invalidateQuizCatalog();
    adminDb.setTable('Prize', { error: { message: 'prizes down' } });
    expect((await cat.getActiveQuizCatalog())[0]).toMatchObject({ id: 'a', prizeName: null });
    expect(console.error).toHaveBeenCalledWith('[QuizCatalog] Prize names failed:', { message: 'prizes down' });

    cat.invalidateQuizCatalog();
    adminDb.setTable('Quiz', { data: [{ id: 'd', status: 'upcoming' }] });
    expect((await cat.getActiveQuizCatalog())[0].prizeName).toBeNull();
    expect(adminDb.callsTo('Prize')).toHaveLength(3);
  });

  it('never names a bumper prize in public listings: the quiz just shows as a bumper prize quiz', async () => {
    adminDb.setTable('Quiz', {
      data: [
        { id: 'secret', status: 'upcoming', prizeId: 'p-bumper', isBumperPrize: false },
        { id: 'normal', status: 'upcoming', prizeId: 'p-watch', isBumperPrize: false },
        { id: 'flagged', status: 'upcoming', prizeId: null, isBumperPrize: true },
      ],
    });
    adminDb.setTable('Question', { data: [] });
    adminDb.setTable('Prize', { data: [{ id: 'p-bumper', name: 'Mystery bike', category: 'bumper' }, { id: 'p-watch', name: 'Smartwatch', category: 'electronics' }] });
    expect((await cat.getActiveQuizCatalog()).map((q) => [q.id, q.prizeName, q.isBumperPrize])).toEqual([
      ['secret', null, true],
      ['normal', 'Smartwatch', false],
      ['flagged', null, true],
    ]);
    expect(adminDb.callsTo('Prize')[0].ops.find((o) => o.op === 'select')?.args[0]).toBe('id, name, category');
  });
});

describe('sendEmail (Brevo REST)', () => {
  it('sends with BREVO_API_KEY and the verified sender', async () => {
    vi.stubEnv('BREVO_API_KEY', 'live-key');
    vi.stubEnv('BREVO_SENDER_EMAIL', 'news@example.test');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: 'm1' })));
    vi.stubGlobal('fetch', fetchMock);
    const { sendEmail } = await import('@/lib/email');
    expect(await sendEmail({ to: 'a@b.co', subject: 'Hi', html: '<p>x</p>' })).toEqual({ success: true, messageId: 'm1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('live-key');
    expect(JSON.parse(init.body)).toMatchObject({ sender: { email: 'news@example.test' }, to: [{ email: 'a@b.co' }], textContent: 'Please use an HTML compatible email client.' });
  });

  it('falls back to the legacy base64 key and the default sender', async () => {
    vi.stubEnv('BREVO_API_KEY', '');
    vi.stubEnv('BREVO_SENDER_EMAIL', '');
    vi.stubEnv('Bravo-MCP-API-key', Buffer.from(JSON.stringify({ api_key: 'legacy' })).toString('base64'));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: 'm2' })));
    vi.stubGlobal('fetch', fetchMock);
    const { sendEmail } = await import('@/lib/email');
    await sendEmail({ to: 'a@b.co', subject: 's', html: 'h', text: 't' });
    expect(fetchMock.mock.calls[0][1].headers['api-key']).toBe('legacy');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ sender: { email: 'support@1think2win.com' }, textContent: 't' });
  });

  it('reports a missing key and Brevo errors', async () => {
    vi.stubEnv('BREVO_API_KEY', '');
    vi.stubEnv('Bravo-MCP-API-key', '');
    const { sendEmail, generateBeautifulEmailTemplate } = await import('@/lib/email');
    expect(await sendEmail({ to: 'a', subject: 's', html: 'h' })).toEqual({ success: false, error: 'Missing BREVO_API_KEY in environment' });
    vi.stubEnv('BREVO_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'unauthorized sender' }), { status: 400 })));
    expect(await sendEmail({ to: 'a', subject: 's', html: 'h' })).toEqual({ success: false, error: 'unauthorized sender' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 500 })));
    expect((await sendEmail({ to: 'a', subject: 's', html: 'h' })).error).toBe('Failed to send email via Brevo REST API');
    expect(generateBeautifulEmailTemplate('Title <x>', '<p>body</p>')).toContain('<p>body</p>');
  });
});

describe('supabase clients, password flag and instrumentation', () => {
  it('the server client reads and writes request cookies; the browser client uses public env', async () => {
    let opts: { cookies: { getAll: () => unknown; setAll: (c: { name: string; value: string; options?: unknown }[]) => void } } | undefined;
    const store = { getAll: vi.fn(() => [{ name: 'a', value: 'b' }]), set: vi.fn() };
    vi.doMock('next/headers', () => ({ cookies: async () => store }));
    vi.doMock('@supabase/ssr', () => ({ createServerClient: (_u: string, _k: string, o: typeof opts) => { opts = o; return 'server-client'; }, createBrowserClient: (u: string) => `browser:${u}` }));
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co');
    vi.resetModules();
    const server = await import('@/lib/supabase/server');
    expect(await server.createClient()).toBe('server-client');
    expect(opts!.cookies.getAll()).toEqual([{ name: 'a', value: 'b' }]);
    opts!.cookies.setAll([{ name: 'x', value: 'y', options: { path: '/' } }]);
    expect(store.set).toHaveBeenCalledWith('x', 'y', { path: '/' });
    store.set.mockImplementationOnce(() => { throw new Error('read-only'); });
    expect(() => opts!.cookies.setAll([{ name: 'x', value: 'y' }])).not.toThrow();
    const browser = await import('@/lib/supabase/client');
    expect(browser.createClient()).toBe('browser:https://ref.supabase.co');
  });

  it('getAdminDb needs the service key and reuses one client', async () => {
    const createClient = vi.fn(() => ({ id: Math.random() }));
    vi.doMock('@supabase/supabase-js', () => ({ createClient }));
    vi.doMock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: vi.fn() }) }));
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.resetModules();
    let shared = await import('@/lib/supabase/db-modules/shared');
    expect(() => shared.getAdminDb()).toThrow('Missing Supabase configuration for admin client');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
    vi.resetModules();
    shared = await import('@/lib/supabase/db-modules/shared');
    expect(shared.getAdminDb()).toBe(shared.getAdminDb());
    expect(createClient).toHaveBeenCalledTimes(1);
    expect((createClient.mock.calls as unknown[][])[0][2]).toMatchObject({ auth: { autoRefreshToken: false, persistSession: false } });
    expect(shared.generateId()).toMatch(/^[a-z0-9]{20,}$/);
  });

  it('markPasswordSet records the flag and swallows failures', async () => {
    const adminDb = createSupabaseMock();
    vi.doMock('@/lib/supabase/db-modules/shared', () => ({ getAdminDb: () => adminDb.client }));
    vi.resetModules();
    const { markPasswordSet } = await import('@/lib/password-flag');
    expect(await markPasswordSet('u1')).toBe(true);
    expect(adminDb.auth.admin.updateUserById).toHaveBeenCalledWith('u1', { app_metadata: { has_password: true } });
    adminDb.auth.admin.updateUserById.mockResolvedValueOnce({ data: {}, error: { message: 'nope' } } as never);
    expect(await markPasswordSet('u1')).toBe(false);
    adminDb.auth.admin.updateUserById.mockRejectedValueOnce(new Error('down'));
    expect(await markPasswordSet('u1')).toBe(false);
    vi.doUnmock('@/lib/supabase/db-modules/shared');
  });

  it('instrumentation starts the scheduler only in the Node runtime', async () => {
    const startScheduler = vi.fn();
    vi.doMock('@/lib/scheduler-loop', () => ({ startScheduler }));
    vi.resetModules();
    const { register } = await import('@/instrumentation');
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(startScheduler).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    await register();
    expect(startScheduler).toHaveBeenCalledTimes(1);
  });
});
