import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lastSeqOf, readHistory, replayHistory } from '../src/history/history-db.js';
import type { Keeper } from '../src/history/keeper.js';
import type { TrendsPeriod, TrendsView } from '../src/views/trends.js';
import { ACCOUNT_IDS, type FakePlaid } from './fake-plaid.js';
import { dump } from './harness.js';
import { decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { loginForTests } from './login-for-tests.js';

// The Trends tab on the real server (section 40): the books, and the bank
// history the app kept from before setup day, read by today's rules. It
// only reads: nothing in the database changes, and the history still replays
// to its totals (0.6). Connected and set up on Oct 1, 2026, the last paycheck
// Sep 25, every 14 days. Every name and number is made up.

const C = ACCOUNT_IDS.checking;
const E = ACCOUNT_IDS.everyday;

// What the bank sent before setup day. Plaid's sign: positive is money out.
function history(fake: FakePlaid): void {
  fake.addPosted({ id: 'g1', account: C, amount: 4_200, date: '2026-09-27', description: 'PURCHASE 09/27 GREEN GROCERY' });

  // A payment to a person (the bank rule "Zelle payment to"); no mom rule yet.
  fake.addPosted({ id: 'm1', account: C, amount: 50_000, date: '2026-09-28', description: 'Zelle payment to MOM MADEUP' });
  // Money in: not spending.
  fake.addPosted({ id: 'pay', account: C, amount: -400_000, date: '2026-09-25', description: 'MADEUP CORP PAYROLL' });
  // The pay period before, Sep 11 to Sep 24.
  fake.addPosted({ id: 's1', account: E, amount: 1_100, date: '2026-09-12', description: 'BLUE DOOR COFFEE' });
  // The bank rule "payment to CRD 4444" on checking: to the old card (5.2). Over 10 days before setup day, so history (14.2).
  fake.addPosted({ id: 'o1', account: C, amount: 30_000, date: '2026-09-15', description: 'ONLINE payment to CRD 4444' });
  // Still pending on setup day: counted then, at 20.00 (14.2).
  fake.addPending({ id: 'p1', account: E, amount: 2_000, date: '2026-09-30', description: 'HARBOR DINER' });
}

function tracking(view: TrendsView): Extract<TrendsView, { state: 'tracking' }> {
  if (view.state !== 'tracking') throw new Error(`expected tracking, got ${view.state}`);
  return view;
}

function settingsYes(keeper: Keeper, settings: Parameters<Keeper['settingsChange']>[0]['settings']): void {
  const id = decision();
  const asked = keeper.settingsChange({ id, settings });
  if (asked.ok) return;
  if (asked.code !== 'needs-confirmation' || asked.preview === undefined) throw new Error(`settings refused: ${asked.why}`);
  const yes = keeper.settingsChange({ id, settings, confirmed: true, seen: asked.preview.key });
  if (!yes.ok) throw new Error(`settings refused: ${yes.why}`);
}

async function setUpLife(): Promise<Life> {
  const life = await lifeInAFile({ history });
  const started = setUpThroughTheDesk(life);
  if (!started.ok) throw new Error(`setup day refused: ${started.why}`);
  life.now = noonInNewYork('2026-10-02');
  // The pending dinner posts with a tip: 24.50. The books count only the 4.50 more (A10).
  life.h.fake.postPending('p1', { id: 'p1-posted', date: '2026-10-01', amount: 2_450 }, { link: true });
  await life.sync();
  return life;
}

const current = (v: Extract<TrendsView, { state: 'tracking' }>): TrendsPeriod => v.periods.at(-1) as TrendsPeriod;

describe('40.1 40.3 Trends on the real server', () => {
  it('40.1 40.3 the history kept from before setup day, read by today’s rules; a charge pending on setup day counted once', async () => {
    const life = await setUpLife();
    try {
      const v = tracking(life.keeper.trends());
      // Section 2: the 90 days asked for at connection (Oct 1).
      expect(v.historyFrom).toBe('2026-07-03');
      expect(v.setupDay).toBe('2026-10-01');
      const here = current(v);
      expect(here).toMatchObject({ startDate: '2026-09-25', beforeSetup: 'part', current: true });
      expect(here.items.map((i) => [i.id, i.part, i.amount, i.beforeSetup]).sort()).toEqual(
        [
          ['g1', 'unsorted', 4_200, true],
          ['m1', 'unsorted', 50_000, true],
          // Pending on setup day, at the amount setup day counted.
          ['p1', 'unsorted', 2_000, true],
        ]
          .concat(here.items.filter((i) => !i.beforeSetup).map((i) => [i.id, i.part, i.amount, i.beforeSetup] as [string, string, number, boolean]))
          .sort(),
      );
      // In the books, only the tip, waiting in review: 20.00 + 4.50 is the 24.50 it posted at.
      const books = here.items.filter((i) => !i.beforeSetup);
      expect(books.map((i) => [i.part, i.amount])).toEqual([['unsorted', 450]]);
      const before = v.periods.find((p) => p.startDate === '2026-09-11');
      expect(before?.items.map((i) => [i.id, i.part, i.amount])).toEqual([
        ['o1', 'old-card', 30_000],
        ['s1', 'unsorted', 1_100],
      ]);
    } finally {
      life.done();
    }
  });

  it('40.1 working Trends out saves nothing, and the history still replays to its totals (0.6)', async () => {
    const life = await setUpLife();
    try {
      const was = dump(life.h.db);
      const seq = lastSeqOf(life.h.db);
      const first = life.keeper.trends();
      expect(life.keeper.trends()).toEqual(first);
      expect(dump(life.h.db)).toEqual(was);
      expect(lastSeqOf(life.h.db)).toBe(seq);
      // Every event replays to the totals saved with it.
      expect(() => replayHistory(readHistory(life.h.db), true)).not.toThrow();
      // Opened again from the file, as a restart would: the same Trends.
      const again = life.reopen();
      try {
        expect(again.keeper.trends()).toEqual(first);
      } finally {
        again.close();
      }
    } finally {
      life.done();
    }
  });

  it('40.1 a rule set later changes how the history reads, never the books', async () => {
    const life = await setUpLife();
    try {
      const buckets = life.keeper.buckets();
      settingsYes(life.keeper, { momRule: { contains: 'MOM MADEUP' } });
      const v = tracking(life.keeper.trends());
      // 8.1: a payment the mom rule matches is not spending.
      expect(current(v).items.map((i) => i.id)).not.toContain('m1');
      expect(life.keeper.buckets()).toEqual(buckets);
    } finally {
      life.done();
    }
  });

  it('40.1 /api/trends needs a login, and answers Trends with one; /trends is a screen of the app', async () => {
    const life = await setUpLife();
    try {
      const webRoot = join(life.dir, 'dist');
      mkdirSync(webRoot, { recursive: true });
      writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
      const server = life.keeper.server(webRoot, () => `http://localhost:${(server.address() as AddressInfo | null)?.port ?? 0}`);
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
      try {
        const base = `http://localhost:${(server.address() as AddressInfo).port}`;
        expect((await fetch(`${base}/api/trends`)).status).toBe(401);
        const cookie = loginForTests(life.h.db, life.now);
        const answer = await fetch(`${base}/api/trends`, { headers: { cookie } });
        expect(answer.status).toBe(200);
        expect(answer.headers.get('cache-control')).toBe('no-store');
        expect(await answer.json()).toEqual(JSON.parse(JSON.stringify(life.keeper.trends())));
        expect((await fetch(`${base}/trends`, { headers: { cookie } })).status).toBe(200);
        // It only reads: there is no way to send it anything.
        expect((await fetch(`${base}/api/trends`, { method: 'POST', headers: { cookie, Origin: base } })).status).not.toBe(200);
      } finally {
        await new Promise<void>((done) => server.close(() => done()));
      }
    } finally {
      life.done();
    }
  });
});
