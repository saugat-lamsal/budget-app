// Builds the real server's commands into packages/server/dist/serve: one file
// each, with the database driver left outside (it is compiled for this
// computer and is loaded from node_modules). Used by npm run serve and the
// commands that go with it (npm run replay-check).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = new URL('../', import.meta.url);
export const path = (p) => fileURLToPath(new URL(p, root));

// The commands, by name: the file each is built from.
// Phase 6: start (what the image runs on Fly.io: the server and Litestream)
// and restore-check (the backup rebuilt into a new file, and checked).
export const COMMANDS = {
  serve: 'packages/server/src/serve/main.ts',
  'replay-check': 'packages/server/src/serve/replay-check.ts',
  'login-code': 'packages/server/src/serve/login-code.ts',
  start: 'packages/server/src/serve/start.ts',
  'restore-check': 'packages/server/src/serve/restore-check.ts',
};

// outDir: packages/server/dist/serve unless a test builds them somewhere of its own.
export async function buildServer(outDir = path('packages/server/dist/serve')) {
  await build({
    configFile: false,
    root: path('packages/server'),
    logLevel: 'warn',
    // The database driver (compiled for this computer) and web push (loads its parts at run time) come from node_modules.
    ssr: { noExternal: true, external: ['better-sqlite3', 'web-push'] },
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      target: 'node22',
      rollupOptions: { input: Object.fromEntries(Object.entries(COMMANDS).map(([name, file]) => [name, path(file)])), output: { entryFileNames: '[name].mjs' } },
    },
  });
}

// Runs a built command with the arguments given, passing Ctrl+C on, and
// exits with its code.
export function runCommand(name, args) {
  runBuilt(`packages/server/dist/serve/${name}.mjs`, args);
}

// The same for any built file, with more in its environment.
export function runBuilt(file, args, env = {}) {
  const child = spawn(process.execPath, [path(file), ...args], { stdio: 'inherit', env: { ...process.env, ...env } });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code ?? 0));
}
