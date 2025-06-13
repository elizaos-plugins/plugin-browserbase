import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 60000,
    exclude: ['**/e2e/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts', 
        '**/*.test.ts', 
        '**/*.spec.ts',
        '**/e2e/**',
        '**/test-utils.ts'
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 80,
        statements: 95,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
