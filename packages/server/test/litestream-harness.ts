import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { litestreamPath } from '../../../scripts/litestream.mjs';
import { backupFromEnv, litestreamEnv, type Backup } from '../src/backup/backup.js';
import type { FakeR2 } from './fake-r2.js';

// Phase 6, for the tests: the real Litestream (the version the image has,
// put on this computer by npm run litestream, outside the project), run with
// the project's own litestream.yml against the stand-in for R2.

export const CONFIG = fileURLToPath(new URL('../../../litestream.yml', import.meta.url));

// Litestream cannot rebuild a database on Windows (it is not a system it
// supports: it fails flushing a folder). The tests that restore run on Linux
// and macOS: CI, and the image.
export const CAN_RESTORE = process.platform !== 'win32';

export function litestreamBin(): string {
  const bin = process.env['LITESTREAM_BIN'] ?? litestreamPath();
  if (!existsSync(bin)) throw new Error(`Litestream is not on this computer: run npm run litestream (it looked for ${bin})`);
  return bin;
}

export function backupOf(r2: FakeR2, change: Partial<Record<string, string>> = {}): Backup {
  const backup = backupFromEnv({ ...r2.env(), ...change });
  if (backup === null) throw new Error('no backup');
  return backup;
}

export interface Replicating {
  readonly child: ChildProcess;
  output(): string;
  stop(): Promise<void>;
}

// litestream replicate, copying `db` to the stand-in, until stopped. Its
// heartbeat (A43) goes to the server on `env.PORT` of this computer.
export function replicate(db: string, backup: Backup, env: Readonly<Record<string, string>> = {}): Replicating {
  let output = '';
  const child = spawn(litestreamBin(), ['replicate', '-config', CONFIG], { env: litestreamEnv(db, backup, { ...process.env, ...env }), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return {
    child,
    output: () => output,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await ended;
    },
  };
}

export async function until(what: string, check: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`waited ${ms / 1000} s for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Until Litestream has put something new in the bucket since `since` (a count
// of the stand-in's requests), and then nothing more for a second and a half:
// it has copied all it had.
export async function copied(r2: FakeR2, since: number): Promise<void> {
  await until('Litestream to copy the change', () => r2.requests.slice(since).some((r) => r.operation === 'PutObject' && r.status === 200));
  let seen = r2.requests.length;
  let quietSince = Date.now();
  await until('Litestream to finish copying', () => {
    if (r2.requests.slice(seen).some((r) => r.operation === 'PutObject')) quietSince = Date.now();
    seen = r2.requests.length;
    return Date.now() - quietSince >= 1_500;
  });
}
