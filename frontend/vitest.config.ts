import { defineConfig } from 'vitest/config';

// Minimal vitest bootstrap (was referenced by frontend-ci.yml as `test:vitest` but the
// script did not exist — a green CI that ran zero tests). Node env; tests stub `window`
// where they need the DOM, so no jsdom dependency is required for the current suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
