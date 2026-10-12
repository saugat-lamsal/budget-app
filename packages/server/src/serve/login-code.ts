import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Auth, CODE_MINUTES } from '../auth/auth.js';
import { openDatabase } from '../db/database.js';
import { serveOptions } from './options.js';

// npm run login-code [-- --db <file>] [-- --port N]
// Step 2: a new one-time code, for when he has lost all his passkeys (or
// before the first). Only on the computer the books are on: it opens the
// database file directly. Hosted (Phase 6): fly ssh console -C "node
// /app/serve/login-code.mjs", which shows it in his own window, never in
// the server's log. The code makes a new passkey on the device it is
// typed on; good once, for 15 minutes, and any older code stops working.

const root = fileURLToPath(new URL('../../../../', import.meta.url));
let options: ReturnType<typeof serveOptions>;
try {
  options = serveOptions(process.argv.slice(2), process.env, root);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
mkdirSync(dirname(options.db), { recursive: true });
const db = openDatabase(options.db);
try {
  const origin = options.hosted ?? `http://localhost:${options.port}`;
  const auth = new Auth({ db, now: () => new Date(), origin, today: () => new Date().toISOString().slice(0, 10), bookLines: () => 0 });
  const code = auth.newCode();
  console.log(`One-time code: ${code}`);
  console.log(`Good once, for ${CODE_MINUTES} minutes. Open ${origin}/login, choose "Use a one-time code", and type it in. It makes a new passkey on that device.`);
} finally {
  db.close();
}
