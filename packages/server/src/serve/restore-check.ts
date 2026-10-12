import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupFromEnv, litestreamBin, litestreamConfig } from '../backup/backup.js';
import { restoreCheck } from '../backup/restore-check.js';
import { serveOptions } from './options.js';

// Phase 6, the restore check:
//   on the machine:   fly ssh console -C "node /app/serve/restore-check.mjs"
//   on a computer:    npm run restore-check [-- --out <file>]   (not Windows)
// Rebuilds the books from the backup in R2 into a new file (in the temporary
// folder unless --out says another), and checks the copy: whole, and every
// event replaying to the totals saved with it (0.6). It never touches the live
// books or the bank. The bucket and its key come from the environment (Fly
// secrets on the machine; .env on a computer).

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const envFile = `${root}.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile);

if (process.platform === 'win32') {
  console.error('Litestream cannot rebuild a database on Windows (it does not support it). Run the check on the server instead:');
  console.error('  fly ssh console -C "node /app/serve/restore-check.mjs"');
  process.exit(2);
}

let run: Parameters<typeof restoreCheck>[0];
try {
  const args = process.argv.slice(2);
  let out = join(tmpdir(), `budget-restore-check-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  if (args[0] === '--out') {
    if (args[1] === undefined || args[1] === '' || args.length > 2) throw new Error('--out needs a file, and nothing after it');
    out = args[1];
  } else if (args.length > 0) throw new Error(`not an option: ${String(args[0])}`);
  const backup = backupFromEnv(process.env);
  if (backup === null) throw new Error('no backup is set: R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY');
  run = { backup, db: serveOptions([], process.env, root).db, out, bin: litestreamBin(), config: process.env['LITESTREAM_CONFIG'] ?? (existsSync('/etc/litestream.yml') ? litestreamConfig() : join(root, 'litestream.yml')) };
} catch (error) {
  console.error(`The check did not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

const report = await restoreCheck(run);
for (const line of report.lines) console.log(line);
process.exitCode = report.ok ? 0 : 1;
