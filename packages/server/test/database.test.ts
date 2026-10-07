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
    expect(tables).toEqual(['accounts', 'attention', 'bank_items', 'book_events', 'change_log', 'connection', 'settings', 'statements', 'syncs']);
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
});
