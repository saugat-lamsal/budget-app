import { spawn } from 'node:child_process';
import { backupLock, endpointProblem, type BackupLock } from './backup-lock.js';

// Phase 6, the backups: Litestream copies the books (one SQLite file) to a
// Cloudflare R2 bucket as they change, and can rebuild them from it. The
// bucket, its address and its key come from the environment (Fly secrets)
// only: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
// litestream.yml (in the image at /etc/litestream.yml) reads them from
// there. Litestream is given those four and the database's path, and nothing
// else of the server's: not the bank key, the Plaid keys or the push keys.

export interface Backup {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

const NAMES = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const;

// The backup set in the environment, or null when none of it is. Partly set,
// or an address the lock does not allow: an error that says what, without
// repeating the key.
export function backupFromEnv(env: Readonly<Record<string, string | undefined>>, lock: BackupLock = backupLock(env)): Backup | null {
  const values = NAMES.map((name) => env[name]?.trim() ?? '');
  if (values.every((v) => v === '')) return null;
  const missing = NAMES.filter((_, i) => values[i] === '');
  if (missing.length > 0) throw new Error(`the backup is only partly set: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing`);
  const [endpoint = '', bucket = '', accessKeyId = '', secretAccessKey = ''] = values;
  const problem = endpointProblem(endpoint, lock);
  if (problem !== null) throw new Error(problem);
  // R2's rule for bucket names.
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('R2_BUCKET must be the bucket\'s name: 3 to 63 lower-case letters, digits and dashes');
  return sealed({ endpoint: new URL(endpoint).origin, bucket, accessKeyId, secretAccessKey });
}

// Logging or printing a backup shows nothing secret.
function sealed(backup: Backup): Backup {
  Object.defineProperty(backup, 'toJSON', { value: () => ({ endpoint: backup.endpoint, bucket: backup.bucket }) });
  Object.defineProperty(backup, Symbol.for('nodejs.util.inspect.custom'), { value: () => `Backup { bucket: ${backup.bucket}, [key hidden] }` });
  return Object.freeze(backup);
}

// Litestream's whole environment: the database's path and the backup, and
// what a program needs to run (its search path, and Windows' own folders).
// Every run of Litestream goes through here, so the lock is checked again
// right before each one, with the process's own environment.
export function litestreamEnv(db: string, backup: Backup, env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  const problem = endpointProblem(backup.endpoint, backupLock());
  if (problem !== null) throw new Error(problem);
  const keep = ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA'];
  const out: Record<string, string> = {};
  for (const name of keep) {
    const value = env[name];
    if (value !== undefined) out[name] = value;
  }
  return { ...out, BUDGET_DB: db, R2_ENDPOINT: backup.endpoint, R2_BUCKET: backup.bucket, R2_ACCESS_KEY_ID: backup.accessKeyId, R2_SECRET_ACCESS_KEY: backup.secretAccessKey };
}

// The server's environment without the backup's key: it does not need it.
export function withoutBackup(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined && !NAMES.includes(name as (typeof NAMES)[number]) && !name.startsWith('LITESTREAM_ACCESS') && !name.startsWith('LITESTREAM_SECRET')) out[name] = value;
  return out;
}

// The Litestream program (LITESTREAM_BIN, or litestream on the search path)
// and its configuration (LITESTREAM_CONFIG, or /etc/litestream.yml as in the image).
export function litestreamBin(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env['LITESTREAM_BIN'] ?? 'litestream';
}

export function litestreamConfig(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env['LITESTREAM_CONFIG'] ?? '/etc/litestream.yml';
}

export interface Ran {
  readonly code: number;
  readonly output: string;
}

// Runs Litestream once (restore), with only its own environment, and gives
// back how it ended and what it said. Never throws for a failure: the code says.
export function runLitestream(bin: string, args: readonly string[], env: Record<string, string>): Promise<Ran> {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(bin, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.on('error', (error) => resolve({ code: 127, output: `${output}${error.message}` }));
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}
