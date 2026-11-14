import { defineConfig, devices } from '@playwright/test';

// Its own port, so a run never reuses the dev server on 3000, which shows the live Turnstile widget
const PORT = 3300;

/**
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: './e2e',
    // The quiz test needs the local Supabase stack and its own config (playwright.stack.config.ts)
    testIgnore: /play-quiz\.spec\.ts/,
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Two at a time on CI: the runners have 4 CPUs, and the server under test is already built.
       The desktop WebKit job passes --workers=1 (tests.yml): its scroll tests flake with two. */
    workers: process.env.CI ? 2 : undefined,
    /* On CI, stop a run that hangs or is broken throughout, and still write the report: a frozen page
       once ran to the job's 30-minute limit and was cancelled with nothing to read. A normal run takes
       about 2 minutes. */
    globalTimeout: process.env.CI ? 15 * 60 * 1000 : undefined,
    maxFailures: process.env.CI ? 10 : undefined,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: process.env.CI
        ? [
              ['html', { outputFolder: 'playwright-report', open: 'never' }],
              ['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? 'test-results/e2e-junit.xml' }],
              ['list'],
          ]
        : [['html', { outputFolder: 'playwright-report', open: 'on-failure' }], ['list']],

    /* Output directory for test artifacts (traces, screenshots, videos) */
    outputDir: 'test-results/',
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL to use in actions like `await page.goto('/')`. */
        baseURL: `http://localhost:${PORT}`,

        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },

        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },

        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },

        /* Test against mobile viewports. */
        {
            name: 'Mobile Chrome',
            use: { ...devices['Pixel 5'] },
        },
        {
            name: 'Mobile Safari',
            use: { ...devices['iPhone 12'] },
        },
    ],

    /* Run your local dev server before starting the tests */
    /* CI workflows already run `bun run build` in a prior step (with the same Turnstile key), so only start the server there */
    webServer: {
        command: process.env.CI ? `bun run start -p ${PORT}` : `bun run build && bun run start -p ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: (process.env.CI ? 120 : 300) * 1000,
        // Cloudflare's always-pass Turnstile test key. With the live key these browsers fill the widget's
        // analytics with unsolved "bot" challenges. Next.js bakes it into the build, so the local .next then
        // shows the test widget, and Supabase refuses its tokens: rebuild before signing in on `bun run start`.
        env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' },
    },
});
