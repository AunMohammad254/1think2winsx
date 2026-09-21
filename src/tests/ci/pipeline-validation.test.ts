/**
 * Phase 6: CI/CD Pipeline Validation Tests
 *
 * Validates that all GitHub Actions workflow files exist and contain
 * the required CI/CD configuration for the 1Think2Wins test suite.
 *
 * Test Categories:
 *   [PE]  Pipeline Execution  (3 tests)
 *   [RG]  Report Generation   (3 tests)
 *   [ND]  Notification Delivery (3 tests)
 *   [GA]  GitHub Actions Setup (10 tests)
 *   [RN]  Reporting & Notifications (7 tests)
 *
 * Total: 26 tests
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
      'e2e-chromium',
      'e2e-firefox',
      'e2e-webkit',
      'e2e-mobile',
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

  it('[ND-3] PR coverage comment action is configured in coverage workflow', () => {
    const content = readFile('.github/workflows/coverage.yml');

    expect(content).toMatch(/pull_request/);
    expect(content).toMatch(/marocchino\/sticky-pull-request-comment/i);
    expect(content).toMatch(/pull-requests: write/i);
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

  it('[GA-10] Summary job lists all five test jobs as dependencies', () => {
    const content = readFile('.github/workflows/tests.yml');

    // The report-summary job needs array must contain these
    const reportSummarySection = content.split('report-summary:')[1] ?? '';
    const needsSection = reportSummarySection.split('steps:')[0];

    expect(needsSection).toContain('unit-tests');
    expect(needsSection).toContain('e2e-chromium');
    expect(needsSection).toContain('e2e-firefox');
    expect(needsSection).toContain('e2e-webkit');
    expect(needsSection).toContain('e2e-mobile');
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
});
