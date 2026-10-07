// npm run demo [-- --wifi] [-- --port N]
//
// Builds the screens and the demo server, then starts it on made-up data
// only: no bank, no database, no keys. Without --wifi it is only reachable
// from this computer; with --wifi a phone on the same wifi can open it too.
//   npm run demo -- --build-only   builds and stops (for the screenshots)
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
  // Everything in one file, except Node's own modules. The demo uses
  // nothing else, so anything more (the database, say) would show up here.
  ssr: { noExternal: true },
  build: {
    ssr: path('packages/server/src/demo/main.ts'),
    outDir: path('packages/server/dist/demo'),
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'demo.mjs' } },
  },
});

const args = process.argv.slice(2);
if (!args.includes('--build-only')) {
  const child = spawn(process.execPath, [path('packages/server/dist/demo/demo.mjs'), ...args], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code ?? 0));
}
