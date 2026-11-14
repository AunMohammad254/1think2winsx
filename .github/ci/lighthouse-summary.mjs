#!/usr/bin/env node
// Writes the Lighthouse scores to the job summary, and fails when Lighthouse produced no report.
//
//   node .github/ci/lighthouse-summary.mjs [dir]     (default dir: lighthouse-results)
//
// Reads the manifest.json that `lhci upload --target=filesystem --outputDir=<dir>` writes: one entry
// per run, with the median run of each page marked isRepresentativeRun. A missing or empty manifest
// exits 1: this job once ran for weeks without producing a report, and nothing said so.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'lighthouse-results';
const manifestPath = path.join(dir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`::error::${manifestPath} is missing: Lighthouse did not produce a report`);
  process.exit(1);
}

const runs = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const pages = runs.filter((run) => run.isRepresentativeRun);
if (pages.length === 0) {
  console.error(`::error::${manifestPath} lists no runs: Lighthouse did not produce a report`);
  process.exit(1);
}

const CATEGORIES = [
  ['performance', 'Performance'],
  ['accessibility', 'Accessibility'],
  ['best-practices', 'Best Practices'],
  ['seo', 'SEO'],
];
const cell = (score) => {
  if (typeof score !== 'number') return 'n/a';
  const points = Math.round(score * 100);
  return `${points >= 90 ? '🟢' : points >= 50 ? '🟡' : '🔴'} ${points}`;
};

const lines = [
  '## 🔦 Lighthouse Audit Results',
  '',
  `Median of ${runs.length / pages.length} run(s) per page. The full reports are in the lighthouse-report artifact.`,
  '',
  `| Page | ${CATEGORIES.map(([, title]) => title).join(' | ')} |`,
  `|------|${CATEGORIES.map(() => '------').join('|')}|`,
  ...pages.map((page) => `| ${new URL(page.url).pathname} | ${CATEGORIES.map(([id]) => cell(page.summary?.[id])).join(' | ')} |`),
  '',
];

console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
