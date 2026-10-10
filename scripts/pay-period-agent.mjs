// npm run pay-period-agent [-- --port N] [-- --control N]
//
// Phase 4's finish line, Step 2: the real server with the planned pay
// period's made-up bank (packages/web/test/browser/pay-period/agent-server.ts),
// for an agent that uses the app in a browser like a person and has not seen
// the code (agent-pay-period/). No real bank and no real money: Plaid is never
// called, and the books are in a database file of their own, removed when it
// stops. The app is on http://localhost:5390 and a control page on
// http://localhost:5391 ("Log this browser in", "Bring in the next day").
import { build } from 'vite';
import { path, runBuilt } from './server-build.mjs';

await build({ root: path('packages/web'), logLevel: 'warn' });
await build({
  configFile: false,
  root: path('packages/web'),
  logLevel: 'warn',
  ssr: { noExternal: true, external: ['better-sqlite3'] },
  build: {
    ssr: true,
    outDir: path('packages/server/dist/agent'),
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { input: { 'agent-server': path('packages/web/test/browser/pay-period/agent-server.ts') }, output: { entryFileNames: '[name].mjs' } },
  },
});
runBuilt('packages/server/dist/agent/agent-server.mjs', process.argv.slice(2), { WEB_ROOT: path('packages/web/dist/') });
