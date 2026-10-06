import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'money', root: './packages/money' } },
      { test: { name: 'repo', include: ['test/**/*.test.ts'] } },
    ],
  },
});
