import { fileURLToPath } from 'node:url';
import { build, defineConfig, type Plugin } from 'vite';

// The screens. npm run demo builds them and serves them with made-up
// numbers; the browser tests build them once per run (test/browser/build-once.ts).

// iPhone Safari from iOS 16.4, the first that can add web apps to the home
// screen with notifications.
const TARGET = 'safari16.4';

// The service worker (src/sw/sw.ts, Phase 5): its own file, at /sw.js so it
// covers the whole app, built after the screens as one classic script that
// shares nothing with them (a service worker that imports other files needs
// support Safari 16.4 may not have).
function serviceWorker(): Plugin {
  return {
    name: 'budget-service-worker',
    apply: 'build',
    async closeBundle() {
      await build({
        configFile: false,
        root: fileURLToPath(new URL('.', import.meta.url)),
        logLevel: 'error',
        build: {
          outDir: 'dist',
          emptyOutDir: false,
          target: TARGET,
          copyPublicDir: false,
          lib: { entry: 'src/sw/sw.ts', formats: ['iife'], name: 'budgetServiceWorker', fileName: () => 'sw.js' },
        },
      });
    },
  };
}

export default defineConfig({
  // JSX through Vite's own transform, with React's automatic runtime.
  oxc: { jsx: { runtime: 'automatic' } },
  plugins: [serviceWorker()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: TARGET,
  },
});
