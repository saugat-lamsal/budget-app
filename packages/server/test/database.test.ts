import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDatabase } from '../src/db/database.js';

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'budget-db-'));
  dirs.push(dir);
  return join(dir, 'test.sqlite');
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the database', () => {
  it('a new database gets every table, at the current version', () => {
    const db = openDatabase(':memory:');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map(
      (t) => t.name,
    );
    expect(tables).toEqual(['accounts', 'attention', 'bank_items', 'bank_reads', 'book_events', 'change_log', 'connection', 'decisions', 'last_checked', 'login_codes', 'passkeys', 'sessions', 'settings', 'statements', 'syncs']);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('a file database keeps its data, writes each commit to disk, and is not set up twice', () => {
    const path = tempFile();
    const first = openDatabase(path);
    expect(first.pragma('journal_mode', { simple: true })).toBe('wal');
    // 2 is FULL: a commit is on the disk before it counts as done.
    expect(first.pragma('synchronous', { simple: true })).toBe(2);
    first.prepare("INSERT INTO settings (name, value) VALUES ('x', '1')").run();
    first.close();
    const again = openDatabase(path);
    expect(again.prepare("SELECT value FROM settings WHERE name = 'x'").get()).toEqual({ value: '1' });
    again.close();
  });

  it('a database from a newer version of the app is not opened', () => {
    const path = tempFile();
    const db = openDatabase(path);
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => openDatabase(path)).toThrow(/newer version/);
  });

  it('there is only ever one bank connection', () => {
    const db = openDatabase(':memory:');
    const add = db.prepare("INSERT INTO connection (id, item_id, sealed_key, connected_on) VALUES (?, 'item', 'v1.x', '2026-10-06')");
    add.run(1);
    expect(() => add.run(1)).toThrow();
    expect(() => add.run(2)).toThrow();
    db.close();
  });

  it('each of his four accounts is only one Plaid account', () => {
    const db = openDatabase(':memory:');
    const add = db.prepare("INSERT INTO accounts (plaid_account_id, role, raw, updated_by_sync) VALUES (?, ?, '{}', 1)");
    add.run('a', 'checking');
    expect(() => add.run('b', 'checking')).toThrow();
    expect(() => add.run('c', 'brokerage')).toThrow();
    add.run('d', null);
    add.run('e', null);
    db.close();
  });

  it('step 2 keeps the book history as it was, in its order, each event with the day it was made on; totals are filled in later', () => {
    const path = tempFile();
    const old = openDatabase(path, { upTo: 1 });
    expect(old.pragma('user_version', { simple: true })).toBe(1);
    old.prepare("INSERT INTO syncs (id, today, added, modified, removed, sent, held) VALUES (1, '2026-10-01', 0, 0, 0, 0, 0), (2, '2026-10-03', 0, 0, 0, 0, 0)").run();
    const add = old.prepare('INSERT INTO book_events (sync, kind, payload) VALUES (?, ?, ?)');
    add.run(1, 'setup', JSON.stringify({ date: '2026-09-30', made: 'up' }));
    add.run(2, 'receive', JSON.stringify({ kind: 'purchase', id: 'p1', date: '2026-10-02' }));
    add.run(2, 'receive', JSON.stringify({ kind: 'purchase', id: 'p2', date: '2026-10-03' }));
    old.close();
    const db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT seq, sync, kind, date, payload, totals FROM book_events ORDER BY seq').all()).toEqual([
      { seq: 1, sync: 1, kind: 'setup', date: '2026-09-30', payload: JSON.stringify({ date: '2026-09-30', made: 'up' }), totals: null },
      { seq: 2, sync: 2, kind: 'receive', date: '2026-10-03', payload: JSON.stringify({ kind: 'purchase', id: 'p1', date: '2026-10-02' }), totals: null },
      { seq: 3, sync: 2, kind: 'receive', date: '2026-10-03', payload: JSON.stringify({ kind: 'purchase', id: 'p2', date: '2026-10-03' }), totals: null },
    ]);
    // Numbers go on after the last one, never reused.
    db.prepare("INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (NULL, 'answer', '2026-10-04', '{}', 'null')").run();
    expect(db.prepare('SELECT MAX(seq) AS seq FROM book_events').get()).toEqual({ seq: 4 });
    db.close();
  });

  it('step 3 (passkey login) keeps everything as it was and adds the login tables, empty: nobody is logged in and there is no passkey', () => {
    const path = tempFile();
    const old = openDatabase(path, { upTo: 2 });
    expect(old.pragma('user_version', { simple: true })).toBe(2);
    old.prepare("INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (NULL, 'answer', '2026-10-04', '{}', 'null')").run();
    old.prepare("INSERT INTO change_log (date, what, detail) VALUES ('2026-10-04', 'setup day', '{}')").run();
    old.close();
    const db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT seq, kind, date FROM book_events').all()).toEqual([{ seq: 1, kind: 'answer', date: '2026-10-04' }]);
    expect(db.prepare('SELECT what FROM change_log').all()).toEqual([{ what: 'setup day' }]);
    for (const table of ['passkeys', 'sessions', 'login_codes']) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: 0 });
    db.close();
  });

  it('step 4 (syncing on a timer) keeps everything as it was and adds the list of bank reads, empty: the bank has not been read yet', () => {
    const path = tempFile();
    const old = openDatabase(path, { upTo: 3 });
    expect(old.pragma('user_version', { simple: true })).toBe(3);
    old.prepare("INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (NULL, 'answer', '2026-10-04', '{}', 'null')").run();
    old.prepare("INSERT INTO sessions (token_hash, device, passkey_id, created_at) VALUES ('made-up-hash', 'A test browser', 'made-up-passkey', '2026-10-04T16:00:00.000Z')").run();
    old.close();
    const db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT seq, kind, date FROM book_events').all()).toEqual([{ seq: 1, kind: 'answer', date: '2026-10-04' }]);
    expect(db.prepare('SELECT device FROM sessions').all()).toEqual([{ device: 'A test browser' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bank_reads').get()).toEqual({ n: 0 });
    const read = db.prepare('INSERT INTO bank_reads (at, changed) VALUES (?, ?)');
    read.run('2026-10-04T16:00:00.000Z', 1);
    expect(() => read.run('2026-10-04T17:00:00.000Z', 2)).toThrow();
    expect(() => read.run(null, 0)).toThrow();
    db.close();
  });

  it('the history takes only what the bank sent, setup day, and his answers, each with its day; a decision number is used once and names its event', () => {
    const db = openDatabase(':memory:');
    const add = db.prepare('INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (NULL, ?, ?, ?, ?)');
    expect(() => add.run('guess', '2026-10-04', '{}', 'null')).toThrow();
    expect(() => add.run('answer', null, '{}', 'null')).toThrow();
    const seq = Number(add.run('answer', '2026-10-04', '{}', 'null').lastInsertRowid);
    const decide = db.prepare("INSERT INTO decisions (id, desk, fingerprint, answer, seq) VALUES (?, 'choice', '{}', '{}', ?)");
    decide.run('decision-1', seq);
    expect(() => decide.run('decision-1', seq)).toThrow();
    expect(() => decide.run('decision-2', seq + 1)).toThrow();
    expect(() => db.prepare("INSERT INTO decisions (id, desk, fingerprint, answer, seq) VALUES ('decision-3', 'guess', '{}', '{}', ?)").run(seq)).toThrow();
    const checked = db.prepare('INSERT INTO last_checked (id, amount, at) VALUES (?, 100, ?)');
    checked.run(1, '2026-10-04T20:00:00-04:00');
    expect(() => checked.run(2, '2026-10-04T20:00:00-04:00')).toThrow();
    db.close();
  });
});
