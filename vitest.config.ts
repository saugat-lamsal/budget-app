import { defineConfig } from 'vitest/config';

// npm test runs everything here, with no network and no keys. The tests that
// call Plaid's test bank are kept apart in vitest.live.config.ts.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'money', root: './packages/money' } },
      { test: { name: 'server', root: './packages/server', include: ['test/**/*.test.ts'] } },
      { test: { name: 'repo', include: ['test/**/*.test.ts'] } },
    ],
  },
});
