import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BackupWatch } from '../src/backup/backup-watch.js';
import { readOutbox } from '../src/alerts/outbox.js';
import { loginForTests } from './login-for-tests.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { lifeInAFile, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Rule 0.7 (QUESTIONS.md A57): the status page, which only reads: the last
// good read of the bank and how the last sync went, the backups, when the
// server started, the history and that it replayed when the books opened, the
// bank difference, and the alerts waiting. No amounts. Every name and number
// is made up.

const C = ACCOUNT_IDS.checking;

// The server starts: the books open, then it serves them (as serveBooks does).
async function setUp(): Promise<Life> {
  const life = await lifeInAFile();
  life.now = new Date('2026-10-02T13:00:00Z');
  life.restart();
  serve(life);
  return life;
}

function serve(life: Life): ReturnType<Life['keeper']['server']> {
  const webRoot = join(life.dir, 'dist');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
  const server = life.keeper.server(webRoot, () => `http://localhost:${(server.address() as AddressInfo | null)?.port ?? 0}`);
  return server;
}

describe('0.7 the status page', () => {
  it('0.7 before the first sync since the server started: when it started, the last good read kept, and no sync yet', async () => {
    const life = await setUp();
    try {
      expect(life.keeper.statusView()).toEqual({
        state: 'not-set-up',
        today: '2026-10-02',
        timeZone: 'America/New_York',
        lastRead: null,
        lastSync: null,
        backups: null,
        started: '2026-10-02T09:00:00-04:00',
        history: { whenOpened: 0, now: 0 },
        mismatchSince: null,
        alertsWaiting: 0,
      });
    } finally {
      life.done();
    }
  });

  it('0.7 how the last sync went: new activity, nothing new, the bank wants a new login, or it failed; each with when', async () => {
    const life = await setUp();
    try {
      setUpThroughTheDesk(life);
      life.now = new Date('2026-10-02T14:00:00Z');
      life.h.fake.addPosted({ id: 'shop', account: C, amount: 2_399, date: '2026-10-02', description: 'MADE UP SHOP' });
      await life.sync();
      expect(life.keeper.statusView().lastSync).toEqual({ at: '2026-10-02T10:00:00-04:00', result: 'new' });
      expect(life.keeper.statusView().state).toBe('tracking');
      expect(life.keeper.statusView().lastRead).toBe('2026-10-02T10:00:00-04:00');
      life.now = new Date('2026-10-02T15:00:00Z');
      await life.sync();
      expect(life.keeper.statusView().lastSync).toEqual({ at: '2026-10-02T11:00:00-04:00', result: 'nothing-new' });
      // It fails: the last good read stays as it was.
      life.now = new Date('2026-10-02T16:00:00Z');
      life.h.fake.beforeCall = () => 'network';
      await expect(life.sync()).rejects.toThrow();
      expect(life.keeper.statusView().lastSync).toEqual({ at: '2026-10-02T12:00:00-04:00', result: 'failed' });
      expect(life.keeper.statusView().lastRead).toBe('2026-10-02T11:00:00-04:00');
      life.h.fake.beforeCall = undefined;
      life.now = new Date('2026-10-02T17:00:00Z');
      life.h.fake.needsLogin = true;
      await life.sync();
      expect(life.keeper.statusView().lastSync).toEqual({ at: '2026-10-02T13:00:00-04:00', result: 'needs-login' });
      // When the server started stays when it started.
      expect(life.keeper.statusView().started).toBe('2026-10-02T09:00:00-04:00');
    } finally {
      life.done();
    }
  });

  it('0.7 0.6 the history: how many events there were when the books opened, every one replayed, and how many now', async () => {
    const life = await setUp();
    try {
      setUpThroughTheDesk(life);
      life.now = new Date('2026-10-02T14:00:00Z');
      life.h.fake.addPosted({ id: 'shop', account: C, amount: 2_399, date: '2026-10-02', description: 'MADE UP SHOP' });
      await life.sync();
      const events = (life.h.db.prepare('SELECT COUNT(*) AS n FROM book_events').get() as { n: number }).n;
      expect(events).toBeGreaterThan(1);
      expect(life.keeper.statusView().history).toEqual({ whenOpened: 0, now: events });
      // Started again: every event replayed when the books opened, and when that was.
      life.now = new Date('2026-10-02T15:30:00Z');
      life.restart();
      serve(life);
      expect(life.keeper.statusView()).toMatchObject({ started: '2026-10-02T11:30:00-04:00', history: { whenOpened: events, now: events }, lastSync: null, lastRead: '2026-10-02T10:00:00-04:00' });
    } finally {
      life.done();
    }
  });

  it('0.7 10.4 since when the totals have not matched the bank, and the alerts waiting to be sent', async () => {
    const life = await setUp();
    try {
      setUpThroughTheDesk(life);
      life.keeper.checkAlerts();
      life.now = new Date('2026-10-02T14:00:00Z');
      life.h.fake.drift(C, -4_210);
      // And a purchase no rule sorts, so the evening has a daily review (10.3).
      life.h.fake.addPosted({ id: 'shop', account: ACCOUNT_IDS.everyday, amount: 2_399, date: '2026-10-02', description: 'MADE UP SHOP' });
      await life.sync();
      expect(life.keeper.statusView().mismatchSince).toBe('2026-10-02T10:00:00-04:00');
      // 12 hours on, in quiet hours: the daily review and the difference's alert, waiting to be sent.
      life.now = new Date('2026-10-03T02:00:00Z');
      life.keeper.checkAlerts();
      // One of them sent: it no longer waits.
      const first = readOutbox(life.h.db, 100).rows.find((r) => r.sentAt === null);
      if (first === undefined) throw new Error('no alert');
      life.keeper.trying(first.key);
      life.keeper.sent(first.key);
      const waiting = readOutbox(life.h.db, 100).rows.filter((r) => r.sentAt === null && r.notSent === null).length;
      expect(waiting).toBeGreaterThan(0);
      expect(readOutbox(life.h.db, 100).total).toBeGreaterThan(waiting);
      expect(life.keeper.statusView().alertsWaiting).toBe(waiting);
      life.h.fake.drift(C, 4_210);
      await life.sync();
      expect(life.keeper.statusView().mismatchSince).toBeNull();
    } finally {
      life.done();
    }
  });

  it('0.7 A43 the backups, hosted: copying while the heartbeat comes, not once it has stopped for 10 minutes; none on a computer', async () => {
    const life = await setUp();
    try {
      let clock = Date.parse('2026-10-02T13:00:00Z');
      const watch = new BackupWatch(() => clock);
      expect(life.keeper.statusView(watch).backups).toEqual({ copying: true, lastBeat: null });
      clock += 60_000;
      watch.beat();
      expect(life.keeper.statusView(watch).backups).toEqual({ copying: true, lastBeat: '2026-10-02T09:01:00-04:00' });
      clock += 10 * 60_000;
      expect(life.keeper.statusView(watch).backups).toEqual({ copying: false, lastBeat: '2026-10-02T09:01:00-04:00' });
      expect(life.keeper.statusView().backups).toBeNull();
    } finally {
      life.done();
    }
  });

  it('0.7 0.6 when the server started is when it began serving the books: opening them never asks the clock', async () => {
    const life = await lifeInAFile();
    try {
      life.now = new Date('2026-10-02T13:00:00Z');
      life.restart();
      life.now = new Date('2026-10-02T13:05:00Z');
      serve(life);
      life.now = new Date('2026-10-02T14:00:00Z');
      expect(life.keeper.statusView().started).toBe('2026-10-02T09:05:00-04:00');
    } finally {
      life.done();
    }
  });

  it('0.7 no amounts: nothing on the page is money, whatever the books hold', async () => {
    const life = await setUp();
    try {
      setUpThroughTheDesk(life);
      life.h.fake.drift(C, -4_210);
      await life.sync();
      const text = JSON.stringify(life.keeper.statusView());
      for (const amount of ['4210', '42.10', '300000', '3000', '$']) expect(text).not.toContain(amount);
      expect(Object.keys(life.keeper.statusView()).sort()).toEqual(['alertsWaiting', 'backups', 'history', 'lastRead', 'lastSync', 'mismatchSince', 'started', 'state', 'timeZone', 'today']);
    } finally {
      life.done();
    }
  });

  it('0.7 /api/status needs a login, and answers the status with one; /status is a screen of the app', async () => {
    const life = await setUp();
    try {
      const server = serve(life);
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
      try {
        const base = `http://localhost:${(server.address() as AddressInfo).port}`;
        expect((await fetch(`${base}/api/status`)).status).toBe(401);
        const cookie = loginForTests(life.h.db, life.now);
        const answer = await fetch(`${base}/api/status`, { headers: { cookie } });
        expect(answer.status).toBe(200);
        expect(answer.headers.get('cache-control')).toBe('no-store');
        expect(await answer.json()).toEqual(JSON.parse(JSON.stringify(life.keeper.statusView())));
        expect((await fetch(`${base}/status`, { headers: { cookie } })).status).toBe(200);
      } finally {
        await new Promise<void>((done) => server.close(() => done()));
      }
      // Hosted, with the watch on the backups: the page says how they are.
      let clock = life.now.getTime();
      const watch = new BackupWatch(() => clock);
      watch.beat();
      const hosted = life.keeper.server(join(life.dir, 'dist'), () => `http://localhost:${(hosted.address() as AddressInfo).port}`, undefined, { backups: watch });
      await new Promise<void>((done) => hosted.listen(0, '127.0.0.1', () => done()));
      try {
        const base = `http://localhost:${(hosted.address() as AddressInfo).port}`;
        const cookie = loginForTests(life.h.db, life.now);
        expect(((await (await fetch(`${base}/api/status`, { headers: { cookie } })).json()) as { backups: unknown }).backups).toEqual({ copying: true, lastBeat: '2026-10-02T09:00:00-04:00' });
        clock += 11 * 60_000;
        expect(((await (await fetch(`${base}/api/status`, { headers: { cookie } })).json()) as { backups: unknown }).backups).toEqual({ copying: false, lastBeat: '2026-10-02T09:00:00-04:00' });
      } finally {
        await new Promise<void>((done) => hosted.close(() => done()));
      }
    } finally {
      life.done();
    }
  });
});
