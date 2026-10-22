import { describe, it, expect } from 'vitest';
import { formatCount, hasAtMostTwoDecimals } from '@/lib/numbers';

describe('hasAtMostTwoDecimals', () => {
  it('accepts every value from 0.00 to 100.00 in steps of 0.01 (Math.round(n * 100) === n * 100 refused 1,146 of them)', () => {
    const refused: number[] = [];
    for (let i = 0; i <= 10_000; i++) if (!hasAtMostTwoDecimals(i / 100)) refused.push(i / 100);
    expect(refused).toEqual([]);
    expect([1.1, 0.07, 0.29, 1.12, 12.34].every(hasAtMostTwoDecimals)).toBe(true);
  });

  it('refuses a third decimal', () => {
    expect([12.555, 12.345, 0.001, 99.999].some(hasAtMostTwoDecimals)).toBe(false);
  });
});

describe('formatCount', () => {
  it('groups thousands the way the admin screens show them', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(0)).toBe('0');
  });
});
