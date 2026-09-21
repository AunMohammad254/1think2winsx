import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./vitest.setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['node_modules', '.next', 'dist'],
        // @ts-ignore - Vitest types mismatch in Next.js build
        environmentMatchGlobs: [
            // CI pipeline tests run in Node (they use `fs`, no DOM needed)
            ['src/tests/ci/**', 'node'],
        ],
        // In CI, also output JUnit XML for GitHub Actions test reporting
        reporters: process.env.CI
            ? ['verbose', ['junit', { outputFile: 'test-results/junit.xml' }]]
            : ['verbose'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './coverage',
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/*.test.{ts,tsx}',
                'src/**/*.spec.{ts,tsx}',
                'src/lib/supabase/database.types.ts',
                'src/tests/**',
            ],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
