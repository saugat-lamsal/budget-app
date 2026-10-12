import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupFromEnv, litestreamBin, litestreamConfig, litestreamEnv, runLitestream, withoutBackup, type Backup } from '../backup/backup.js';
import { consoleLog, type Log } from '../log.js';
import { EXIT } from './exit-codes.js';
import { checkOneMachine } from './one-machine.js';
import { serveOptions } from './options.js';
import { Supervisor } from './supervisor.js';

// Phase 6: what the image runs on Fly.io (the Dockerfile's CMD), in order:
// 1. The hosted settings are all there (APP_ORIGIN, the books' path, the
//    backup), or nothing starts.
// 2. Only one machine (one-machine.ts), or nothing starts.
// 3. The books: when the volume has none (a new machine, or a lost volume),
//    they are rebuilt from the backup first; with no backup yet (the very
//    first start), they start empty. If the backup cannot be read, nothing
//    starts (Fly tries again): a fresh start must never cover a backup.
// 4. Litestream and the server, kept running by the supervisor.
// The server is the same command as npm run serve (serve.mjs), with
// --connect-once: its first start connects Plaid's test bank.

export type RestoreOutcome = { readonly kind: 'there' } | { readonly kind: 'restored' } | { readonly kind: 'none' } | { readonly kind: 'failed'; readonly output: string };

// Step 3: the books from the backup, when the volume has none.
export async function restoreIfMissing(db: string, backup: Backup, bin: string, config: string): Promise<RestoreOutcome> {
  if (existsSync(db)) return { kind: 'there' };
  mkdirSync(dirname(db), { recursive: true });
  const ran = await runLitestream(bin, ['restore', '-config', config, '-if-replica-exists', '-integrity-check', 'full', db], litestreamEnv(db, backup));
  if (ran.code !== 0) return { kind: 'failed', output: ran.output };
  return existsSync(db) ? { kind: 'restored' } : { kind: 'none' };
}

export interface Hosted {
  readonly db: string;
  readonly backup: Backup;
}

// Step 1: what the hosted server needs, or why it cannot start.
export function hostedSettings(env: Readonly<Record<string, string | undefined>>): Hosted {
  const options = serveOptions([], env, '/');
  if (options.hosted === null) throw new Error('APP_ORIGIN is not set: this starts the hosted server only (fly.toml sets it); on a computer, npm run serve');
  if (env['BUDGET_DB'] === undefined || env['BUDGET_DB'] === '') throw new Error('BUDGET_DB is not set: the books\' file on the volume (fly.toml sets it)');
  const backup = backupFromEnv(env);
  if (backup === null) throw new Error('no backup is set: the hosted server does not run without one. Set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY with fly secrets set');
  return { db: options.db, backup };
}

async function main(): Promise<void> {
  const env = process.env;
  const secrets = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'BANK_TOKEN_KEY', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'VAPID_PRIVATE_KEY'].map((name) => env[name] ?? '');
  const log: Log = consoleLog(secrets);
  let hosted: Hosted;
  try {
    hosted = hostedSettings(env);
  } catch (error) {
    log.error('the server did not start', { why: error instanceof Error ? error.message : String(error) });
    process.exit(EXIT.didNotStart);
  }
  const machines = await checkOneMachine(env);
  if (machines.note !== null) log.warn(machines.note);
  if (machines.problem !== null) {
    log.error('the server did not start', { why: machines.problem });
    process.exit(EXIT.didNotStart);
  }
  const bin = litestreamBin(env);
  const config = litestreamConfig(env);
  const restored = await restoreIfMissing(hosted.db, hosted.backup, bin, config);
  if (restored.kind === 'failed') {
    log.error('the server did not start: the volume has no books, and the backup could not be read, so they were not rebuilt; Fly starts it again', { litestream: restored.output.trim().split(/\r?\n/).slice(-3).join(' | ') });
    process.exit(EXIT.failed);
  }
  if (restored.kind === 'restored') log.info('the volume had no books: rebuilt them from the backup');
  if (restored.kind === 'none') log.info('the volume had no books and there is no backup yet: starting with empty books');

  const serveScript = fileURLToPath(new URL('./serve.mjs', import.meta.url));
  const supervisor = new Supervisor({
    startLitestream: () => spawn(bin, ['replicate', '-config', config], { env: litestreamEnv(hosted.db, hosted.backup, env), stdio: ['ignore', 'inherit', 'inherit'] }),
    startServer: () => spawn(process.execPath, [serveScript, '--connect-once'], { env: withoutBackup(env), stdio: ['ignore', 'inherit', 'inherit'] }),
    log,
    clock: { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  });
  supervisor.start();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log.info('stopping: the server first, then Litestream after its last copy');
      void supervisor.stop().then(() => process.exit(EXIT.stopped));
    });
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) await main();
