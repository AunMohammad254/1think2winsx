// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { getClientIp, describeClientIpHeaders } from '@/lib/client-ip';

const h = (headers: Record<string, string>) => new Headers(headers);

describe('getClientIp', () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
    delete process.env.TRUSTED_IP_HEADER;
  });

  it('TRUSTED_IP_HEADER wins: uses the header the host owns, ignoring X-Forwarded-For', () => {
    process.env.TRUSTED_IP_HEADER = 'CF-Connecting-IP'; // case-insensitive
    expect(getClientIp(h({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('falls back to the X-Forwarded-For rules when the trusted header is absent', () => {
    process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip';
    process.env.TRUSTED_PROXY_HOPS = '1';
    expect(getClientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('takes only the first value of a comma-separated trusted header and bounds its length', () => {
    process.env.TRUSTED_IP_HEADER = 'x-real-ip';
    expect(getClientIp(h({ 'x-real-ip': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(getClientIp(h({ 'x-real-ip': 'a'.repeat(5_000) })).length).toBeLessThanOrEqual(64);
  });

  it('describeClientIpHeaders reports what was received and what would be used', () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    const d = describeClientIpHeaders(h({ 'x-forwarded-for': '9.9.9.9, 203.0.113.9', 'x-real-ip': '10.1.1.1' }));
    expect(d.received['x-forwarded-for']).toBe('9.9.9.9, 203.0.113.9');
    expect(d.received['x-real-ip']).toBe('10.1.1.1');
    expect(d.received['cf-connecting-ip']).toBeNull();
    expect(d.resolvedIp).toBe('203.0.113.9');
    expect(d.settings).toEqual({ TRUSTED_PROXY_HOPS: '1', TRUSTED_IP_HEADER: null });
  });

  it('keeps the legacy behaviour (leftmost entry) when TRUSTED_PROXY_HOPS is unset', () => {
    expect(getClientIp(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }))).toBe('1.1.1.1');
  });

  it('with one trusted hop, ignores a client-forged leftmost value', () => {
    process.env.TRUSTED_PROXY_HOPS = '1';
    // client sent "6.6.6.6"; our proxy appended the address it actually saw
    expect(getClientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('with two trusted hops (CDN + proxy), takes the entry the outer proxy appended', () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    expect(getClientIp(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9, 172.16.0.5' }))).toBe('203.0.113.9');
  });

  it('does not run off the front of a short chain', () => {
    process.env.TRUSTED_PROXY_HOPS = '5';
    expect(getClientIp(h({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('ignores invalid TRUSTED_PROXY_HOPS values', () => {
    process.env.TRUSTED_PROXY_HOPS = 'abc';
    expect(getClientIp(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1');
    process.env.TRUSTED_PROXY_HOPS = '-3';
    expect(getClientIp(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }))).toBe('1.1.1.1');
  });

  it('falls back to x-real-ip, then "unknown"', () => {
    expect(getClientIp(h({ 'x-real-ip': ' 9.9.9.9 ' }))).toBe('9.9.9.9');
    expect(getClientIp(h({}))).toBe('unknown');
  });

  it('bounds the returned value so forged headers cannot bloat limiter keys', () => {
    const huge = 'a'.repeat(5_000);
    expect(getClientIp(h({ 'x-forwarded-for': huge })).length).toBeLessThanOrEqual(64);
    expect(getClientIp(h({ 'x-real-ip': huge })).length).toBeLessThanOrEqual(64);
  });
});
