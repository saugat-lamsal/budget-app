// npm run rehearsal [-- --port N] [-- --control N]
//
// Before Phase 7's connection day: the Bank screen (rules 1.1 to 1.3) against
// Plaid's test bank through the real Plaid Link, in a real browser, on this
// computer (packages/web/test/browser/rehearsal/rehearsal-server.ts). The test
// bank only (the lock refuses anything else; test-bank connections do not
// count against the 10), a throwaway database and bank key, removed when it
// stops. Needs the test bank's keys in .env. The app is on
// http://localhost:5392 and a control page on http://localhost:5393 ("Log this
// browser in", and what the books hold now).
import { build } from 'vite';
import { path, runBuilt } from './server-build.mjs';

await build({ root: path('packages/web'), logLevel: 'warn' });
await build({
  configFile: false,
  root: path('packages/web'),
  logLevel: 'warn',
  ssr: { noExternal: true, external: ['better-sqlite3', 'web-push'] },
  build: {
    ssr: true,
    outDir: path('packages/server/dist/rehearsal'),
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { input: { 'rehearsal-server': path('packages/web/test/browser/rehearsal/rehearsal-server.ts') }, output: { entryFileNames: '[name].mjs' } },
  },
});
runBuilt('packages/server/dist/rehearsal/rehearsal-server.mjs', process.argv.slice(2), { WEB_ROOT: path('packages/web/dist/') });
