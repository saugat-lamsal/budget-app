import { describe, expect, it } from 'vitest';
import { openDatabase, statement } from '../src/db/database.js';

// The queries the server makes over and over (the alert timer looks every
// minute) are prepared once per database and used again: a statement
// prepared afresh each time holds native memory until it is collected, and a
// simulated half year of minutes grew the process to 2 GB.

describe('a query made over and over is prepared once', () => {
  it('the same text on the same database is the same prepared statement, and another database gets its own', () => {
    const one = openDatabase(':memory:');
    const two = openDatabase(':memory:');
    try {
      const sql = 'SELECT COUNT(*) AS n FROM outbox';
      expect(statement(one, sql)).toBe(statement(one, sql));
      expect(statement(two, sql)).not.toBe(statement(one, sql));
      expect(statement(one, 'SELECT 1 AS n')).not.toBe(statement(one, sql));
    } finally {
      one.close();
      two.close();
    }
  });

  it('it reads what is there now, every time', () => {
    const db = openDatabase(':memory:');
    try {
      db.exec('CREATE TABLE made_up (n INTEGER)');
      const count = (): number => (statement(db, 'SELECT COUNT(*) AS n FROM made_up').get() as { n: number }).n;
      expect(count()).toBe(0);
      db.prepare('INSERT INTO made_up (n) VALUES (1)').run();
      expect(count()).toBe(1);
    } finally {
      db.close();
    }
  });
});
