import { describe, expect, it } from 'vitest';
import { outboxCounts, outboxKeys } from '../src/alerts/outbox.js';
import { openDatabase } from '../src/db/database.js';
import { Keeper } from '../src/history/keeper.js';
import { memoryLog } from '../src/log.js';
import type { AlertTimer } from '../src/serve/alert-timer.js';
import { serveBooks } from '../src/serve/serving.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { FakePhone } from './fake-phone.js';
import { choose, decisions, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Phase 5, part one, random scenarios: restarts at any moment never repeat or
// lose an alert. Two servers are given the same random activity on the same
// clock (purchases, the bank taking some back, answers, time passing over
// evenings, syncs that fail, a phone that cannot be reached). One runs
// throughout; the other is stopped and started again at random moments,
// including the moment an alert has reached the phone but is not yet marked
// sent (the database closed right then), and with a save stopped halfway.
// After every step both phones have shown the same alerts, each once (a send
// tried again after a stop reaches the phone as a repeat of the same id, which
// it does not show again), and a fresh copy of each from its database replays.
// ALERT_SCENARIOS=n runs more; SEED=n replays one. Every name and number is
// made up.

const E = ACCOUNT_IDS.everyday;
const MINUTE = 60_000;
const SCENARIOS = Number(process.env['ALERT_SCENARIOS'] ?? 12);
const FIRST = process.env['SEED'] === undefined ? 1 : Number(process.env['SEED']);
const STEPS = 40;

function randomFrom(seed: number): { int(lo: number, hi: number): number; chance(outOf: number): boolean } {
  let state = seed * 2_654_435_761 + 7;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  return { int: (lo, hi) => lo + (next() % (hi - lo + 1)), chance: (outOf) => next() % outOf === 0 };
}

interface Server {
  readonly life: Life;
  readonly clock: FakeClock;
  readonly phone: FakePhone;
  alerts: AlertTimer;
  // For a save stopped halfway: thrown inside the next save, once.
  stopNextSave: boolean;
  crashed: boolean;
}

function serve(server: Omit<Server, 'alerts'> & { alerts?: AlertTimer }): AlertTimer {
  const { life } = server;
  const { alerts } = serveBooks({
    keeper: life.keeper,
    bank: { plaid: life.h.plaid, box: life.h.box, log: memoryLog([]), pageSize: 3 },
    clock: server.clock,
    webRoot: 'C:/made-up/no-screens/',
    origin: () => '',
    sender: server.phone,
  });
  alerts.start();
  return alerts;
}

async function aServer(): Promise<Server> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life, { wants: 30_000 });
  life.now = noonInNewYork('2026-10-02');
  const partial = { life, clock: new FakeClock(life), phone: new FakePhone(() => life.now), stopNextSave: false, crashed: false };
  const server = partial as Server;
  server.alerts = serve(partial);
  await server.alerts.idle();
  return server;
}

// Stopped and started again: the books opened from the database file, with a
// save that can be stopped halfway.
async function restart(server: Server): Promise<void> {
  await server.alerts.stop();
  try {
    server.life.h.db.close();
  } catch {
    // Closed already: it stopped in the middle of a send.
  }
  const db = openDatabase(server.life.path);
  (server.life.h as { db: typeof db }).db = db;
  server.life.keeper = Keeper.open({
    db,
    now: () => server.life.now,
    beforeCommit: () => {
      if (!server.stopNextSave) return;
      server.stopNextSave = false;
      throw new Error('stopped halfway');
    },
  });
  server.crashed = false;
  server.alerts = serve(server);
  await server.alerts.idle();
}

async function sync(server: Server): Promise<void> {
  try {
    await server.life.keeper.sync({ plaid: server.life.h.plaid, box: server.life.h.box, log: memoryLog([]), pageSize: 3 });
  } catch {
    // A sync that failed changes nothing; it is tried again.
  }
  await server.alerts.idle();
}

async function scenario(seed: number): Promise<{ readonly shown: number; readonly crashes: number; readonly restarts: number; readonly halfway: number }> {
  const r = randomFrom(seed);
  const a = await aServer();
  const b = await aServer();
  const both = [a, b];
  const idsA = decisions(`a${seed}`);
  const idsB = decisions(`b${seed}`);
  const posted: string[] = [];
  let made = 0;
  let crashes = 0;
  let restarts = 0;
  let halfway = 0;
  try {
    for (let step = 0; step < STEPS; step++) {
      const where = `seed ${seed}, step ${step}`;
      const roll = r.int(1, 100);
      if (roll <= 35) {
        // A purchase, sorted by a rule or left waiting.
        const id = `p-${(made += 1)}`;
        const description = ['MADE UP GROCERY', 'MADE UP COFFEE', 'MADE UP SHOP'][r.int(0, 2)] as string;
        const amount = r.int(1, 12_000);
        for (const s of both) s.life.h.fake.addPosted({ id, account: E, amount, date: s.life.now.toISOString().slice(0, 10), description });
        posted.push(id);
        for (const s of both) await sync(s);
      } else if (roll <= 45 && posted.length > 0) {
        // The bank takes one back (10.6).
        const id = posted.splice(r.int(0, posted.length - 1), 1)[0] as string;
        for (const s of both) s.life.h.fake.removePosted(id, { keepBalance: false });
        for (const s of both) await sync(s);
      } else if (roll <= 60) {
        // An answer: something waiting sorted into a bucket.
        const waiting = a.life.keeper.book()?.reviewItems().find((i) => i.type === 'spending');
        if (waiting !== undefined) {
          const choice = { to: r.chance(2) ? ('needs' as const) : ('wants' as const) };
          const answers = [choose(a.life.keeper, { item: waiting.id, choice }, idsA()), choose(b.life.keeper, { item: waiting.id, choice }, idsB())];
          expect(answers[1]?.ok, where).toBe(answers[0]?.ok);
          for (const s of both) await s.alerts.idle();
        }
      } else if (roll <= 80) {
        // Time passes, over an evening now and then.
        const ms = r.chance(3) ? r.int(6, 20) * 60 * MINUTE : r.int(1, 90) * MINUTE;
        for (const s of both) await s.clock.advance(ms, () => s.alerts.idle());
      } else if (roll <= 84) {
        // The bank cannot be reached.
        for (const s of both) {
          s.life.h.fake.beforeCall = () => 'network';
          await sync(s);
          s.life.h.fake.beforeCall = undefined;
        }
      } else if (roll <= 88) {
        // The phone cannot be reached, or can again.
        const failing = a.phone.failing === null ? 'the phone cannot be reached' : null;
        for (const s of both) s.phone.failing = failing;
      } else if (roll <= 93) {
        await restart(b);
        restarts += 1;
      } else if (roll <= 97) {
        // The next alert reaches the phone, and the server stops right then,
        // before it can mark it sent.
        b.phone.afterShowing = () => {
          b.crashed = true;
          void b.alerts.stop();
          b.life.h.db.close();
        };
      } else {
        // The next save is stopped halfway; it is done again at once.
        b.stopNextSave = true;
        const id = `p-${(made += 1)}`;
        for (const s of both) s.life.h.fake.addPosted({ id, account: E, amount: r.int(1, 5_000), date: s.life.now.toISOString().slice(0, 10), description: 'MADE UP SHOP' });
        posted.push(id);
        for (const s of both) await sync(s);
        if (!b.stopNextSave) halfway += 1;
        b.stopNextSave = false;
        await sync(b);
        b.alerts.poke();
        await b.alerts.idle();
      }
      if (b.crashed) {
        crashes += 1;
        await restart(b);
      }
      // After every step: both phones have shown the same alerts, each once.
      expect(b.phone.ids().toSorted(), `${where}: the same alerts shown on both phones`).toEqual(a.phone.ids().toSorted());
      expect(a.phone.repeats, `${where}: nothing sent twice by the server that ran throughout`).toBe(0);
      expect(b.phone.repeats, `${where}: a repeat only for a send stopped in the middle`).toBeLessThanOrEqual(crashes);
      expect(outboxKeys(b.life.h.db), `${where}: the same alerts kept`).toEqual(outboxKeys(a.life.h.db));
      // A fresh copy of each from its database replays, alerts and all.
      for (const s of both) s.life.reopen().close();
    }
    // In the end, with the phone answering, everything is sent, once.
    for (const s of both) {
      s.phone.failing = null;
      s.phone.afterShowing = null;
      await s.clock.advance(2 * 60 * MINUTE, () => s.alerts.idle());
      expect(outboxCounts(s.life.h.db).notSent, `seed ${seed}: everything sent`).toBe(0);
      expect(s.phone.ids().toSorted(), `seed ${seed}: every alert kept is shown, once`).toEqual(outboxKeys(s.life.h.db).toSorted());
    }
    expect(b.phone.ids().toSorted()).toEqual(a.phone.ids().toSorted());
    return { shown: a.phone.shown.length, crashes, restarts, halfway };
  } finally {
    for (const s of both) {
      await s.alerts.stop();
      s.life.done();
    }
  }
}

describe('Phase 5 random scenarios: restarts at any moment never repeat or lose an alert', () => {
  it('0.6 10.1 10.2 10.3 10.6 two servers given the same random activity, one stopped and started again at random moments', async () => {
    let shown = 0;
    let crashes = 0;
    let restarts = 0;
    let halfway = 0;
    for (let seed = FIRST; seed < FIRST + SCENARIOS; seed++) {
      const o = await scenario(seed);
      shown += o.shown;
      crashes += o.crashes;
      restarts += o.restarts;
      halfway += o.halfway;
    }
    if (SCENARIOS >= 12) {
      expect(shown).toBeGreaterThan(SCENARIOS);
      expect(crashes).toBeGreaterThan(0);
      expect(restarts).toBeGreaterThan(SCENARIOS);
      expect(halfway).toBeGreaterThan(0);
    }
  }, 600_000);
});
