import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db/database.js';
import { runReplayCheck } from '../history/replay-check-command.js';
import { serveOptions } from './options.js';

// npm run replay-check [-- --db <file>]
// QUESTIONS.md A28: when npm run serve does not start because the history no
// longer replays to the totals saved with it, this shows each event whose
// totals would change, before and after, and with his yes takes the new
// totals from that event on (logged, 13.5). Run it with the server stopped.
// It never talks to the bank.

const root = fileURLToPath(new URL('../../../../', import.meta.url));
let db: string;
try {
  db = serveOptions(process.argv.slice(2), process.env, root).db;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
mkdirSync(dirname(db), { recursive: true });
const books = openDatabase(db);
const terminal = createInterface({ input: process.stdin, output: process.stdout });
try {
  const result = await runReplayCheck({ db: books, now: () => new Date(), print: (line) => console.log(line), ask: (question) => terminal.question(question) });
  process.exitCode = result === 'cannot replay' ? 1 : 0;
} finally {
  terminal.close();
  books.close();
}
