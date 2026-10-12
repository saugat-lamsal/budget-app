import { existsSync } from 'node:fs';
import { openDatabase } from '../db/database.js';
import { readHistory } from '../history/history-db.js';
import { checkRetotal } from '../history/retotal.js';
import { litestreamEnv, runLitestream, type Backup } from './backup.js';

// Phase 6: the restore check. Rebuilds the books from the backup into a new
// file (never the live one), then checks the copy the way the server checks
// its books when it starts: SQLite's own check that the file is whole, and
// the replay check (0.6), every event replaying to the totals saved with it.
// Run on the machine (fly ssh console), it proves the backup can rebuild the
// books, whatever happens to the machine and its volume.

export interface RestoreCheckInput {
  readonly backup: Backup;
  // The books as litestream.yml names them (BUDGET_DB): the backup is of this file.
  readonly db: string;
  // The new file to rebuild into. It must not exist yet.
  readonly out: string;
  // Litestream, and its configuration.
  readonly bin: string;
  readonly config: string;
}

export interface RestoreCheckReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (date: string): string => {
  const [year, month, d] = date.split('-').map(Number);
  return `${MONTHS[(month ?? 1) - 1] ?? ''} ${d ?? ''}, ${year ?? ''}`;
};

// What Litestream said last that is about the failure, without its log lines' clutter.
function said(output: string): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  const last = lines.at(-1) ?? 'nothing';
  try {
    const parsed = JSON.parse(last) as { msg?: unknown; error?: unknown };
    return [parsed.msg, parsed.error].filter((v) => typeof v === 'string').join(': ') || last;
  } catch {
    return last.replace(/^Error:\s*/, '');
  }
}

export async function restoreCheck(input: RestoreCheckInput): Promise<RestoreCheckReport> {
  const { out } = input;
  if (['', '-wal', '-shm', '-journal'].some((end) => existsSync(`${out}${end}`))) {
    return { ok: false, lines: [`${out} is there already. Nothing was changed: the check rebuilds into a new file only.`] };
  }
  const ran = await runLitestream(input.bin, ['restore', '-config', input.config, '-integrity-check', 'full', '-o', out, input.db], litestreamEnv(input.db, input.backup));
  if (ran.code !== 0 || !existsSync(out)) {
    return { ok: false, lines: ['The books could not be rebuilt from the backup.', `Litestream said: ${said(ran.output)}`] };
  }
  const lines = [`Rebuilt the books from the backup into ${out}.`];
  const books = openDatabase(out);
  try {
    const whole = books.pragma('integrity_check', { simple: true });
    if (whole !== 'ok') return { ok: false, lines: [...lines, `The rebuilt file is not whole: SQLite's integrity check says ${String(whole)}.`] };
    lines.push("The file is whole (SQLite's integrity check).");
    const history = readHistory(books);
    const last = history.at(-1);
    lines.push(last === undefined ? 'History: nothing yet.' : `History: ${history.length.toLocaleString('en-US')} ${history.length === 1 ? 'event' : 'events'}, the last on ${day(last.date)}.`);
    const found = checkRetotal(books);
    if (found.state === 'cannot-replay') return { ok: false, lines: [...lines, `Event ${found.at.seq}, ${day(found.at.date)} (${found.at.what}) cannot be replayed: ${found.why}.`] };
    if (found.state === 'changed') {
      return { ok: false, lines: [...lines, `${found.events.length === 1 ? '1 event replays' : `${found.events.length} events replay`} to other totals than the ones saved with ${found.events.length === 1 ? 'it' : 'them'}, from event ${found.events[0]?.seq ?? ''} on (0.6). The server would not start on these books: see npm run replay-check.`] };
    }
    lines.push('Every event replays to the totals saved with it (0.6).');
    lines.push('The backup works.');
    return { ok: true, lines };
  } finally {
    books.close();
  }
}
