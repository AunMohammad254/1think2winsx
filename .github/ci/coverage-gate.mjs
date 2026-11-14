#!/usr/bin/env node
// The coverage gate: every line, statement, function and branch of src/ must be covered.
//
//   node .github/ci/coverage-gate.mjs
//
// Reads coverage/coverage-summary.json (Vitest's json-summary reporter) and then:
//   - prints the totals, and every file that is not fully covered;
//   - adds the totals to the job summary (GITHUB_STEP_SUMMARY, when set);
//   - writes the pull-request comment to coverage/pr-comment.md;
//   - exits 1 when a metric is under the threshold, or when the summary is missing.
import fs from 'node:fs';
import path from 'node:path';

const SUMMARY = 'coverage/coverage-summary.json';
const COMMENT = 'coverage/pr-comment.md';
const THRESHOLD = 100;
const METRICS = ['lines', 'statements', 'functions', 'branches'];
const MAX_FILES_LISTED = 20;

if (!fs.existsSync(SUMMARY)) {
  // A missing summary used to pass the gate without checking anything
  console.error(`::error::${SUMMARY} is missing: the coverage run did not finish, so nothing was checked`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(SUMMARY, 'utf8'));
const pctOf = (entry, metric) => Number(entry?.[metric]?.pct ?? 0);
const label = (metric) => metric[0].toUpperCase() + metric.slice(1);

const totals = METRICS.map((metric) => {
  const pct = pctOf(summary.total, metric);
  // Not a number (no data) fails too
  return { metric, pct, ok: pct >= THRESHOLD };
});
const failed = totals.some((t) => !t.ok);

// Files with a gap, worst first. A total of 99.99% hides which file it is
const gaps = Object.entries(summary)
  .filter(([file]) => file !== 'total')
  .map(([file, entry]) => ({
    file: path.relative(process.cwd(), file).split(path.sep).join('/'),
    lowest: Math.min(...METRICS.map((metric) => pctOf(entry, metric))),
    detail: METRICS.filter((metric) => !(pctOf(entry, metric) >= THRESHOLD))
      .map((metric) => `${metric} ${entry[metric].covered}/${entry[metric].total}`)
      .join(', '),
  }))
  .filter((gap) => gap.detail)
  .sort((a, b) => a.lowest - b.lowest);

console.log('Coverage threshold check');
console.log('='.repeat(40));
for (const { metric, pct, ok } of totals) {
  console.log(`${ok ? '✅' : '❌'} ${label(metric)}: ${pct.toFixed(2)}% (threshold: ${THRESHOLD}%)`);
}
if (gaps.length > 0) {
  console.log(`\nNot fully covered (${gaps.length} file${gaps.length === 1 ? '' : 's'}):`);
  for (const gap of gaps.slice(0, MAX_FILES_LISTED)) console.log(`  ${gap.file}: ${gap.detail}`);
  if (gaps.length > MAX_FILES_LISTED) console.log(`  ... and ${gaps.length - MAX_FILES_LISTED} more`);
}

const table = [
  '| Metric | Coverage | Status |',
  '|--------|----------|--------|',
  // The status is the gate's verdict: 99.98% is a ❌ here, not a green dot
  ...totals.map(({ metric, pct, ok }) => `| ${label(metric)} | ${pct.toFixed(2)}% | ${ok ? '✅' : '❌'} |`),
];
const gapLines =
  gaps.length === 0
    ? []
    : [
        '',
        `**Not fully covered (${gaps.length}):**`,
        '',
        ...gaps.slice(0, MAX_FILES_LISTED).map((gap) => `- \`${gap.file}\`: ${gap.detail}`),
        ...(gaps.length > MAX_FILES_LISTED ? [`- ... and ${gaps.length - MAX_FILES_LISTED} more`] : []),
      ];

fs.writeFileSync(
  COMMENT,
  ['## 📈 Coverage Report', '', ...table, ...gapLines, '', `> The gate is ${THRESHOLD}% on all four.`, ''].join('\n'),
);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['## 📈 Coverage Summary', '', ...table, ...gapLines, ''].join('\n'));
}

if (failed) {
  console.error('\n❌ Coverage thresholds not met!');
  process.exit(1);
}
console.log('\n✅ All coverage thresholds passed!');
