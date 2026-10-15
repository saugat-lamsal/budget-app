import { describe, expect, it } from 'vitest';
import { readOutbox } from '../src/alerts/outbox.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { lifeInAFile, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Rule 10.4 (QUESTIONS.md A47, his call, Oct 14, 2026) through the real
// books: the read that first shows a difference is noted; Home and Buckets
// say the bank is still catching up; the alert comes once the difference has
// lasted 12 hours (the setting), due at that moment; a read that matches
// clears it. Every number is made up.

const C = ACCOUNT_IDS.checking;
const mismatchKeys = (life: Life): string[] => readOutbox(life.h.db, 100).rows.filter((r) => r.key.startsWith('totals-mismatch')).map((r) => `${r.key} ${r.dueAt}`);

function homeSays(life: Life): string {
  const home = life.keeper.home();
  if (home.state !== 'tracking') throw new Error('not tracking');
  const s = home.safeToSpend;
  return s.shown ? 'shown' : s.why === 'totals-do-not-match' ? (s.catchingUp ? `catching up ${s.check.difference}` : `does not match ${s.check.difference}`) : s.why;
}

function bucketsSay(life: Life): string {
  const view = life.keeper.buckets();
  if (view.state !== 'tracking') throw new Error('not tracking');
  return view.check.state === 'does-not-match' ? `${view.check.catchingUp ? 'catching up' : 'does not match'} ${view.check.difference}` : view.check.state;
}

async function setUp(): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.keeper.checkAlerts();
  return life;
}

describe('10.4 A47 through the books: still catching up, then told after 12 hours', () => {
  it('10.4 A47 the read that shows a difference is noted; catching up for 12 hours; then the alert, due at the 12 hours; a read that matches clears it', async () => {
    const life = await setUp();
    try {
      // 9:00 AM on Oct 2 in New York.
      life.now = new Date('2026-10-02T13:00:00Z');
      life.h.fake.drift(C, -4_210);
      await life.sync();
      expect(life.keeper.mismatchSince()).toBe('2026-10-02T13:00:00.000Z');
      expect(homeSays(life)).toBe('catching up -4210');
      expect(bucketsSay(life)).toBe('catching up -4210');
      life.keeper.checkAlerts();
      expect(mismatchKeys(life)).toEqual([]);
      // The timer wakes at 9:00 PM at the latest (the evening is first, at 8:00 PM).
      expect(life.keeper.nextDueIn()).toBe(11 * 3_600_000);
      // A later read with the same difference keeps when it began.
      life.now = new Date('2026-10-02T14:00:00Z');
      await life.sync();
      expect(life.keeper.mismatchSince()).toBe('2026-10-02T13:00:00.000Z');
      // 9:00 PM: 12 hours.
      life.now = new Date('2026-10-03T01:00:00Z');
      life.keeper.checkAlerts();
      expect(mismatchKeys(life)).toEqual(['totals-mismatch 1 2026-10-03T01:00:00.000Z']);
      expect(homeSays(life)).toBe('does not match -4210');
      expect(bucketsSay(life)).toBe('does not match -4210');
      // The bank comes right: cleared.
      life.now = new Date('2026-10-03T13:00:00Z');
      life.h.fake.drift(C, 4_210);
      await life.sync();
      expect(life.keeper.mismatchSince()).toBeNull();
      expect(homeSays(life)).toBe('shown');
    } finally {
      life.done();
    }
  });

  it('10.4 A47 a difference that goes away within 12 hours is never told', async () => {
    const life = await setUp();
    try {
      life.now = new Date('2026-10-02T13:00:00Z');
      life.h.fake.drift(C, -4_210);
      await life.sync();
      life.now = new Date('2026-10-02T20:00:00Z');
      life.h.fake.drift(C, 4_210);
      await life.sync();
      expect(life.keeper.mismatchSince()).toBeNull();
      life.now = new Date('2026-10-03T13:00:00Z');
      life.keeper.checkAlerts();
      expect(mismatchKeys(life)).toEqual([]);
    } finally {
      life.done();
    }
  });

  it('10.4 A47 books from before this update, with a difference already there, note it when they open', async () => {
    const life = await setUp();
    try {
      life.now = new Date('2026-10-02T13:00:00Z');
      life.h.fake.drift(C, -4_210);
      await life.sync();
      life.h.db.prepare('DELETE FROM bank_gap').run();
      life.now = new Date('2026-10-02T13:30:00Z');
      life.restart();
      expect(life.keeper.mismatchSince()).toBe('2026-10-02T13:00:00.000Z');
    } finally {
      life.done();
    }
  });

  it('10.4 A47 when the gap began survives a restart', async () => {
    const life = await setUp();
    try {
      life.now = new Date('2026-10-02T13:00:00Z');
      life.h.fake.drift(C, -4_210);
      await life.sync();
      life.restart();
      expect(life.keeper.mismatchSince()).toBe('2026-10-02T13:00:00.000Z');
      expect(homeSays(life)).toBe('catching up -4210');
    } finally {
      life.done();
    }
  });
});
