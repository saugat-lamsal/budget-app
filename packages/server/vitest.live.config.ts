import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The tests that call Plaid's test bank (sandbox): npm run test:sandbox.
// They need the network and the sandbox keys in .env. npm test never runs
// them. They make new test-bank connections each run, and wait for the test
// bank between steps, so they take a few minutes.
export default defineConfig({
  test: {
    name: 'sandbox',
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['live/**/*.live.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
