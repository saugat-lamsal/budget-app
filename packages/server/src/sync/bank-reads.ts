import type { Cents } from '@budget-app/money';
import type { BankAtRead } from '../bank/why.js';
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

// 10.4 (A47): when the totals stopped matching the bank (an instant), or
// null while they match. Read each minute by the alert timer: prepared once.
export function readGapSince(db: Db): string | null {
  const row = statement(db, 'SELECT since FROM bank_gap WHERE id = 1').get() as { since: string } | undefined;
  return row?.since ?? null;
}

export function saveGapSince(db: Db, since: string | null): void {
  if (since === null) db.prepare('DELETE FROM bank_gap').run();
  else db.prepare('INSERT INTO bank_gap (id, since) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET since = excluded.since').run(since);
}

// A read of the bank, saved in the sync's own transaction. 12.6 and 11.4
// (database step 11): the sync it saved (when it brought anything new), the
// bank as it left it, and the check after it (null before setup day, or when
// the bank's balances could not be worked out).
export interface BankRead {
  readonly at: string;
  readonly changed: boolean;
  readonly sync?: number | null;
  readonly bank?: BankAtRead | null;
  readonly difference?: Cents | null;
}

export function saveBankRead(db: Db, read: BankRead): void {
  db.prepare('INSERT INTO bank_reads (at, changed, sync, bank, difference) VALUES (?, ?, ?, ?, ?)').run(
    read.at,
    read.changed ? 1 : 0,
    read.sync ?? null,
    read.bank === undefined || read.bank === null ? null : JSON.stringify(read.bank),
    read.difference ?? null,
  );
}

// 12.6: the last read whose check matched, with the bank as it left it;
// null when none is kept (none since database step 11).
export function readLastMatchingRead(db: Db): { readonly at: string; readonly bank: BankAtRead } | null {
  const row = statement(db, 'SELECT at, bank FROM bank_reads WHERE difference = 0 AND bank IS NOT NULL ORDER BY id DESC LIMIT 1').get() as { at: string; bank: string } | undefined;
  return row === undefined ? null : { at: row.at, bank: JSON.parse(row.bank) as BankAtRead };
}

// 14.3: setup day starts with the books matching the bank, as the last read
// left it (nothing about the bank changes between reads): that read counts as
// one that matched, for 12.6.
export function markSetupRead(db: Db): void {
  db.prepare('UPDATE bank_reads SET difference = 0 WHERE id = (SELECT MAX(id) FROM bank_reads) AND bank IS NOT NULL AND difference IS NULL').run();
}

// 11.4: when each sync was saved, as the read that saved it says (an
// instant); syncs saved without a read (or before database step 11, when
// which read saved which is not known) are not here.
export function readSyncTimes(db: Db): ReadonlyMap<number, string> {
  const rows = statement(db, 'SELECT sync, at FROM bank_reads WHERE sync IS NOT NULL').all() as { sync: number; at: string }[];
  return new Map(rows.map((r) => [r.sync, r.at]));
}

export function syncEveryMinutes(db: Db): number {
  const row = db.prepare('SELECT value FROM settings WHERE name = ?').get(EVERY) as { value: string } | undefined;
  return row === undefined ? SYNC_EVERY_MINUTES : Number(JSON.parse(row.value));
}

export function saveSyncEveryMinutes(db: Db, minutes: number): void {
  db.prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value').run(EVERY, JSON.stringify(minutes));
}
