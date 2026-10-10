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
const COMMANDS = {
  serve: 'packages/server/src/serve/main.ts',
  'replay-check': 'packages/server/src/serve/replay-check.ts',
  'login-code': 'packages/server/src/serve/login-code.ts',
};

export async function buildServer() {
  await build({
    configFile: false,
    root: path('packages/server'),
    logLevel: 'warn',
    ssr: { noExternal: true, external: ['better-sqlite3'] },
    build: {
      ssr: true,
      outDir: path('packages/server/dist/serve'),
      emptyOutDir: true,
      target: 'node22',
      rollupOptions: { input: Object.fromEntries(Object.entries(COMMANDS).map(([name, file]) => [name, path(file)])), output: { entryFileNames: '[name].mjs' } },
    },
  });
}

// Runs a built command with the arguments given, passing Ctrl+C on, and
// exits with its code.
export function runCommand(name, args) {
  const child = spawn(process.execPath, [path(`packages/server/dist/serve/${name}.mjs`), ...args], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code ?? 0));
}
