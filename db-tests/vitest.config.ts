import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Database tests: real Postgres functions and RLS against a local database (db-tests/README.md).
 * Separate from the unit suite (vitest.config.ts only includes src/), so they never count
 * toward or affect its coverage thresholds.
 */
export default defineConfig({
  root: path.resolve(__dirname, '..'),
  test: {
    include: ['db-tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['db-tests/global-setup.ts'],
    // Every file shares one database and empties it between tests
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
    reporters: process.env.CI
      ? ['verbose', ['junit', { outputFile: 'test-results/db-junit.xml' }]]
      : ['verbose'],
  },
});
