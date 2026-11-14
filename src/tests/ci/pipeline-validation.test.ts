// @vitest-environment node
/**
 * Phase 6: CI/CD Pipeline Validation Tests
 *
 * Validates that all GitHub Actions workflow files exist and contain
 * the required CI/CD configuration for the 1Think2Wins test suite.
 *
 * Test Categories:
 *   [PE]  Pipeline Execution  (5 tests)
 *   [RG]  Report Generation   (3 tests)
 *   [ND]  Notification Delivery (3 tests)
 *   [GA]  GitHub Actions Setup (12 tests)
 *   [RN]  Reporting & Notifications (8 tests)
 *
 * Total: 31 tests
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const ROOT = path.resolve(process.cwd());

/** Check whether a repo-relative file exists */
function fileExists(relPath: string): boolean {
  return fs.existsSync(path.join(ROOT, relPath));
}

/** Read a repo-relative text file */
function readFile(relPath: string): string {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return '';
  return fs.readFileSync(full, 'utf-8');
}

/** How many times a piece of text appears */
function count(content: string, text: string): number {
  return content.split(text).length - 1;
}

/** The text of one job in a workflow: from its "  id:" line to the next job's banner comment */
function jobSection(content: string, jobId: string): string {
  const start = content.search(new RegExp(`^  ${jobId}:\\s*$`, 'm'));
  if (start < 0) return '';
  const rest = content.slice(start);
  const end = rest.search(/^  # ─+\s*$/m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Rough YAML key presence check – sufficient for CI config validation */
function yamlHasKey(content: string, key: string): boolean {
  // Matches "key:" at the start of a line (allowing leading whitespace)
  return new RegExp(`^\\s*${key}\\s*:`, 'm').test(content);
}

// ─────────────────────────────────────────────
// [PE] Pipeline Execution – 3 tests
// ─────────────────────────────────────────────

describe('[PE] Pipeline Execution', () => {
  it('[PE-1] Main test workflow file exists and contains required top-level keys', () => {
    const wfPath = '.github/workflows/tests.yml';

    expect(fileExists(wfPath), `${wfPath} must exist`).toBe(true);

    const content = readFile(wfPath);
    expect(yamlHasKey(content, 'name'), 'workflow must have a name').toBe(true);
    expect(yamlHasKey(content, 'on'), 'workflow must have an "on" trigger').toBe(true);
    expect(yamlHasKey(content, 'jobs'), 'workflow must have jobs').toBe(true);
  });

  it('[PE-2] All required job names are defined in tests.yml', () => {
    const content = readFile('.github/workflows/tests.yml');

    const requiredJobs = [
      'lint',
      'unit-tests',
      'db-tests',
      'edge-tests',
      'build',
      'e2e-chromium',
      'e2e-firefox',
      'e2e-webkit',
      'e2e-mobile',
      'e2e-quiz',
      'report-summary',
    ];

    for (const job of requiredJobs) {
      expect(
        content.includes(`${job}:`),
        `Job "${job}:" must be defined in tests.yml`
      ).toBe(true);
    }
  });

  it('[PE-3] Coverage and performance workflow files exist and are valid', () => {
    const workflowFiles = [
      '.github/workflows/coverage.yml',
      '.github/workflows/performance.yml',
    ];

    for (const wf of workflowFiles) {
      expect(fileExists(wf), `${wf} must exist`).toBe(true);

      const content = readFile(wf);
      expect(yamlHasKey(content, 'name'), `${wf} must have a name`).toBe(true);
      expect(yamlHasKey(content, 'on'), `${wf} must have triggers`).toBe(true);
      expect(yamlHasKey(content, 'jobs'), `${wf} must have jobs`).toBe(true);
    }
  });

  it('[PE-4] Every test set in the repository has a job that runs it', () => {
    const content = readFile('.github/workflows/tests.yml');

    // The Cloudflare Worker's own tests and type checks (edge-shield is a separate npm package)
    const edge = jobSection(content, 'edge-tests');
    expect(edge).toMatch(/working-directory:\s*edge-shield/);
    expect(edge).toMatch(/npx vitest run/);
    expect(edge).toMatch(/npx tsc --noEmit/);

    // The storage rules in supabase/tests/*.test.sql
    expect(jobSection(content, 'db-tests')).toMatch(/storage-sql-tests\.sh/);
    const script = readFile('.github/ci/storage-sql-tests.sh');
    const sqlTests = fs.readdirSync(path.join(ROOT, 'supabase/tests')).filter((f) => f.endsWith('.test.sql'));
    expect(sqlTests.length).toBeGreaterThan(0);
    for (const file of sqlTests) {
      expect(script, `storage-sql-tests.sh must run supabase/tests/${file}`).toContain(file);
    }

    // The quiz played end to end against the local Supabase stack
    const quiz = jobSection(content, 'e2e-quiz');
    expect(quiz).toMatch(/stack\.mjs up/);
    expect(quiz).toMatch(/test:e2e:quiz/);
  });

  it('[PE-5] A skipped or hung end-to-end run cannot pass or run to the job limit', () => {
    // Without the stack the quiz test skips itself; in CI the config must refuse instead
    const stackConfig = readFile('playwright.stack.config.ts');
    expect(stackConfig).toMatch(/process\.env\.CI && !stack/);
    expect(stackConfig).toMatch(/throw new Error/);

    const config = readFile('playwright.config.ts');
    expect(config).toMatch(/globalTimeout:\s*process\.env\.CI/);
    expect(config).toMatch(/maxFailures:\s*process\.env\.CI/);
  });
});

// ─────────────────────────────────────────────
// [RG] Report Generation – 3 tests
// ─────────────────────────────────────────────

describe('[RG] Report Generation', () => {
  it('[RG-1] JUnit XML output is configured in the main workflow', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/junit/i);
    // outputFile or PLAYWRIGHT_JUNIT_OUTPUT_NAME or similar
    expect(content).toMatch(/junit\.xml/i);
  });

  it('[RG-2] HTML coverage reporter is configured in vitest.config.ts', () => {
    const content = readFile('vitest.config.ts');

    expect(content).toMatch(/coverage/);
    expect(content).toMatch(/reporter/);
    // Must include html reporter
    expect(content).toMatch(/'html'|"html"/);
  });

  it('[RG-3] HTML coverage report artifact is uploaded in coverage workflow', () => {
    const content = readFile('.github/workflows/coverage.yml');

    expect(content).toMatch(/upload-artifact/);
    expect(content).toMatch(/html-coverage-report/i);
  });
});

// ─────────────────────────────────────────────
// [ND] Notification Delivery – 3 tests
// ─────────────────────────────────────────────

describe('[ND] Notification Delivery', () => {
  it('[ND-1] Slack GitHub Action and webhook secret are configured', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/slackapi\/slack-github-action/i);
    expect(content).toMatch(/SLACK_WEBHOOK_URL/);
  });

  it('[ND-2] Failure notification is guarded by failure() and main branch check', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/failure\(\)/);
    expect(content).toMatch(/refs\/heads\/main/);
  });

  it('[ND-3] PR coverage comment is posted by the unit job in the main workflow', () => {
    const content = readFile('.github/workflows/tests.yml');
    const unit = jobSection(content, 'unit-tests');

    expect(content).toMatch(/pull_request/);
    expect(content).toMatch(/pull-requests: write/i);
    expect(unit).toMatch(/marocchino\/sticky-pull-request-comment/i);
    expect(unit).toMatch(/coverage\/pr-comment\.md/);
  });
});

// ─────────────────────────────────────────────
// [GA] GitHub Actions Setup – 10 tests
// ─────────────────────────────────────────────

describe('[GA] GitHub Actions Setup', () => {
  it('[GA-1] Workflow triggers on push to main/master', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/push:/);
    expect(content).toMatch(/branches:/);
    expect(content).toMatch(/main/);
  });

  it('[GA-2] Workflow triggers on pull_request', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/pull_request:/);
  });

  it('[GA-3] Workflow supports manual dispatch', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/workflow_dispatch:/);
  });

  it('[GA-4] Concurrency group with cancel-in-progress is set', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/concurrency:/);
    expect(content).toMatch(/cancel-in-progress:\s*true/);
  });

  it('[GA-5] All four browser matrix jobs are present', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toContain('e2e-chromium:');
    expect(content).toContain('e2e-firefox:');
    expect(content).toContain('e2e-webkit:');
    expect(content).toContain('e2e-mobile:');
  });

  it('[GA-6] Dependency caching for bun.lock is configured', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/actions\/cache/);
    expect(content).toMatch(/bun\.lock/);
  });

  it('[GA-7] Required CI environment variables are defined', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/AUTH_SECRET/);
    expect(content).toMatch(/DATABASE_URL/);
    expect(content).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('[GA-8] Playwright browser cache is configured', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/ms-playwright/);
    expect(content).toMatch(/playwright-cache/);
  });

  it('[GA-9] Artifacts are uploaded with retention-days set', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/upload-artifact/);
    expect(content).toMatch(/retention-days:/);
  });

  it('[GA-10] Summary job lists every test job as a dependency', () => {
    const content = readFile('.github/workflows/tests.yml');

    // The report-summary job needs array must contain these
    const reportSummarySection = content.split('report-summary:')[1] ?? '';
    const needsSection = reportSummarySection.split('steps:')[0];

    for (const job of ['lint', 'unit-tests', 'db-tests', 'edge-tests', 'build', 'e2e-chromium', 'e2e-firefox', 'e2e-webkit', 'e2e-mobile', 'e2e-quiz']) {
      expect(needsSection, `report-summary must need "${job}"`).toContain(job);
    }
  });

  it('[GA-11] The app is built once and the browser jobs share that build', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(count(content, 'run: bun run build')).toBe(1);
    expect(jobSection(content, 'build')).toMatch(/run: bun run build/);
    // .next is a hidden folder, which upload-artifact skips: it travels as one tar file
    expect(jobSection(content, 'build')).toMatch(/tar .*-cf next-build\.tar \.next/);

    for (const job of ['e2e-chromium', 'e2e-firefox', 'e2e-webkit', 'e2e-mobile']) {
      const section = jobSection(content, job);
      expect(section, `${job} must wait for the build`).toMatch(/needs:\s*build/);
      expect(section, `${job} must download the build`).toMatch(/name:\s*next-build/);
      expect(section, `${job} must unpack the build`).toMatch(/tar -xf next-build\.tar/);
    }
  });

  it('[GA-12] A pull request runs the unit suite with coverage once, behind the 100% gate', () => {
    const tests = readFile('.github/workflows/tests.yml');
    const coverage = readFile('.github/workflows/coverage.yml');

    expect(count(tests, 'bun run test:coverage')).toBe(1);
    expect(jobSection(tests, 'unit-tests')).toMatch(/node \.github\/ci\/coverage-gate\.mjs/);
    // coverage.yml is for main and the nightly run; on pull requests it would repeat the unit job
    expect(coverage).not.toMatch(/^\s*pull_request:/m);
    expect(coverage).toMatch(/node \.github\/ci\/coverage-gate\.mjs/);
    expect(readFile('.github/ci/coverage-gate.mjs')).toMatch(/const THRESHOLD = 100;/);
  });
});

// ─────────────────────────────────────────────
// [RN] Reporting & Notifications – 7 tests
// ─────────────────────────────────────────────

describe('[RN] Reporting & Notifications', () => {
  it('[RN-1] JUnit XML report path is referenced for unit tests', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/junit\.xml/i);
    expect(content).toMatch(/test-results/);
  });

  it('[RN-2] Playwright HTML reports are uploaded as artifacts', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/playwright-report/);
    expect(content).toMatch(/upload-artifact/);
  });

  it('[RN-3] Codecov action is configured in coverage workflow', () => {
    const content = readFile('.github/workflows/coverage.yml');

    expect(content).toMatch(/codecov\/codecov-action/i);
    expect(content).toMatch(/coverage-final\.json/);
  });

  it('[RN-4] GitHub Step Summary is written with test results table', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/GITHUB_STEP_SUMMARY/);
    expect(content).toMatch(/Test Suite Results/i);
  });

  it('[RN-5] Slack failure notification includes the run URL', () => {
    const content = readFile('.github/workflows/tests.yml');

    expect(content).toMatch(/github\.run_id/);
    expect(content).toMatch(/actions\/runs/);
  });

  it('[RN-6] Coverage badge JSON with schemaVersion is generated', () => {
    const content = readFile('.github/workflows/coverage.yml');

    expect(content).toMatch(/coverage\.json/);
    expect(content).toMatch(/schemaVersion/);
  });

  it('[RN-7] Lighthouse report is uploaded as an artifact', () => {
    const content = readFile('.github/workflows/performance.yml');

    expect(content).toMatch(/lighthouse/i);
    expect(content).toMatch(/upload-artifact/);
    expect(content).toMatch(/lighthouse-report/i);
  });

  it('[RN-8] Lighthouse cannot fail without anyone noticing', () => {
    const content = readFile('.github/workflows/performance.yml');
    const lighthouse = jobSection(content, 'lighthouse');

    // lhci starts the server itself; a second one on the same port made every run fail
    expect(lighthouse).not.toMatch(/bun run start &/);
    expect(readFile('.lighthouserc.json')).toMatch(/"startServerCommand"/);
    // The collect step's exit code is not swallowed, and a run without a report fails the job
    expect(lighthouse).toMatch(/run: lhci collect [^|\n]*$/m);
    expect(lighthouse).toMatch(/node \.github\/ci\/lighthouse-summary\.mjs/);
    expect(lighthouse).toMatch(/--target=filesystem --outputDir=\.\/lighthouse-results/);
  });
});
