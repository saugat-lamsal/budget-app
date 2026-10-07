import { defineConfig } from 'vitest/config';

// npm test runs everything here, with no network and no keys. The tests that
// call Plaid's test bank are kept apart in vitest.live.config.ts.
//
// The browser tests (web-browser) build the screens and use them in real
// Chromium and WebKit (iPhone Safari is WebKit). SKIP_BROWSER_TESTS=1 leaves
// them out; the break-it check does that for breaks outside the screens,
// which can only make a break look less caught, never more.
const browserTests = process.env['SKIP_BROWSER_TESTS'] === '1'
  ? []
  : [
      {
        test: {
          name: 'web-browser',
          root: './packages/web',
          include: ['test/browser/**/*.test.ts'],
          globalSetup: ['test/browser/build-once.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ];

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'money', root: './packages/money' } },
      { test: { name: 'server', root: './packages/server', include: ['test/**/*.test.ts'] } },
      { test: { name: 'web', root: './packages/web', include: ['test/*.test.ts'] } },
      ...browserTests,
      { test: { name: 'repo', include: ['test/**/*.test.ts'] } },
    ],
  },
});
