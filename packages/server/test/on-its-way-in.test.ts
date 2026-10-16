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
      expect(onItsWayIn(life.keeper)).toEqual([
        { account: 'checking', amount: 180_000, date: '2026-10-02', paycheck: true },
        { account: 'savings', amount: 40_000, date: '2026-10-02', paycheck: true },
      ]);
      expect(life.keeper.buckets()).toEqual(before.buckets);
      expect(life.keeper.review()).toEqual(before.review);
      const home = life.keeper.home();
      expect(home.state === 'tracking' && home.safeToSpend.shown).toBe(true);
      life.h.fake.postPending('pay-c-p', { id: 'pay-c', date: '2026-10-03' });
      life.now = noonInNewYork('2026-10-03');
      await life.sync();
      expect(onItsWayIn(life.keeper)).toEqual([{ account: 'savings', amount: 40_000, date: '2026-10-02', paycheck: true }]);
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
        { account: 'checking', amount: 2_500, date: '2026-10-01', paycheck: false },
        { account: 'checking', amount: 180_000, date: '2026-10-02', paycheck: false },
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
      expect(onItsWayIn(life.keeper)).toEqual([{ account: 'savings', amount: 5_000, date: '2026-10-02', paycheck: false }]);
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
});
