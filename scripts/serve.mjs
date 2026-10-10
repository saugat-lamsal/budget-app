// npm run serve [-- --connect] [-- --sync] [-- --port N] [-- --db <file>]
//
// Builds the screens and the real server, then starts it: the screens from
// the database (data/budget.sqlite unless --db says another file). Plaid's test
// bank only, this computer only, no login yet. It needs PLAID_ENV=sandbox,
// PLAID_CLIENT_ID, PLAID_SECRET and BANK_TOKEN_KEY in .env.
//   --connect   connects the test bank first, with made-up accounts like his
//   --sync      syncs with the test bank once before serving
// The demo (npm run demo) is separate and never opens the database.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));

await build({ root: path('packages/web'), logLevel: 'warn' });
await build({
  configFile: false,
  root: path('packages/server'),
  logLevel: 'warn',
  // One file, but the database driver stays outside it: it is compiled for
  // this computer and is loaded from node_modules.
  ssr: { noExternal: true, external: ['better-sqlite3'] },
  build: {
    ssr: path('packages/server/src/serve/main.ts'),
    outDir: path('packages/server/dist/serve'),
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'serve.mjs' } },
  },
});

const child = spawn(process.execPath, [path('packages/server/dist/serve/serve.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
