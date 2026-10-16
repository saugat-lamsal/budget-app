import { describe, expect, it } from 'vitest';
import type { Keeper } from '../src/history/keeper.js';
import type { OnItsWayIn } from '../src/views/home.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Rule 11.4 (QUESTIONS.md A56, docs/later.txt 30): money still pending into
// checking or savings, which the books count only once it posts (12.1), is
// shown on Home with its amount and account; one the paycheck rule matches
// is the paycheck on its way. Nothing else changes until it posts. Every
// name and number is made up.

const C = ACCOUNT_IDS.checking;
const S = ACCOUNT_IDS.savings;
const E = ACCOUNT_IDS.everyday;
const NOON_OCT_2 = '2026-10-02T12:00:00-04:00';

function onItsWayIn(keeper: Keeper): readonly OnItsWayIn[] {
  const home = keeper.home();
  if (home.state !== 'tracking') throw new Error('not tracking');
  return home.onItsWayIn;
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
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  return life;
}

describe('11.4 money on its way in, on Home', () => {
  it('11.4 a paycheck pending in two parts shows on Home as on its way, with each amount and account; nothing else changes; gone once it posts', async () => {
    const life = await setUpLife();
    try {
      settingsYes(life.keeper, { paycheckRule: { contains: 'MADE UP EMPLOYER PAYROLL' } });
      await life.sync();
      const before = { buckets: life.keeper.buckets(), review: life.keeper.review() };
      expect(onItsWayIn(life.keeper)).toEqual([]);
      life.h.fake.addPending({ id: 'pay-s-p', account: S, amount: -40_000, date: '2026-10-02', description: 'MADE UP EMPLOYER PAYROLL' });
      life.h.fake.addPending({ id: 'pay-c-p', account: C, amount: -180_000, date: '2026-10-02', description: 'MADE UP EMPLOYER PAYROLL' });
      await life.sync();
      // Checking first, then savings.
      // A57: pending since the read that first saw them, noon in New York.
      expect(onItsWayIn(life.keeper)).toEqual([
        { account: 'checking', amount: 180_000, date: '2026-10-02', paycheck: true, since: { at: NOON_OCT_2 }, usually: null },
        { account: 'savings', amount: 40_000, date: '2026-10-02', paycheck: true, since: { at: NOON_OCT_2 }, usually: null },
      ]);
      expect(life.keeper.buckets()).toEqual(before.buckets);
      expect(life.keeper.review()).toEqual(before.review);
      const home = life.keeper.home();
      expect(home.state === 'tracking' && home.safeToSpend.shown).toBe(true);
      life.h.fake.postPending('pay-c-p', { id: 'pay-c', date: '2026-10-03' });
      life.now = noonInNewYork('2026-10-03');
      await life.sync();
      expect(onItsWayIn(life.keeper)).toEqual([{ account: 'savings', amount: 40_000, date: '2026-10-02', paycheck: true, since: { at: NOON_OCT_2 }, usually: null }]);
      life.h.fake.postPending('pay-s-p', { id: 'pay-s', date: '2026-10-03' });
      await life.sync();
      expect(onItsWayIn(life.keeper)).toEqual([]);
    } finally {
      life.done();
    }
  });

  it('11.4 money pending in that the paycheck rule does not match is on its way in, not a paycheck; with no paycheck rule, none is', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPending({ id: 'friend-p', account: C, amount: -2_500, date: '2026-10-01', description: 'MADE UP FRIEND PAYBACK' });
      life.h.fake.addPending({ id: 'pay-c-p', account: C, amount: -180_000, date: '2026-10-02', description: 'MADE UP EMPLOYER PAYROLL' });
      await life.sync();
      // Oldest first.
      expect(onItsWayIn(life.keeper)).toEqual([
        { account: 'checking', amount: 2_500, date: '2026-10-01', paycheck: false, since: { at: NOON_OCT_2 }, usually: null },
        { account: 'checking', amount: 180_000, date: '2026-10-02', paycheck: false, since: { at: NOON_OCT_2 }, usually: null },
      ]);
      settingsYes(life.keeper, { paycheckRule: { contains: 'made up employer' } });
      expect(onItsWayIn(life.keeper).map((p) => p.paycheck)).toEqual([false, true]);
    } finally {
      life.done();
    }
  });

  it('11.4 only money coming in to checking or savings: not money going out, not a card, not a transfer between his accounts, not one the bank dropped', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPending({ id: 'cafe-p', account: C, amount: 650, date: '2026-10-02', description: 'MADE UP CAFE' });
      life.h.fake.addPending({ id: 'zelle-p', account: S, amount: 2_500, date: '2026-10-02', description: 'Zelle payment to MADE UP FRIEND' });
      life.h.fake.addPending({ id: 'card-refund-p', account: E, amount: -1_999, date: '2026-10-02', description: 'MADE UP STORE REFUND' });
      life.h.fake.addPending({ id: 'from-chk-p', account: S, amount: -30_000, date: '2026-10-02', description: 'Online transfer from CHK 1111' });
      life.h.fake.addPending({ id: 'odd-p', account: S, amount: -5_000, date: '2026-10-02', description: 'MADE UP DEPOSIT' });
      await life.sync();
      expect(onItsWayIn(life.keeper)).toEqual([{ account: 'savings', amount: 5_000, date: '2026-10-02', paycheck: false, since: { at: NOON_OCT_2 }, usually: null }]);
      life.h.fake.dropPending('odd-p');
      await life.sync();
      expect(onItsWayIn(life.keeper)).toEqual([]);
    } finally {
      life.done();
    }
  });

  it('11.4 0.5 while the bank cannot be read, nothing is shown on its way in', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPending({ id: 'pay-c-p', account: C, amount: -180_000, date: '2026-10-02', description: 'MADE UP EMPLOYER PAYROLL' });
      await life.sync();
      expect(onItsWayIn(life.keeper)).toHaveLength(1);
      life.h.fake.needsLogin = true;
      await life.sync();
      expect(onItsWayIn(life.keeper)).toEqual([]);
    } finally {
      life.done();
    }
  });

  it('11.4 A57 pending since the read that first saw it; once 3 earlier paychecks went from pending to posted on checking, usually posts within, from them', async () => {
    const life = await setUpLife();
    try {
      settingsYes(life.keeper, { paycheckRule: { contains: 'MADE UP EMPLOYER PAYROLL' } });
      const start = Date.parse('2026-10-02T10:00:00Z');
      // Three paychecks: seen pending, then posted 5, 9 and 7 hours later.
      for (const [n, hours] of [[1, 5], [2, 9], [3, 7]] as const) {
        const at = start + (n - 1) * 15 * 24 * 3_600_000;
        life.now = new Date(at);
        life.h.fake.addPending({ id: `pay-${n}-p`, account: C, amount: -180_000, date: '2026-10-02', description: 'MADE UP EMPLOYER PAYROLL' });
        await life.sync();
        expect(onItsWayIn(life.keeper)[0]?.usually, `before paycheck ${n} posted`).toBeNull();
        life.now = new Date(at + hours * 3_600_000);
        life.h.fake.postPending(`pay-${n}-p`, { id: `pay-${n}`, date: '2026-10-03' });
        await life.sync();
      }
      // The fourth: pending since 6:12 AM in New York, and the three before say within 9 hours.
      life.now = new Date('2026-11-16T11:12:00Z');
      life.h.fake.addPending({ id: 'pay-4-p', account: C, amount: -180_000, date: '2026-11-16', description: 'MADE UP EMPLOYER PAYROLL' });
      // Money in from a friend, also on checking: no earlier ones of its kind.
      life.h.fake.addPending({ id: 'friend-p', account: C, amount: -2_500, date: '2026-11-16', description: 'ZELLE FROM MADE UP FRIEND' });
      // And a paycheck part into savings: none there before.
      life.h.fake.addPending({ id: 'pay-4-s-p', account: S, amount: -40_000, date: '2026-11-16', description: 'MADE UP EMPLOYER PAYROLL' });
      await life.sync();
      const since = { at: '2026-11-16T06:12:00-05:00' };
      expect(onItsWayIn(life.keeper)).toEqual([
        { account: 'checking', amount: 180_000, date: '2026-11-16', paycheck: true, since, usually: { within: 9, unit: 'hours' } },
        { account: 'checking', amount: 2_500, date: '2026-11-16', paycheck: false, since, usually: null },
        { account: 'savings', amount: 40_000, date: '2026-11-16', paycheck: true, since, usually: null },
      ]);
      // Still pending a read later, its words changed by the bank: since when it was first seen, not the last read.
      life.now = new Date('2026-11-16T12:12:00Z');
      life.h.fake.modify('pay-4-p', { description: 'MADE UP EMPLOYER PAYROLL DIR DEP' });
      await life.sync();
      expect(onItsWayIn(life.keeper)[0]?.since).toEqual(since);
      // After a restart, the same.
      life.restart();
      expect(onItsWayIn(life.keeper)[0]).toEqual({ account: 'checking', amount: 180_000, date: '2026-11-16', paycheck: true, since, usually: { within: 9, unit: 'hours' } });
      expect(life.h.db.prepare("SELECT first_sync < last_sync AS changed FROM bank_items WHERE transaction_id = 'pay-4-p'").get()).toEqual({ changed: 1 });
    } finally {
      life.done();
    }
  });

  it('11.4 A57 one first seen in a sync whose time is not known says the day the bank dated it', async () => {
    const life = await setUpLife();
    try {
      // A sync without a read (as at connecting the test bank).
      life.h.fake.addPending({ id: 'odd-p', account: S, amount: -5_000, date: '2026-10-01', description: 'MADE UP DEPOSIT' });
      await life.h.sync('2026-10-02');
      life.keeper.reload();
      expect(onItsWayIn(life.keeper)).toEqual([{ account: 'savings', amount: 5_000, date: '2026-10-01', paycheck: false, since: { day: '2026-10-01' }, usually: null }]);
    } finally {
      life.done();
    }
  });
});
