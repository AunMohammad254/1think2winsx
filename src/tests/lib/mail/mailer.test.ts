// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupabaseMock, argOf, type SupabaseMock } from '@/tests/helpers/supabase-mock';

let db: SupabaseMock;
const sendViaSes = vi.fn();
const sendViaBrevo = vi.fn();
vi.mock('@/lib/supabase/db', () => ({ getAdminDb: () => db.client }));
vi.mock('@/lib/mail/providers/ses', () => ({ sendViaSes: (...a: unknown[]) => sendViaSes(...a) }));
vi.mock('@/lib/mail/providers/brevo', () => ({ sendViaBrevo: (...a: unknown[]) => sendViaBrevo(...a) }));

const mailer = await import('@/lib/mail/mailer');

const email = { from: { email: 's@1think2win.test', name: '1Think 2Win' }, to: 'fan@example.test', subject: 'Welcome', html: '<p>x</p>' };
const settingsQueries = () => db.callsTo('AppSettings', 'select');
const logged = () => db.callsTo('EmailLog', 'insert').map((c) => argOf(c, 'insert'));

function selected(value: string | null) {
  db.setTable('AppSettings', { data: value === null ? null : { value } });
}

beforeEach(() => {
  db = createSupabaseMock();
  selected(null);
  mailer.invalidateProviderCache();
  sendViaSes.mockReset().mockResolvedValue({ ok: true, messageId: 'ses-1' });
  sendViaBrevo.mockReset().mockResolvedValue({ ok: true, messageId: 'brevo-1' });
  vi.stubEnv('AWS_SES_ACCESS_KEY_ID', 'AKID');
  vi.stubEnv('AWS_SES_SECRET_ACCESS_KEY', 'secret');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the selected service', () => {
  it('is Brevo unless an admin picked ses', async () => {
    expect(await mailer.selectedProvider()).toBe('brevo');
    mailer.invalidateProviderCache();
    selected(' ses ');
    expect(await mailer.selectedProvider()).toBe('ses');
    expect(argOf(settingsQueries()[1], 'eq')).toBe('key');
  });

  it('is read once a minute, or at once after a switch', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    selected('ses');
    await mailer.selectedProvider();
    selected('brevo');
    expect(await mailer.selectedProvider()).toBe('ses');
    now.mockReturnValue(1_000_000 + 60_000);
    expect(await mailer.selectedProvider()).toBe('brevo');
    selected('ses');
    mailer.invalidateProviderCache();
    expect(await mailer.selectedProvider()).toBe('ses');
    expect(settingsQueries()).toHaveLength(3);
  });

  it('keeps the last known service (or Brevo) when the setting cannot be read', async () => {
    db.setTable('AppSettings', { error: { message: 'down' } });
    expect(await mailer.selectedProvider()).toBe('brevo');
    selected('ses');
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000_000);
    await mailer.selectedProvider();
    now.mockReturnValue(5_000_000 + 61_000);
    db.setTable('AppSettings', { error: { message: 'down' } });
    expect(await mailer.selectedProvider()).toBe('ses');
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('sends through Brevo while SES is selected but has no access key', async () => {
    selected('ses');
    expect(await mailer.activeProvider()).toBe('ses');
    vi.stubEnv('AWS_SES_ACCESS_KEY_ID', '');
    expect(await mailer.activeProvider()).toBe('brevo');
  });
});

describe('deliver', () => {
  it('sends through the selected service only, and logs the email', async () => {
    selected('ses');
    expect(await mailer.deliver(email, { kind: 'registration', timeoutMs: 3500 })).toEqual({ success: true, provider: 'ses', messageId: 'ses-1' });
    expect(sendViaSes).toHaveBeenCalledWith(email, { timeoutMs: 3500 });
    expect(sendViaBrevo).not.toHaveBeenCalled();
    expect(logged()).toEqual([[{ kind: 'registration', recipient: 'fan@example.test', subject: 'Welcome', provider: 'ses', status: 'accepted', providerMessageId: 'ses-1', error: null }]]);
  });

  it('reports a failure without trying the other service', async () => {
    selected('ses');
    sendViaSes.mockResolvedValue({ ok: false, error: 'AWS paused sending for this account' });
    expect(await mailer.deliver(email, { kind: 'password' })).toEqual({ success: false, provider: 'ses', error: 'AWS paused sending for this account' });
    expect(sendViaBrevo).not.toHaveBeenCalled();
    expect(logged()[0]).toEqual([expect.objectContaining({ provider: 'ses', status: 'failed', providerMessageId: null, error: 'AWS paused sending for this account' })]);
  });

  it('sends through Brevo by default', async () => {
    expect(await mailer.deliver(email, { kind: 'support' })).toEqual({ success: true, provider: 'brevo', messageId: 'brevo-1' });
    expect(sendViaSes).not.toHaveBeenCalled();
  });
});

describe('the email log', () => {
  it('trims long values to the column sizes', () => {
    const long = { ...email, to: 'a'.repeat(400), subject: 's'.repeat(400) };
    expect(mailer.logEntry('newsletter', long, 'brevo', { ok: false, error: 'e'.repeat(1200) })).toMatchObject({
      recipient: 'a'.repeat(320), subject: 's'.repeat(300), error: 'e'.repeat(1000),
    });
    expect(mailer.logEntry('newsletter', email, 'brevo', { ok: true, messageId: null }).providerMessageId).toBeNull();
    expect(mailer.logEntry('newsletter', email, 'brevo', { ok: true, messageId: 'm'.repeat(400) }).providerMessageId).toHaveLength(300);
  });

  it('writes in chunks of 500, and never fails the send when it cannot write', async () => {
    const entry = mailer.logEntry('newsletter', email, 'brevo', { ok: true, messageId: 'm' });
    await mailer.writeEmailLog(Array.from({ length: 1001 }, () => entry));
    expect(logged().map((rows) => (rows as unknown[]).length)).toEqual([500, 500, 1]);

    db.setTable('EmailLog', { error: { code: 'PGRST205', message: 'no such table' } });
    await expect(mailer.writeEmailLog([entry])).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('[mail] Could not write the email log:', expect.anything());

    await mailer.writeEmailLog([]);
  });
});
