import { statement, type Db } from '../db/database.js';

// When the bank was read, and how often to read it (Step 3, rulebook section
// 2). A read is a sync that reached the bank, whether or not it brought
// anything new; one that failed is not (database step 4, bank_reads). Home's
// "Checked at" is the last read, and the next sync is due one interval after
// the last one started. Nothing here asks the clock: times are handed in.

// Section 2: sync with the bank every 60 minutes, a setting.
export const SYNC_EVERY_MINUTES = 60;
// The setting takes a whole number of minutes from 15 (the bank's own
// updates come a few times a day) to 1,440 (once a day).
export const FEWEST_MINUTES = 15;
export const MOST_MINUTES = 1440;

const EVERY = 'sync-every-minutes';

// The moment the bank was last read, as an instant (ISO, UTC); null before the first.
// Read each minute by the alert timer (10.7): prepared once.
export function readLastRead(db: Db): string | null {
  const row = statement(db, 'SELECT at FROM bank_reads ORDER BY id DESC LIMIT 1').get() as { at: string } | undefined;
  return row?.at ?? null;
}

export function saveBankRead(db: Db, read: { readonly at: string; readonly changed: boolean }): void {
  db.prepare('INSERT INTO bank_reads (at, changed) VALUES (?, ?)').run(read.at, read.changed ? 1 : 0);
}

export function syncEveryMinutes(db: Db): number {
  const row = db.prepare('SELECT value FROM settings WHERE name = ?').get(EVERY) as { value: string } | undefined;
  return row === undefined ? SYNC_EVERY_MINUTES : Number(JSON.parse(row.value));
}

export function saveSyncEveryMinutes(db: Db, minutes: number): void {
  db.prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value').run(EVERY, JSON.stringify(minutes));
}
