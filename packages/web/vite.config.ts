import { defineConfig } from 'vite';

// The screens. npm run demo builds them and serves them with made-up
// numbers; the browser tests build them once per run (test/browser/build-once.ts).
export default defineConfig({
  // JSX through Vite's own transform, with React's automatic runtime.
  oxc: { jsx: { runtime: 'automatic' } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // iPhone Safari from iOS 16.4, the first that can add web apps to the
    // home screen with notifications.
    target: 'safari16.4',
  },
});
