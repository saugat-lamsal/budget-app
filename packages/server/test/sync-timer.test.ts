import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { readConnection } from '../src/db/store.js';
import { readHistory } from '../src/history/history-db.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { serverLinesIn } from '../src/server-log.js';
import { LONGEST_SLEEP_MS, SyncTimer } from '../src/serve/sync-timer.js';
import { SYNC_EVERY_MINUTES } from '../src/sync/bank-reads.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { dump } from './harness.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// npm run serve syncs with the bank by itself (Step 3, rulebook section 2):
// every 60 minutes to start, a setting; at once when it starts, if one is
// due. Tested with a fake clock that moves only when the test moves it: on
// time, after a restart, across both clock changes in New York, never two at
// once, a failed one saving nothing, the bank wanting a new login (10.5), and
// only the calls a sync makes (never /transactions/refresh). Every name and
// number is made up.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const E = ACCOUNT_IDS.everyday;

interface Running {
  readonly life: Life;
  readonly clock: FakeClock;
  readonly timer: SyncTimer;
  readonly lines: LogLine[];
  // Moves the clock on, running the timer's syncs as they come due.
  advance(ms: number): Promise<void>;
}

const lives: Life[] = [];
const timers: SyncTimer[] = [];
afterEach(async () => {
  for (const timer of timers.splice(0)) await timer.stop();
  for (const life of lives.splice(0)) life.done();
});

async function setUp(start = noonInNewYork('2026-10-01')): Promise<Life> {
  const life = await lifeInAFile();
  lives.push(life);
  setUpThroughTheDesk(life);
  life.now = start;
  return life;
}

// The timer npm run serve starts, on the life's books (the running ones, after a restart too).
function timerOn(life: Life, clock = new FakeClock(life)): Running {
  const lines: LogLine[] = [];
  const log = memoryLog(lines);
  const timer = new SyncTimer({ syncer: { syncDueIn: () => life.keeper.syncDueIn(), sync: () => life.keeper.sync({ plaid: life.h.plaid, box: life.h.box, log, pageSize: 3 }) }, clock, log });
  timers.push(timer);
  return { life, clock, timer, lines, advance: (ms) => clock.advance(ms, () => timer.idle()) };
}

// Every read of the bank, as instants.
function reads(life: Life): string[] {
  return (life.h.db.prepare('SELECT at FROM bank_reads ORDER BY id').all() as { at: string }[]).map((r) => r.at);
}

function checkedAt(life: Life): string | null {
  const home = life.keeper.home();
  if (home.state !== 'tracking') throw new Error('not tracking');
  return home.checkedAt?.at ?? null;
}

const at = (iso: string): string => new Date(iso).toISOString();

describe('syncing on a timer (Step 3)', () => {
  it('section 2 the first sync at once (none done yet), then every 60 minutes: not a second before', async () => {
    const life = await setUp();
    const r = timerOn(life);
    expect(SYNC_EVERY_MINUTES).toBe(60);
    r.timer.start();
    await r.timer.idle();
    expect(reads(life)).toEqual([at('2026-10-01T16:00:00Z')]);
    expect(checkedAt(life)).toBe('2026-10-01T12:00:00-04:00');
    await r.advance(HOUR - 1_000);
    expect(reads(life)).toHaveLength(1);
    await r.advance(1_000);
    expect(reads(life)).toEqual([at('2026-10-01T16:00:00Z'), at('2026-10-01T17:00:00Z')]);
    await r.advance(5 * HOUR);
    expect(reads(life)).toHaveLength(7);
    expect(checkedAt(life)).toBe('2026-10-01T18:00:00-04:00');
  });

  it('section 2 what the bank sends meanwhile reaches the books by itself, on the hour', async () => {
    const life = await setUp();
    const r = timerOn(life);
    r.timer.start();
    await r.timer.idle();
    life.h.fake.addPosted({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-01', description: 'MADE UP CAFE' });
    await r.advance(30 * MINUTE);
    expect(life.keeper.book()?.reviewItems().map((i) => i.id)).toEqual([]);
    await r.advance(30 * MINUTE);
    expect(life.keeper.book()?.reviewItems().map((i) => i.id)).toEqual(['cafe-1']);
    expect(r.lines.some((l) => l.event === 'timer sync')).toBe(true);
  });

  it('section 2 after a restart: a sync that is due runs at once; one that is not due waits for its time', async () => {
    const life = await setUp();
    let r = timerOn(life);
    r.timer.start();
    await r.timer.idle();
    await r.timer.stop();
    // Restarted 30 minutes later: the next is 60 minutes after the last read.
    life.now = new Date(life.now.getTime() + 30 * MINUTE);
    life.restart();
    r = timerOn(life);
    r.timer.start();
    await r.timer.idle();
    expect(reads(life)).toHaveLength(1);
    await r.advance(30 * MINUTE - 1_000);
    expect(reads(life)).toHaveLength(1);
    await r.advance(1_000);
    expect(reads(life)).toEqual([at('2026-10-01T16:00:00Z'), at('2026-10-01T17:00:00Z')]);
    await r.timer.stop();
    // Stopped for 3 hours: at once when it starts.
    life.now = new Date(life.now.getTime() + 3 * HOUR);
    life.restart();
    r = timerOn(life);
    r.timer.start();
    await r.timer.idle();
    expect(reads(life)).toEqual([at('2026-10-01T16:00:00Z'), at('2026-10-01T17:00:00Z'), at('2026-10-01T20:00:00Z')]);
  });

  it('section 2 the fall clock change (New York, Nov 1, 2026): an hour of real time apart, and Checked at says 1:30 twice, first EDT then EST', async () => {
    const life = await setUp(new Date('2026-11-01T05:30:00Z'));
    const r = timerOn(life);
    r.timer.start();
    await r.timer.idle();
    expect(checkedAt(life)).toBe('2026-11-01T01:30:00-04:00');
    await r.advance(HOUR);
    expect(reads(life)).toEqual([at('2026-11-01T05:30:00Z'), at('2026-11-01T06:30:00Z')]);
    expect(checkedAt(life)).toBe('2026-11-01T01:30:00-05:00');
    await r.advance(HOUR);
    expect(checkedAt(life)).toBe('2026-11-01T02:30:00-05:00');
  });

  it('section 2 the spring clock change (New York, Mar 14, 2027): an hour of real time apart, and Checked at goes from 1:30 EST to 3:30 EDT', async () => {
    const life = await setUp(new Date('2027-03-14T06:30:00Z'));
    const r = timerOn(life);
    r.timer.start();
    await r.timer.idle();
    expect(checkedAt(life)).toBe('2027-03-14T01:30:00-05:00');
    await r.advance(HOUR);
    expect(reads(life)).toEqual([at('2027-03-14T06:30:00Z'), at('2027-03-14T07:30:00Z')]);
    expect(checkedAt(life)).toBe('2027-03-14T03:30:00-04:00');
  });

  it('section 2 never two syncs at once: the timer and --sync at the same moment are one sync, and the bank is read once', async () => {
    const life = await setUp();
    const r = timerOn(life);
    const before = life.h.fake.calls.length;
    r.timer.start();
    const bySync = life.keeper.sync({ plaid: life.h.plaid, box: life.h.box, log: memoryLog([]) });
    const again = life.keeper.sync({ plaid: life.h.plaid, box: life.h.box, log: memoryLog([]) });
    expect(again).toBe(bySync);
    await bySync;
    await r.timer.idle();
    expect(reads(life)).toHaveLength(1);
    expect(life.h.fake.calls.slice(before).filter((c) => c.endpoint === '/accounts/get')).toHaveLength(1);
    // Once it is done, the next is a new one.
    const later = life.keeper.sync({ plaid: life.h.plaid, box: life.h.box, log: memoryLog([]) });
    expect(later).not.toBe(bySync);
    await later;
    expect(reads(life)).toHaveLength(2);
  });

  it('section 2 a sync that fails saves nothing at all, and the next one is at the next time', async () => {
    const life = await setUp();
    const r = timerOn(life);
    r.timer.start();
    await r.timer.idle();
    life.h.fake.addPosted({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-01', description: 'MADE UP CAFE' });
    const before = dump(life.h.db);
    // The bank cannot be reached at 1 PM.
    life.h.fake.beforeCall = () => 'network';
    await r.advance(HOUR);
    expect(dump(life.h.db)).toEqual(before);
    expect(r.lines.some((l) => l.event.startsWith('timer sync failed'))).toBe(true);
    expect(checkedAt(life)).toBe('2026-10-01T12:00:00-04:00');
    // Back at 1:30; not tried again until 2 PM.
    life.h.fake.beforeCall = undefined;
    const calls = life.h.fake.calls.length;
    await r.advance(HOUR - 1_000);
    expect(life.h.fake.calls.length).toBe(calls);
    await r.advance(1_000);
    expect(reads(life)).toEqual([at('2026-10-01T16:00:00Z'), at('2026-10-01T18:00:00Z')]);
    expect(life.keeper.book()?.reviewItems().map((i) => i.id)).toEqual(['cafe-1']);
  });

  it('10.5 through the timer: the bank wants a new login; Home says so and shows the last checked safe to spend; nothing else is saved; it tries again at the next time', async () => {
    const life = await setUp();
    const r = timerOn(life);
    r.timer.start();
    await r.timer.idle();
    const home = life.keeper.home();
    if (home.state !== 'tracking' || !home.safeToSpend.shown) throw new Error('safe to spend not shown');
    const events = readHistory(life.h.db).length;
    life.h.fake.needsLogin = true;
    await r.advance(HOUR);
    expect(readConnection(life.h.db)?.needsLogin).toBe(true);
    expect(readHistory(life.h.db)).toHaveLength(events);
    expect(reads(life)).toHaveLength(1);
    const after = life.keeper.home();
    if (after.state !== 'tracking') throw new Error('not tracking');
    expect(after.attention[0]).toEqual({ kind: 'bank-login' });
    expect(after.safeToSpend).toEqual({ shown: false, why: 'bank-not-read', lastChecked: { amount: home.safeToSpend.amount, at: '2026-10-01T12:00:00-04:00' } });
    expect(after.checkedAt).toEqual({ at: '2026-10-01T12:00:00-04:00', timeZone: 'America/New_York' });
    const calls = life.h.fake.calls.length;
    await r.advance(HOUR - 1_000);
    expect(life.h.fake.calls.length).toBe(calls);
    await r.advance(1_000);
    expect(life.h.fake.calls.length).toBeGreaterThan(calls);
  });

  it('section 2 10.13 the timer only reads the bank: /transactions/sync, /accounts/get, /liabilities/get and /item/get, never /transactions/refresh', async () => {
    const life = await setUp();
    const r = timerOn(life);
    const before = life.h.fake.calls.length;
    r.timer.start();
    await r.timer.idle();
    for (let hour = 0; hour < 24; hour += 1) {
      if (hour % 5 === 0) life.h.fake.addPosted({ id: `store-${hour}`, account: E, amount: 1_000 + hour, date: '2026-10-01', description: `MADE UP STORE ${hour}` });
      await r.advance(HOUR);
    }
    expect(reads(life)).toHaveLength(25);
    expect([...new Set(life.h.fake.calls.slice(before).map((c) => c.endpoint))].sort()).toEqual(['/accounts/get', '/item/get', '/liabilities/get', '/transactions/sync']);
    // Nothing in the server asks Plaid to look at the bank again: only the client knows the call.
    const src = new URL('../src/', import.meta.url);
    for (const name of readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((n) => n.endsWith('.ts') && n.replaceAll('\\', '/') !== 'plaid/client.ts')) {
      expect(readFileSync(new URL(name, src), 'utf8'), name).not.toMatch(/\.refreshTransactions\(|ENDPOINTS\.transactionsRefresh|'\/transactions\/refresh'/);
    }
  });

  it('section 2 how often is a setting: changed to 15 minutes, it applies right away and is logged; 14, 1,441 and 1.5 are refused', async () => {
    const life = await setUp();
    const r = timerOn(life);
    r.timer.start();
    await r.timer.idle();
    for (const minutes of [14, 1_441, 1.5, '30', null]) expect(life.keeper.changeSyncEvery(minutes).ok, String(minutes)).toBe(false);
    expect(life.keeper.changeSyncEvery(60)).toEqual({ ok: false, why: 'That is already the setting. Nothing was changed.' });
    await r.advance(20 * MINUTE);
    expect(reads(life)).toHaveLength(1);
    expect(life.keeper.changeSyncEvery(15)).toEqual({ ok: true });
    expect(serverLinesIn(life.h.db).at(-1)).toMatchObject({ action: 'sync-every-changed', before: 60, after: 15, date: '2026-10-01' });
    // 20 minutes since the last: due already; noticed within a minute.
    await r.advance(LONGEST_SLEEP_MS);
    expect(reads(life)).toHaveLength(2);
    await r.advance(15 * MINUTE);
    expect(reads(life)).toHaveLength(3);
    // It stays after a restart.
    life.restart();
    expect(life.keeper.syncEveryMinutes()).toBe(15);
    expect(life.keeper.changeSyncEvery(1_440)).toEqual({ ok: true });
  });

  it('section 2 stopped, it starts no sync; a sync on its way is let finish first', async () => {
    const life = await setUp();
    const r = timerOn(life);
    r.timer.start();
    const stopping = r.timer.stop();
    await stopping;
    expect(reads(life)).toHaveLength(1);
    await r.advance(10 * HOUR);
    expect(reads(life)).toHaveLength(1);
    expect(r.clock.waiting).toBe(0);
  });

  it('section 2 with no bank connection yet there is nothing to sync: no error, and it looks again within a minute', async () => {
    const life = await setUp();
    life.h.db.prepare('DELETE FROM connection').run();
    const r = timerOn(life);
    expect(life.keeper.syncDueIn()).toBeNull();
    r.timer.start();
    await r.timer.idle();
    await r.advance(3 * HOUR);
    expect(reads(life)).toEqual([]);
    expect(r.lines.filter((l) => l.level !== 'info')).toEqual([]);
    expect(r.clock.waiting).toBe(1);
  });
});

describe('syncing on a timer: it never stops the server', () => {
  it('section 2 something going wrong while it looks is logged, and it looks again a minute later', async () => {
    const lines: LogLine[] = [];
    let calls = 0;
    const clockState = { now: new Date('2026-10-01T16:00:00Z') };
    const clock = new FakeClock(clockState);
    const timer = new SyncTimer({
      syncer: {
        syncDueIn: () => {
          calls += 1;
          if (calls === 1) throw new Error('the database is busy (made up)');
          return 30 * MINUTE;
        },
        sync: () => Promise.reject(new Error('not asked')),
      },
      clock,
      log: memoryLog(lines),
    });
    timers.push(timer);
    expect(() => timer.start()).not.toThrow();
    expect(lines.map((l) => l.event)).toEqual(['timer could not look; it looks again in a minute']);
    expect(clock.waiting).toBe(1);
    await clock.advance(LONGEST_SLEEP_MS, () => timer.idle());
    expect(calls).toBe(2);
    expect(clock.waiting).toBe(1);
  });
});

describe('syncing on a timer: a sync that cannot even start', () => {
  it('section 2 is logged like a failed sync, and the next look is at the next time', async () => {
    const lines: LogLine[] = [];
    let due = 0;
    const clock = new FakeClock({ now: new Date('2026-10-01T16:00:00Z') });
    const timer = new SyncTimer({
      syncer: {
        syncDueIn: () => due,
        sync: () => {
          due = 60 * MINUTE;
          throw new Error('no bank key (made up)');
        },
      },
      clock,
      log: memoryLog(lines),
    });
    timers.push(timer);
    expect(() => timer.start()).not.toThrow();
    await timer.idle();
    expect(lines.map((l) => l.event)).toEqual(['timer sync failed; the next one is at the next time']);
    expect(clock.waiting).toBe(1);
  });
});
