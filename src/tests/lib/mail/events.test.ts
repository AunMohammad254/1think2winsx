// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  brevoEvent, fetchSnsCertificate, isSnsUrl, sesEvent, snsStringToSign, tokenMatches, verifySnsMessage, type SnsMessage,
} from '@/lib/mail/events';
import { SNS_CERT_URL as CERT_URL, signedSns, testSnsCertificate } from '@/tests/helpers/sns';

afterEach(() => vi.unstubAllGlobals());

describe('isSnsUrl', () => {
  it('accepts only https on an SNS host', () => {
    expect(isSnsUrl(CERT_URL)).toBe(true);
    expect(isSnsUrl('http://sns.ap-southeast-2.amazonaws.com/x.pem')).toBe(false);
    expect(isSnsUrl('https://sns.ap-southeast-2.amazonaws.com.evil.test/x.pem')).toBe(false);
    expect(isSnsUrl('https://evil.test/sns.amazonaws.com')).toBe(false);
    expect(isSnsUrl('not a url')).toBe(false);
    expect(isSnsUrl(undefined)).toBe(false);
  });
});

describe('snsStringToSign', () => {
  it('lists the signed fields in order, leaving out a missing Subject', () => {
    const base = { Type: 'Notification', MessageId: 'm', TopicArn: 't', Message: 'body', Timestamp: 'ts' } as SnsMessage;
    expect(snsStringToSign(base)).toBe('Message\nbody\nMessageId\nm\nTimestamp\nts\nTopicArn\nt\nType\nNotification\n');
    expect(snsStringToSign({ ...base, Subject: 'S' })).toContain('MessageId\nm\nSubject\nS\nTimestamp');
    expect(snsStringToSign({ ...base, Type: 'SubscriptionConfirmation', SubscribeURL: 'u', Token: 'k' }))
      .toBe('Message\nbody\nMessageId\nm\nSubscribeURL\nu\nTimestamp\nts\nToken\nk\nTopicArn\nt\nType\nSubscriptionConfirmation\n');
  });
});

describe('verifySnsMessage', () => {
  const certificate = testSnsCertificate;

  it('accepts a message AWS signed, with SHA256 or SHA1', async () => {
    expect(await verifySnsMessage(signedSns({ Subject: 'Amazon SES Email Event Notification' }), certificate)).toBe(true);
    expect(await verifySnsMessage(signedSns({}, '1'), certificate)).toBe(true);
  });

  it('refuses a changed message, a foreign certificate URL and an unknown signature version', async () => {
    expect(await verifySnsMessage({ ...signedSns({}), Message: '{"changed":true}' }, certificate)).toBe(false);
    expect(await verifySnsMessage(signedSns({ SigningCertURL: 'https://evil.test/cert.pem' }), certificate)).toBe(false);
    expect(await verifySnsMessage(signedSns({ SigningCertURL: 'https://sns.ap-southeast-2.amazonaws.com/cert.txt' }), certificate)).toBe(false);
    expect(await verifySnsMessage({ ...signedSns({}), SignatureVersion: '3' }, certificate)).toBe(false);
    expect(await verifySnsMessage({ ...signedSns({}), Signature: undefined as unknown as string }, certificate)).toBe(false);
  });
});

describe('fetchSnsCertificate', () => {
  it('fetches a certificate once per URL', async () => {
    const pem = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n';
    const fetchMock = vi.fn(async () => new Response(pem));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchSnsCertificate('https://sns.ap-southeast-2.amazonaws.com/one.pem')).toBe(pem);
    expect(await fetchSnsCertificate('https://sns.ap-southeast-2.amazonaws.com/one.pem')).toBe(pem);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses an error answer or something that is not a certificate', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('-----BEGIN CERTIFICATE-----', { status: 404 })));
    await expect(fetchSnsCertificate('https://sns.ap-southeast-2.amazonaws.com/two.pem')).rejects.toThrow('(404)');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>')));
    await expect(fetchSnsCertificate('https://sns.ap-southeast-2.amazonaws.com/three.pem')).rejects.toThrow('signing certificate');
  });
});

describe('sesEvent', () => {
  const notice = (body: unknown) => JSON.stringify(body);

  it('reads deliveries, permanent bounces and complaints', () => {
    expect(sesEvent(notice({ notificationType: 'Delivery', mail: { messageId: 'm1' } }))).toEqual({ messageId: 'm1', status: 'delivered', reason: null });
    expect(sesEvent(notice({ notificationType: 'Bounce', mail: { messageId: 'm2' }, bounce: { bounceType: 'Permanent', bouncedRecipients: [{ diagnosticCode: 'smtp; 550 5.1.1 user unknown' }] } })))
      .toEqual({ messageId: 'm2', status: 'bounced', reason: 'smtp; 550 5.1.1 user unknown' });
    expect(sesEvent(notice({ eventType: 'Bounce', mail: { messageId: 'm3' }, bounce: { bounceType: 'Permanent', bounceSubType: 'NoEmail' } })))
      .toEqual({ messageId: 'm3', status: 'bounced', reason: 'Permanent bounce (NoEmail)' });
    expect(sesEvent(notice({ eventType: 'Bounce', mail: { messageId: 'm4' }, bounce: { bounceType: 'Permanent' } }))!.reason).toBe('Permanent bounce (General)');
    expect(sesEvent(notice({ notificationType: 'Complaint', mail: { messageId: 'm5' } }))).toEqual({ messageId: 'm5', status: 'complained', reason: 'Marked as spam by the recipient' });
  });

  it('ignores soft bounces, other events, and anything without a message id', () => {
    expect(sesEvent(notice({ notificationType: 'Bounce', mail: { messageId: 'm' }, bounce: { bounceType: 'Transient' } }))).toBeNull();
    expect(sesEvent(notice({ eventType: 'Open', mail: { messageId: 'm' } }))).toBeNull();
    expect(sesEvent(notice({ notificationType: 'Delivery' }))).toBeNull();
    expect(sesEvent(notice(null))).toBeNull();
    expect(sesEvent('not json')).toBeNull();
  });
});

describe('brevoEvent', () => {
  it('reads delivered, hard bounces, blocks and spam reports', () => {
    expect(brevoEvent({ event: 'delivered', 'message-id': '<m1@relay>' })).toEqual({ messageId: '<m1@relay>', status: 'delivered', reason: null });
    expect(brevoEvent({ event: 'hard_bounce', 'message-id': 'm2', reason: 'Mailbox unavailable' })).toEqual({ messageId: 'm2', status: 'bounced', reason: 'Mailbox unavailable' });
    expect(brevoEvent({ event: 'hard_bounce', 'message-id': 'm3', reason: '' })!.reason).toBe('Hard bounce');
    expect(brevoEvent({ event: 'blocked', 'message-id': 'm4', reason: 'blacklisted' })!.reason).toBe('Blocked by Brevo: blacklisted');
    expect(brevoEvent({ event: 'blocked', 'message-id': 'm5' })!.reason).toBe('Blocked by Brevo');
    expect(brevoEvent({ event: 'spam', 'message-id': 'm6' })).toEqual({ messageId: 'm6', status: 'complained', reason: 'Marked as spam by the recipient' });
  });

  it('ignores soft bounces, other events, and anything without a message id', () => {
    expect(brevoEvent({ event: 'soft_bounce', 'message-id': 'm' })).toBeNull();
    expect(brevoEvent({ event: 'opened', 'message-id': 'm' })).toBeNull();
    expect(brevoEvent({ event: 'delivered', 'message-id': '' })).toBeNull();
    expect(brevoEvent({ event: 'delivered' })).toBeNull();
  });
});

describe('tokenMatches', () => {
  it('compares tokens exactly', () => {
    expect(tokenMatches('s3cret', 's3cret')).toBe(true);
    expect(tokenMatches('s3cre', 's3cret')).toBe(false);
    expect(tokenMatches('s3creT', 's3cret')).toBe(false);
    expect(tokenMatches(null, 's3cret')).toBe(false);
  });
});
