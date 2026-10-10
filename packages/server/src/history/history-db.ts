import { MoneyError, type BankTransaction, type Book, type Cents, type IsoDate, type SetupInput } from '@budget-app/money';
import type { Db } from '../db/database.js';
import { ReplayFailed, bookOfSetup, replayCall, sameTotals, totalsOf, type Answer, type HistoryEvent, type SavedSetupAnswers, type Totals } from './history.js';

// The book's history in the database (table book_events), the decision
// numbers with their first answers (table decisions), and when Home last
// checked safe to spend against the bank (table last_checked). Nothing here
// asks the clock: every date is in what is saved.

export interface StoredEvent {
  readonly seq: number;
  readonly date: IsoDate;
  // The sync that brought it, for what the bank sent.
  readonly sync: number | null;
  readonly event: HistoryEvent;
  // The totals after it; null before setup day, and for events saved before
  // the totals were (they are filled in, once, the first time they replay).
  readonly totals: Totals | null;
  readonly sealed: boolean;
}

interface Row {
  seq: number;
  sync: number | null;
  kind: 'setup' | 'receive' | 'answer';
  date: string;
  payload: string;
  totals: string | null;
}

export function readHistory(db: Db): StoredEvent[] {
  const rows = db.prepare('SELECT seq, sync, kind, date, payload, totals FROM book_events ORDER BY seq').all() as Row[];
  return rows.map((row) => {
    const payload = JSON.parse(row.payload) as unknown;
    const event: HistoryEvent =
      row.kind === 'setup' ? { kind: 'setup', input: payload as SetupInput } : row.kind === 'receive' ? { kind: 'receive', txn: payload as BankTransaction } : { kind: 'answer', answer: payload as Answer };
    const totals = row.totals === null ? null : (JSON.parse(row.totals) as Totals | null);
    return { seq: row.seq, date: row.date, sync: row.sync, event, totals, sealed: row.totals !== null };
  });
}

// Adds one event at the end of the history, with the totals after it.
// Returns its number.
export function appendEvent(db: Db, e: { readonly event: HistoryEvent; readonly date: IsoDate; readonly sync: number | null; readonly totals: Totals | null }): number {
  const payload = e.event.kind === 'setup' ? e.event.input : e.event.kind === 'receive' ? e.event.txn : e.event.answer;
  const info = db.prepare('INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (?, ?, ?, ?, ?)').run(e.sync, e.event.kind, e.date, JSON.stringify(payload), JSON.stringify(e.totals));
  return Number(info.lastInsertRowid);
}

// ----- Replaying -----

// What the history comes to.
export interface Replayed {
  readonly book: Book | null;
  // 10.6: the take-backs he marked seen.
  readonly seen: Set<string>;
  // Setup day, before tracking starts: his answers so far; null before the first.
  readonly setupAnswers: SavedSetupAnswers | null;
  // Events saved before their totals were, with the totals they replay to.
  readonly unsealed: readonly { readonly seq: number; readonly totals: Totals | null }[];
}

// The history does not replay to what was saved: a change to the code would
// rewrite the past. At names the first event that differs.
export class HistoryDoesNotReplay extends Error {
  readonly at: { readonly seq: number; readonly kind: HistoryEvent['kind']; readonly date: IsoDate };
  readonly saved: Totals | null;
  readonly replayed: Totals | null;

  constructor(at: StoredEvent, why: string, saved: Totals | null, replayed: Totals | null) {
    super(`The history does not replay to what was saved, at event ${at.seq} (${describe(at)}, ${at.date}): ${why}`);
    this.name = 'HistoryDoesNotReplay';
    this.at = { seq: at.seq, kind: at.event.kind, date: at.date };
    this.saved = saved;
    this.replayed = replayed;
  }
}

function describe(e: StoredEvent): string {
  switch (e.event.kind) {
    case 'setup':
      return 'setup day';
    case 'receive':
      return `from the bank: ${e.event.txn.kind} ${e.event.txn.id}`;
    case 'answer': {
      const a = e.event.answer;
      const parts = [
        ...(a.book ?? []).map((c) => c.method),
        ...(a.seen === undefined ? [] : ['seen']),
        ...(a.bankRules === undefined ? [] : ['a bank rule']),
        ...(a.setup === undefined ? [] : ['a setup day answer']),
      ];
      return `his answer: ${parts.join(', ') || 'nothing'}`;
    }
  }
}

// Replays every event, in order. With check, the totals after each event
// must be the ones saved with it; the first that differs, or an event the
// code refuses now, stops it (HistoryDoesNotReplay).
export function replayHistory(events: readonly StoredEvent[], check: boolean): Replayed {
  let book: Book | null = null;
  const seen = new Set<string>();
  let setupAnswers: SavedSetupAnswers | null = null;
  const unsealed: { seq: number; totals: Totals | null }[] = [];
  for (const stored of events) {
    try {
      book = applyEvent(book, stored.event, seen, (answers) => {
        setupAnswers = answers;
      });
    } catch (error) {
      if (error instanceof ReplayFailed || error instanceof MoneyError) {
        throw new HistoryDoesNotReplay(stored, error.message, stored.totals, null);
      }
      throw error;
    }
    if (!check) continue;
    const now = totalsOf(book);
    if (!stored.sealed) unsealed.push({ seq: stored.seq, totals: now });
    else if (!sameTotals(stored.totals, now)) throw new HistoryDoesNotReplay(stored, 'the totals differ', stored.totals, now);
  }
  return { book, seen, setupAnswers, unsealed };
}

function applyEvent(book: Book | null, event: HistoryEvent, seen: Set<string>, setSetup: (answers: SavedSetupAnswers) => void): Book | null {
  switch (event.kind) {
    case 'setup':
      if (book !== null) throw new ReplayFailed('a second setup day');
      return bookOfSetup(event.input);
    case 'receive':
      if (book === null) throw new ReplayFailed('the bank sent something to the book before setup day');
      book.receive(event.txn);
      return book;
    case 'answer': {
      const a = event.answer;
      if (a.book !== undefined) {
        if (book === null) throw new ReplayFailed('an answer to the book before setup day');
        for (const call of a.book) replayCall(book, call);
      }
      if (a.seen !== undefined) seen.add(a.seen);
      if (a.setup !== undefined) setSetup(a.setup);
      return book;
    }
  }
}

// Fills in the totals of events saved before the totals were, with what
// they replay to. Done once; they are checked from then on.
export function sealHistory(db: Db, unsealed: Replayed['unsealed']): void {
  if (unsealed.length === 0) return;
  const update = db.prepare('UPDATE book_events SET totals = ? WHERE seq = ? AND totals IS NULL');
  db.transaction(() => {
    for (const u of unsealed) update.run(JSON.stringify(u.totals), u.seq);
  })();
}

// ----- Decision numbers -----

export type DeskName = 'choice' | 'move' | 'settings' | 'rule' | 'setup' | 'bank-rule';

export interface Decision {
  readonly id: string;
  readonly desk: DeskName;
  // The request, written the same way whatever order its keys came in.
  readonly fingerprint: string;
  // The first answer, as sent to the phone.
  readonly answer: unknown;
  // The event it made.
  readonly seq: number;
}

export function readDecision(db: Db, id: string): Decision | null {
  const row = db.prepare('SELECT id, desk, fingerprint, answer, seq FROM decisions WHERE id = ?').get(id) as { id: string; desk: DeskName; fingerprint: string; answer: string; seq: number } | undefined;
  return row === undefined ? null : { ...row, answer: JSON.parse(row.answer) as unknown };
}

export function saveDecision(db: Db, d: Decision): void {
  db.prepare('INSERT INTO decisions (id, desk, fingerprint, answer, seq) VALUES (?, ?, ?, ?, ?)').run(d.id, d.desk, d.fingerprint, JSON.stringify(d.answer), d.seq);
}

// ----- When Home last checked safe to spend (0.5, B82) -----

export function readLastChecked(db: Db): { readonly amount: Cents; readonly at: string } | null {
  const row = db.prepare('SELECT amount, at FROM last_checked WHERE id = 1').get() as { amount: number; at: string } | undefined;
  return row === undefined ? null : { amount: row.amount, at: row.at };
}

export function saveLastChecked(db: Db, checked: { readonly amount: Cents; readonly at: string }): void {
  db.prepare('INSERT INTO last_checked (id, amount, at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET amount = excluded.amount, at = excluded.at').run(checked.amount, checked.at);
}
