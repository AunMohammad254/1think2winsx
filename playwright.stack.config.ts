import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { ADMIN, readStackEnv } from './e2e/stack/fixtures';

/**
 * The end-to-end quiz test (e2e/play-quiz.spec.ts) against the local Supabase stack. See e2e/README.md.
 *
 * The app under test runs from E2E_APP_DIR (default: this checkout) on port 3100 with only the stack's
 * keys and test values. Next.js would also load any .env file there, and this checkout's hold the live
 * project's keys, so a directory with .env files is refused: run the app from a clean worktree.
 */
const PORT = 3100;
const appDir = path.resolve(process.env.E2E_APP_DIR || '.');
const stack = readStackEnv();

const envFiles = fs.readdirSync(appDir).filter((f) => /^\.env(\..+)?$/.test(f) && f !== '.env.example');
if (stack && envFiles.length > 0 && !process.env.E2E_BASE_URL) {
  throw new Error(
    `${appDir} has ${envFiles.join(', ')}: the app under test would load them (live keys). ` +
    'Set E2E_APP_DIR to a clean worktree (see e2e/README.md).',
  );
}

export default defineConfig({
  testDir: './e2e',
  testMatch: /play-quiz\.spec\.ts/,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  reporter: process.env.CI ? [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']] : [['list']],
  outputDir: 'test-results/quiz-e2e',
  use: {
    baseURL: process.env.E2E_BASE_URL || `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: stack && !process.env.E2E_BASE_URL ? {
    command: `bun run build && bun run start -p ${PORT}`,
    cwd: appDir,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 900_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: stack.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: stack.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
      ADMIN_EMAILS: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      AUTH_SECRET: 'e2e-auth-secret-not-for-production',
      CRON_SECRET: 'e2e-cron-secret',
      // Cloudflare's always-pass Turnstile test key; the local Auth server checks no CAPTCHA
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      WALLET_FEATURE_ENABLED: 'false',
    },
  } : undefined,
});
