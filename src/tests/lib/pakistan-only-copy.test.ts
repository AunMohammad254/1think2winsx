// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * 1think2win is for Pakistani fans: copy, demo data and code must not name Indian or foreign leagues,
 * players, cities, payment apps or time zones (the landing page once said "IPL Mega" and "UPI payouts").
 * Matches against Pakistan, e.g. the 1992 World Cup final against England, are Pakistani cricket and fine.
 */
const FORBIDDEN =
  /\b(IPL|BCCI|India|Indian|IST|UPI|INR|Hotstar|Ranji|Kohli|Dhoni|Tendulkar|Bumrah|Mumbai|Delhi|Kolkata|Chennai|Bengaluru|Bangalore|Maharashtra|Paytm|PhonePe|Dream11|Pro Kabaddi|Big Bash|NBA|NFL|Super Bowl|Premier League|Champions League)\b|₹/;

const ROOT = process.cwd();
const SCANNED = ['src', 'public', 'e2e'];
// Tests that spell out the forbidden words in order to check they are absent
const SKIPPED = new Set(['src/tests/lib/pakistan-only-copy.test.ts', 'src/tests/components/landing.test.tsx']);
const TEXT_FILE = /\.(tsx?|jsx?|mjs|cjs|css|json|html|txt|md|xml|webmanifest)$/;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('Pakistani copy only', () => {
  it('names no Indian or foreign leagues, players, cities, payment apps or time zones', () => {
    const offenders = SCANNED.flatMap((dir) => filesUnder(join(ROOT, dir)))
      .map((path) => relative(ROOT, path).split('\\').join('/'))
      .filter((path) => TEXT_FILE.test(path) && !SKIPPED.has(path))
      .flatMap((path) =>
        readFileSync(join(ROOT, path), 'utf8')
          .split(/\r?\n/)
          .flatMap((line, i) => (FORBIDDEN.test(line) ? [`${path}:${i + 1}: ${line.trim().slice(0, 120)}`] : [])),
      );
    expect(offenders).toEqual([]);
  });
});
