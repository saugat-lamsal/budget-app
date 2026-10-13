import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { backupFromEnv, heartbeatUrl, litestreamEnv } from '../src/backup/backup.js';
import { BACKUP_BEAT_PATH, BACKUP_HEALTH_PATH, BACKUP_SILENCE_MS, BackupWatch, fromThisMachine } from '../src/backup/backup-watch.js';

// QUESTIONS.md A43, option 5: how he hears that the backups have stopped.
// Litestream calls an address about once a minute, but only while every copy
// of the books has gone through (its heartbeat). The address is the app's own
// server, on the same machine: the call never leaves it. /health/backups says
// "not ok" once none has come for 10 minutes, and a second uptime monitor
// watches it. /health stays as it was: Fly uses it.

const MINUTE = 60_000;

function clock(start = Date.UTC(2026, 9, 12, 21, 0)): { now: () => number; at: (ms: number) => void } {
  let t = start;
  return { now: () => t, at: (ms) => (t = start + ms) };
}

describe('A43 the backups watch', () => {
  it('A43 the backups are ok while the heartbeat comes, and not ok exactly 10 minutes after the last one', () => {
    expect(BACKUP_SILENCE_MS).toBe(10 * MINUTE);
    const c = clock();
    const watch = new BackupWatch(c.now);
    c.at(1 * MINUTE);
    watch.beat();
    expect(watch.lastBeat).toBe(c.now());
    c.at(11 * MINUTE - 1);
    expect(watch.healthy()).toBe(true);
    c.at(11 * MINUTE);
    expect(watch.healthy()).toBe(false);
    c.at(40 * MINUTE);
    expect(watch.healthy()).toBe(false);
    // One beat and it is ok again.
    watch.beat();
    expect(watch.healthy()).toBe(true);
    c.at(50 * MINUTE - 1);
    expect(watch.healthy()).toBe(true);
    c.at(50 * MINUTE);
    expect(watch.healthy()).toBe(false);
  });

  it('A43 at the start Litestream gets 10 minutes before the backups count as stopped: it starts first, and beats only after its first copies', () => {
    const c = clock();
    const watch = new BackupWatch(c.now);
    expect(watch.lastBeat).toBeNull();
    expect(watch.healthy()).toBe(true);
    c.at(10 * MINUTE - 1);
    expect(watch.healthy()).toBe(true);
    c.at(10 * MINUTE);
    expect(watch.healthy()).toBe(false);
  });

  it('A43 a clock that goes back never makes it ok for longer than 10 minutes from the last beat it saw', () => {
    const c = clock();
    const watch = new BackupWatch(c.now);
    c.at(5 * MINUTE);
    watch.beat();
    c.at(2 * MINUTE);
    expect(watch.healthy()).toBe(true);
    c.at(15 * MINUTE);
    expect(watch.healthy()).toBe(false);
  });

  it('A43 a beat is taken only from this machine, and never through Fly\'s proxy', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(fromThisMachine(address, {}), address).toBe(true);
    for (const address of ['172.19.3.2', 'fdaa:0:1:a7b::3', '::ffff:172.19.3.2', '10.0.0.1', '127.0.0.2.example', '', undefined]) expect(fromThisMachine(address, {}), String(address)).toBe(false);
    // Fly's proxy says where a request came from; one that passed through it never counts.
    for (const header of ['x-forwarded-for', 'x-forwarded-proto', 'fly-client-ip', 'fly-forwarded-port', 'via']) {
      expect(fromThisMachine('127.0.0.1', { [header]: '203.0.113.9' }), header).toBe(false);
    }
  });

  it('A43 the addresses', () => {
    expect(BACKUP_HEALTH_PATH).toBe('/health/backups');
    expect(BACKUP_BEAT_PATH).toBe('/health/backups/beat');
  });
});

describe('A43 Litestream\'s heartbeat goes to this machine only', () => {
  it('A43 to the server\'s own port on 127.0.0.1, 8080 when none is set (fly.toml)', () => {
    expect(heartbeatUrl({ PORT: '8080' })).toBe('http://127.0.0.1:8080/health/backups/beat');
    expect(heartbeatUrl({})).toBe('http://127.0.0.1:8080/health/backups/beat');
    expect(heartbeatUrl({ PORT: ' 5190 ' })).toBe('http://127.0.0.1:5190/health/backups/beat');
    expect(heartbeatUrl({ PORT: '1' })).toBe('http://127.0.0.1:1/health/backups/beat');
    expect(heartbeatUrl({ PORT: '65535' })).toBe('http://127.0.0.1:65535/health/backups/beat');
    for (const port of ['0', '65536', 'abc', '80.5', '-1', '8080/elsewhere', '8080@evil.example']) expect(() => heartbeatUrl({ PORT: port }), port).toThrow(/PORT/);
  });

  it('A43 Litestream is given that address and nothing else new: still not the server\'s keys', () => {
    const backup = backupFromEnv({ R2_ENDPOINT: 'http://127.0.0.1:9000', R2_BUCKET: 'made-up-bucket', R2_ACCESS_KEY_ID: 'MADEUPKEY', R2_SECRET_ACCESS_KEY: 'made-up-secret' }, 'this-computer');
    if (backup === null) throw new Error('no backup');
    const env = litestreamEnv('/data/budget.sqlite', backup, { PORT: '8080', PATH: '/usr/bin', BANK_TOKEN_KEY: 'made-up', PLAID_SECRET: 'made-up', VAPID_PRIVATE_KEY: 'made-up' });
    expect(Object.keys(env).sort()).toEqual(['BACKUP_HEARTBEAT_URL', 'BUDGET_DB', 'PATH', 'R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_ENDPOINT', 'R2_SECRET_ACCESS_KEY']);
    expect(env['BACKUP_HEARTBEAT_URL']).toBe('http://127.0.0.1:8080/health/backups/beat');
  });

  it('A43 litestream.yml beats every minute, well inside the 10 minutes, to that address and no other', () => {
    const yml = readFileSync(fileURLToPath(new URL('../../../litestream.yml', import.meta.url)), 'utf8');
    const lines = yml.split(/\r?\n/).filter((line) => /heartbeat/.test(line) && !line.trimStart().startsWith('#'));
    expect(lines).toEqual(['heartbeat-url: ${BACKUP_HEARTBEAT_URL}', 'heartbeat-interval: 1m']);
    // A beat or two can be missed without a false alarm.
    expect(BACKUP_SILENCE_MS).toBeGreaterThanOrEqual(5 * MINUTE);
  });
});
