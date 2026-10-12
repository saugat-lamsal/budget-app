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
    expect(tables).toEqual(['accounts', 'attention', 'bank_items', 'bank_reads', 'book_events', 'change_log', 'connection', 'decisions', 'last_checked', 'login_codes', 'outbox', 'passkeys', 'push_stopped', 'push_subscriptions', 'sessions', 'settings', 'statements', 'syncs']);
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

  it('step 5 (Phase 5, alerts) keeps the history and the decision numbers that name its events, lets it keep alerts, and adds the outbox, empty', () => {
    const path = tempFile();
    const old = openDatabase(path, { upTo: 4 });
    expect(old.pragma('user_version', { simple: true })).toBe(4);
    const seq = Number(old.prepare("INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (NULL, 'answer', '2026-10-04', '{\"seen\":\"x\"}', 'null')").run().lastInsertRowid);
    old.prepare("INSERT INTO decisions (id, desk, fingerprint, answer, seq) VALUES ('decision-1', 'choice', '{}', '{}', ?)").run(seq);
    expect(() => old.prepare("INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (NULL, 'alerts', '2026-10-04', '{}', 'null')").run()).toThrow();
    old.close();
    const db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT seq, kind, date, payload FROM book_events').all()).toEqual([{ seq, kind: 'answer', date: '2026-10-04', payload: '{\"seen\":\"x\"}' }]);
    expect(db.prepare('SELECT id, seq FROM decisions').all()).toEqual([{ id: 'decision-1', seq }]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const alerts = Number(db.prepare("INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (NULL, 'alerts', '2026-10-04', '{}', 'null')").run().lastInsertRowid);
    expect(alerts).toBe(seq + 1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM outbox').get()).toEqual({ n: 0 });
    const add = db.prepare("INSERT INTO outbox (key, seq, kind, title, body, due_at, created_at, tries, next_try_at) VALUES (?, ?, 'daily-review', 'Time to review', '1 thing', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z', 0, '2026-10-05T00:00:00.000Z')");
    add.run('daily-review 2026-10-04', alerts);
    // Each alert once; each from an event of the history.
    expect(() => add.run('daily-review 2026-10-04', alerts)).toThrow();
    expect(() => add.run('daily-review 2026-10-05', 999)).toThrow();
    db.close();
  });

  it('step 6 (10.10, the lock screen) keeps the outbox as it was, and each alert from then on keeps its facts, so its words can leave the amounts out when it is sent', () => {
    const path = tempFile();
    const old = openDatabase(path, { upTo: 5 });
    expect(old.pragma('user_version', { simple: true })).toBe(5);
    const seq = Number(old.prepare("INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (NULL, 'alerts', '2026-10-04', '{}', 'null')").run().lastInsertRowid);
    old.prepare("INSERT INTO outbox (key, seq, kind, title, body, due_at, created_at, tries, next_try_at) VALUES ('daily-review 2026-10-04', ?, 'daily-review', 'Time to review', '1 thing', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z', 0, '2026-10-05T00:00:00.000Z')").run(seq);
    old.close();
    const db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT key, title, facts FROM outbox').all()).toEqual([{ key: 'daily-review 2026-10-04', title: 'Time to review', facts: null }]);
    db.prepare("INSERT INTO outbox (key, seq, kind, title, body, facts, due_at, created_at, tries, next_try_at) VALUES ('daily-review 2026-10-05', ?, 'daily-review', 'Time to review', '2 things', '{\"kind\":\"daily-review\"}', '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z', 0, '2026-10-06T00:00:00.000Z')").run(seq);
    expect(db.prepare("SELECT facts FROM outbox WHERE key = 'daily-review 2026-10-05'").get()).toEqual({ facts: '{"kind":"daily-review"}' });
    db.close();
  });

  it('step 7 (Phase 5, the phone) keeps everything as it was and adds the push subscriptions, empty, each tied to a device logged in', () => {
    const path = tempFile();
    const old = openDatabase(path, { upTo: 6 });
    old.prepare("INSERT INTO sessions (token_hash, device, passkey_id, created_at) VALUES ('h1', 'Safari on iPhone', 'pk', '2026-10-01T16:00:00.000Z')").run();
    old.close();
    const db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT device FROM sessions').all()).toEqual([{ device: 'Safari on iPhone' }]);
    expect(db.prepare('SELECT * FROM push_subscriptions').all()).toEqual([]);
    const add = db.prepare("INSERT INTO push_subscriptions (session_hash, endpoint, p256dh, auth, device, created_at) VALUES (?, ?, 'k', 'a', 'Safari on iPhone', '2026-10-12T16:00:00.000Z')");
    add.run('h1', 'https://127.0.0.1:1/push/a');
    // One per device, one device per address, and only for a device logged in.
    expect(() => add.run('h1', 'https://127.0.0.1:1/push/b')).toThrow();
    expect(() => add.run('no-such-login', 'https://127.0.0.1:1/push/c')).toThrow();
    db.prepare("INSERT INTO push_stopped (session_hash, at, device, why) VALUES ('h1', '2026-10-13T00:00:00.000Z', 'Safari on iPhone', 'gone')").run();
    // Logged out there: both go with the login.
    db.prepare("DELETE FROM sessions WHERE token_hash = 'h1'").run();
    expect([db.prepare('SELECT count(*) AS n FROM push_subscriptions').get(), db.prepare('SELECT count(*) AS n FROM push_stopped').get()]).toEqual([{ n: 0 }, { n: 0 }]);
    db.close();
  });

  it('step 8 (10.9, A40) keeps the outbox as it was, and notes for each alert never sent why: a newer one went, or it was no longer true', () => {
    const path = tempFile();
    const old = openDatabase(path, { upTo: 7 });
    const seq = Number(old.prepare("INSERT INTO book_events (sync, kind, date, payload, totals) VALUES (NULL, 'alerts', '2026-10-04', '{}', 'null')").run().lastInsertRowid);
    old.prepare("INSERT INTO outbox (key, seq, kind, title, body, due_at, created_at, tries, next_try_at) VALUES ('daily-review 2026-10-04', ?, 'daily-review', 'Time to review', '1 thing', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z', 3, '2026-10-05T00:04:00.000Z')").run(seq);
    old.close();
    const db = openDatabase(path);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT key, tries, not_sent, not_sent_at FROM outbox').all()).toEqual([{ key: 'daily-review 2026-10-04', tries: 3, not_sent: null, not_sent_at: null }]);
    const why = db.prepare("UPDATE outbox SET not_sent = ?, not_sent_at = '2026-10-06T13:00:00.000Z' WHERE key = 'daily-review 2026-10-04'");
    expect(() => why.run('guess')).toThrow();
    why.run('newer');
    why.run('not-true');
    expect(db.prepare('SELECT not_sent FROM outbox').all()).toEqual([{ not_sent: 'not-true' }]);
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
