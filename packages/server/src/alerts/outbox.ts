import { statement, type Db } from '../db/database.js';
import type { AlertFacts, AlertKind, AlertRecord } from './alerts.js';
import type { NotSentWhy } from './sending.js';

// The outbox (database step 5): every alert worked out, with when it was due
// and when it was sent. A row is written in the same step as the "alerts"
// event that gave it, so a restart finds every alert kept and none twice.
// Sending is a plug (serve/alert-timer.ts). A send that fails is tried again
// later; a send the server could not mark as done (it stopped in between) is
// tried again too, with the same id, so the phone shows it only once.
// Nothing here asks the clock: times are handed in, as instants (ISO, UTC),
// which compare in order as text.

export interface OutboxRow {
  readonly key: string;
  // The "alerts" event that gave it.
  readonly seq: number;
  readonly kind: AlertKind;
  readonly title: string;
  readonly body: string;
  // What it is about (database step 6, 10.10); null for one kept before.
  readonly facts: AlertFacts | null;
  readonly dueAt: string;
  readonly createdAt: string;
  // When the plug said it was handed over; null until then.
  readonly sentAt: string | null;
  readonly tries: number;
  readonly lastTryAt: string | null;
  readonly nextTryAt: string;
  readonly lastError: string | null;
  // Never sent (10.9, A40): a newer one of its kind went, or it was no longer
  // true by then; null for one sent or still to send.
  readonly notSent: NotSentWhy | null;
}

interface Row {
  key: string;
  seq: number;
  kind: AlertKind;
  title: string;
  body: string;
  facts: string | null;
  due_at: string;
  created_at: string;
  sent_at: string | null;
  tries: number;
  last_try_at: string | null;
  next_try_at: string;
  last_error: string | null;
  not_sent: NotSentWhy | null;
}

const COLUMNS = 'key, seq, kind, title, body, facts, due_at, created_at, sent_at, tries, last_try_at, next_try_at, last_error, not_sent';

function rowOf(r: Row): OutboxRow {
  return {
    key: r.key,
    seq: r.seq,
    kind: r.kind,
    title: r.title,
    body: r.body,
    facts: r.facts === null ? null : (JSON.parse(r.facts) as AlertFacts),
    dueAt: r.due_at,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    tries: r.tries,
    lastTryAt: r.last_try_at,
    nextTryAt: r.next_try_at,
    lastError: r.last_error,
    notSent: r.not_sent,
  };
}

// A send that failed is tried again after a minute, then after twice as long
// each time, but never more than an hour apart. It is never given up on.
export const FIRST_RETRY_MS = 60_000;
export const LONGEST_RETRY_MS = 3_600_000;

export function retryAfterMs(tries: number): number {
  return Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, Math.min(tries - 1, 20)));
}

export function addToOutbox(db: Db, alert: AlertRecord, seq: number, createdAt: string): void {
  statement(db, 'INSERT INTO outbox (key, seq, kind, title, body, facts, due_at, created_at, tries, next_try_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)').run(
    alert.key,
    seq,
    alert.facts.kind,
    alert.title,
    alert.body,
    JSON.stringify(alert.facts),
    alert.dueAt,
    createdAt,
    createdAt,
  );
}

// Not sent yet, and due to be tried by now: the oldest first.
export function outboxToSend(db: Db, now: string): OutboxRow[] {
  return (statement(db, `SELECT ${COLUMNS} FROM outbox WHERE sent_at IS NULL AND not_sent IS NULL AND next_try_at <= ? ORDER BY due_at, created_at, key`).all(now) as Row[]).map(rowOf);
}

// Everything still to send, whenever it is to be tried: the oldest first (10.9, A40).
export function outboxUnsent(db: Db): OutboxRow[] {
  return (statement(db, `SELECT ${COLUMNS} FROM outbox WHERE sent_at IS NULL AND not_sent IS NULL ORDER BY due_at, created_at, key`).all() as Row[]).map(rowOf);
}

// The next moment something not sent yet is due to be tried; null when everything is sent.
export function nextOutboxTry(db: Db): string | null {
  const row = statement(db, 'SELECT MIN(next_try_at) AS at FROM outbox WHERE sent_at IS NULL AND not_sent IS NULL').get() as { at: string | null };
  return row.at;
}

// 10.9 (A40): these will never be sent, and why.
export function markNotSent(db: Db, keys: readonly string[], why: NotSentWhy, at: string): void {
  const mark = statement(db, 'UPDATE outbox SET not_sent = ?, not_sent_at = ? WHERE key = ? AND sent_at IS NULL AND not_sent IS NULL');
  for (const key of keys) mark.run(why, at, key);
}

// Noted before each try, so a try the server stopped in the middle of is known.
export function markTrying(db: Db, key: string, at: string): void {
  statement(db, 'UPDATE outbox SET tries = tries + 1, last_try_at = ? WHERE key = ? AND sent_at IS NULL').run(at, key);
}

export function markSent(db: Db, key: string, at: string): void {
  statement(db, 'UPDATE outbox SET sent_at = ?, last_error = NULL WHERE key = ? AND sent_at IS NULL AND not_sent IS NULL').run(at, key);
}

export function markFailed(db: Db, key: string, at: string, error: string): void {
  const row = statement(db, 'SELECT tries FROM outbox WHERE key = ?').get(key) as { tries: number } | undefined;
  if (row === undefined) return;
  const next = new Date(Date.parse(at) + retryAfterMs(row.tries)).toISOString();
  statement(db, 'UPDATE outbox SET last_error = ?, next_try_at = ? WHERE key = ? AND sent_at IS NULL').run(error, next, key);
}

// The newest first, at most limit of them, and how many there are in all.
export function readOutbox(db: Db, limit: number): { readonly rows: readonly OutboxRow[]; readonly total: number } {
  const rows = (statement(db, `SELECT ${COLUMNS} FROM outbox ORDER BY due_at DESC, created_at DESC, key DESC LIMIT ?`).all(limit) as Row[]).map(rowOf);
  const { n } = statement(db, 'SELECT COUNT(*) AS n FROM outbox').get() as { n: number };
  return { rows, total: n };
}

// How many there are, how many were sent, and how many are not sent yet
// (Settings' row). The rest will never be sent (10.9, A40).
export function outboxCounts(db: Db): { readonly total: number; readonly sent: number; readonly notSent: number } {
  const row = statement(db, 'SELECT COUNT(*) AS total, COUNT(sent_at) AS sent, COUNT(*) - COUNT(sent_at) - COUNT(not_sent) AS notSent FROM outbox').get() as { total: number; sent: number; notSent: number };
  return { total: row.total, sent: row.sent, notSent: row.notSent };
}

export function outboxKeys(db: Db): string[] {
  return (statement(db, 'SELECT key FROM outbox ORDER BY key').all() as { key: string }[]).map((r) => r.key);
}
