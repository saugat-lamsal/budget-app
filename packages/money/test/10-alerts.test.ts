import { describe, expect, it } from 'vitest';
import type { Book } from '../src/index.js';
import { appSide, deposit, openTestBook, paycheck, purchase, type TestBookOptions } from './helpers.js';

// 10.4 (totals do not match the bank) is tested with the self-check in
// 12-self-check.test.ts.

const ROLL = { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } as const;

function book(options: TestBookOptions = {}) {
  return openTestBook({ pots: { savings: 0, needs: 10_000, wants: 10_000, momReserve: 0, heldForOthers: 0 }, ...options });
}

// The connection is fine and the bank matches the buckets exactly, so only
// the alerts under test show up.
function fine(b: Book) {
  return { bankConnection: 'ok', bankBalances: { checking: appSide(b.pots()), savings: 0, everydayCard: 0 } } as const;
}

// A purchase sorted to one bucket.
function spend(b: Book, id: string, amount: number, bucket: 'needs' | 'wants') {
  b.receive(purchase(id, '2026-10-10', amount, 'MADE UP STORE'));
  b.sort(id, { to: bucket }, '2026-10-10');
}

describe('10.1 low bucket: needs or wants falls below 20% of what it started the pay period with', () => {
  // With the starting settings, a 4,000.00 paycheck gives needs 750.00 and
  // wants 500.00, so from zero the alert levels are 150.00 and 100.00.
  function paid(options: TestBookOptions = {}) {
    const b = openTestBook({ settings: ROLL, ...options });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    return b;
  }

  it('10.1 one cent below 20% of the start: the low alert, with what is left and what it started with', () => {
    const b = paid();
    expect(b.startedPeriodWith()).toEqual({ needs: 75_000, wants: 50_000 });
    spend(b, 'e1', 60_001, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 14_999, startedWith: 75_000 }]);
  });

  it('10.1 exactly 20% left is not below it: no alert', () => {
    const b = paid();
    spend(b, 'e1', 60_000, 'needs');
    spend(b, 'e2', 40_000, 'wants');
    expect(b.pots()).toMatchObject({ needs: 15_000, wants: 10_000 });
    expect(b.takeAlerts(fine(b))).toEqual([]);
  });

  it('10.1 once per bucket per pay period, and needs and wants are counted separately', () => {
    const b = paid();
    spend(b, 'e1', 60_001, 'needs');
    expect(b.takeAlerts(fine(b))).toHaveLength(1);
    spend(b, 'e2', 5_000, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([]);
    spend(b, 'e3', 40_001, 'wants');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'low-bucket', bucket: 'wants', amount: 9_999, startedWith: 50_000 }]);
    expect(b.takeAlerts(fine(b))).toEqual([]);
  });

  it('10.1 a new pay period starts it over, measured against the new start, to the exact cent', () => {
    const b = paid();
    spend(b, 'e1', 60_001, 'needs');
    expect(b.takeAlerts(fine(b))).toHaveLength(1);
    b.receive(paycheck('p2', '2026-10-23', 400_000));
    // 149.99 rolled over plus the new 750.00. 20% of 899.99 is 179.998.
    expect(b.startedPeriodWith().needs).toBe(89_999);
    expect(b.takeAlerts(fine(b))).toEqual([]);
    spend(b, 'e2', 71_999, 'needs');
    expect(b.pots().needs).toBe(18_000);
    expect(b.takeAlerts(fine(b))).toEqual([]);
    spend(b, 'e3', 1, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 17_999, startedWith: 89_999 }]);
  });

  it('10.1 before the first paycheck, the start is what you assigned on setup day', () => {
    const b = openTestBook({ pots: { needs: 10_000, wants: 10_000 } });
    expect(b.startedPeriodWith()).toEqual({ needs: 10_000, wants: 10_000 });
    spend(b, 'e1', 8_001, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 1_999, startedWith: 10_000 }]);
  });

  it('10.1 what rolled over counts in the start (3.4)', () => {
    const b = paid({ pots: { needs: 25_000 } });
    expect(b.startedPeriodWith().needs).toBe(100_000);
    spend(b, 'e1', 80_000, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([]);
    spend(b, 'e2', 1, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 19_999, startedWith: 100_000 }]);
  });

  it('10.1 overspending carried over makes the start smaller (3.5)', () => {
    const b = paid({ pots: { needs: -10_000 } });
    expect(b.startedPeriodWith().needs).toBe(65_000);
    spend(b, 'e1', 52_000, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([]);
    spend(b, 'e2', 1, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 12_999, startedWith: 65_000 }]);
  });

  it('10.1 a leftover you move to savings is not part of the start; one you roll over is', () => {
    const asked = paid({ pots: { needs: 25_000, wants: 5_000 }, settings: { leftoverAtPayday: { needs: 'ask', wants: 'ask' } } });
    // Until you answer, the money stays where it is (3.4), and so does the start.
    expect(asked.startedPeriodWith()).toEqual({ needs: 100_000, wants: 55_000 });
    asked.answerLeftover('leftover:p1:needs', 'move-to-savings', '2026-10-10');
    asked.answerLeftover('leftover:p1:wants', 'roll-over', '2026-10-10');
    expect(asked.startedPeriodWith()).toEqual({ needs: 75_000, wants: 55_000 });
    spend(asked, 'e1', 60_001, 'needs');
    expect(asked.takeAlerts(fine(asked))).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 14_999, startedWith: 75_000 }]);
    const always = paid({ pots: { needs: 25_000 }, settings: { leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } } });
    expect(always.startedPeriodWith().needs).toBe(75_000);
  });

  it('10.1 a bucket that started at zero or below gets no low alert; the empty alert covers it', () => {
    const b = paid({ pots: { needs: -80_000 } });
    expect(b.startedPeriodWith().needs).toBe(-5_000);
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'empty-bucket', bucket: 'needs', amount: -5_000 }]);
    b.moveMoney({ from: 'wants', to: 'needs', amount: 6_000 }, '2026-10-10');
    expect(b.pots().needs).toBe(1_000);
    expect(b.takeAlerts(fine(b))).toEqual([]);
    const fromZero = openTestBook({ pots: { needs: 0, wants: 10_000 } });
    fromZero.receive(deposit('d1', '2026-10-05', 10_000, 'MADE UP FRIEND'));
    fromZero.sort('d1', { to: 'needs' }, '2026-10-05');
    spend(fromZero, 'e1', 9_999, 'needs');
    expect(fromZero.takeAlerts(fine(fromZero))).toEqual([]);
  });

  it('10.1 at zero or below only the empty alert comes; lifted back above zero but still low, the low alert comes then', () => {
    const b = paid();
    spend(b, 'e1', 75_000, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'empty-bucket', bucket: 'needs', amount: 0 }]);
    b.moveMoney({ from: 'wants', to: 'needs', amount: 1 }, '2026-10-10');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 1, startedWith: 75_000 }]);
    expect(b.takeAlerts(fine(b))).toEqual([]);
  });

  it('10.1 paybacks and hand moves during the pay period do not change the start', () => {
    const b = paid();
    b.moveMoney({ from: 'savings', to: 'needs', amount: 50_000, confirmed: true }, '2026-10-10');
    b.receive(deposit('d1', '2026-10-10', 10_000, 'MADE UP FRIEND'));
    b.sort('d1', { to: 'needs' }, '2026-10-10');
    expect(b.startedPeriodWith().needs).toBe(75_000);
    spend(b, 'e1', 120_001, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 14_999, startedWith: 75_000 }]);
  });

  it('10.1 the alert level is a setting, and a change applies right away', () => {
    const b = paid();
    spend(b, 'e1', 37_501, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([]);
    b.changeSettings({ lowBucketAlertPercent: 50 }, '2026-10-11');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 37_499, startedWith: 75_000 }]);
    const never = paid({ settings: { ...ROLL, lowBucketAlertPercent: 0 } });
    spend(never, 'e1', 74_999, 'needs');
    expect(never.takeAlerts(fine(never))).toEqual([]);
  });

  it('10.1 very large amounts are compared exactly', () => {
    const MAX = Number.MAX_SAFE_INTEGER;
    // 20% of MAX is 1,801,439,850,948,198.2 cents.
    // Wants gets a little so it is not empty; savings below zero keeps the total exact.
    const b = openTestBook({ pots: { needs: MAX, wants: 10_000, savings: -10_000 } });
    spend(b, 'e1', MAX - 1_801_439_850_948_199, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([]);
    spend(b, 'e2', 1, 'needs');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 1_801_439_850_948_198, startedWith: MAX }]);
  });

  it('10.1 a deposit you call your paycheck (6.1) starts the pay period it is measured from', () => {
    const b = openTestBook({ settings: ROLL });
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP NEW JOB'));
    b.sort('d1', { to: 'paycheck' }, '2026-10-05');
    expect(b.startedPeriodWith()).toEqual({ needs: 75_000, wants: 50_000 });
  });

  it('10.1 low alerts come first, then empty ones, then the others', () => {
    const b = paid();
    spend(b, 'e1', 60_001, 'needs');
    spend(b, 'e2', 50_000, 'wants');
    b.receive(purchase('e3', '2026-10-10', 100, 'MADE UP STORE'));
    expect(b.takeAlerts(fine(b))).toEqual([
      { kind: 'low-bucket', bucket: 'needs', amount: 14_999, startedWith: 75_000 },
      { kind: 'empty-bucket', bucket: 'wants', amount: 0 },
      { kind: 'daily-review', at: '20:00', waiting: 1 },
    ]);
  });

  it('10.1 both buckets low at once gives two alerts, needs first', () => {
    const b = paid();
    spend(b, 'e1', 60_001, 'needs');
    spend(b, 'e2', 40_001, 'wants');
    expect(b.takeAlerts(fine(b))).toEqual([
      { kind: 'low-bucket', bucket: 'needs', amount: 14_999, startedWith: 75_000 },
      { kind: 'low-bucket', bucket: 'wants', amount: 9_999, startedWith: 50_000 },
    ]);
  });

  it('10.1 bank balances that are not whole cents are refused, and the low alert is not marked as sent', () => {
    const b = paid();
    spend(b, 'e1', 60_001, 'needs');
    expect(() => b.takeAlerts({ bankConnection: 'ok', bankBalances: { checking: 0.5, savings: 0, everydayCard: 0 } })).toThrow();
    expect(b.takeAlerts(fine(b))).toHaveLength(1);
  });
});

describe('10.2 empty bucket: needs or wants reaches zero or below', () => {
  it('10.2 a bucket at exactly zero is empty', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-05', 10_000, 'MADE UP STORE'));
    b.sort('e1', { to: 'needs' }, '2026-10-05');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'empty-bucket', bucket: 'needs', amount: 0 }]);
  });

  it('10.2 below zero is empty too', () => {
    const b = book({ pots: { needs: 10_000, wants: -1 } });
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'empty-bucket', bucket: 'wants', amount: -1 }]);
  });

  it('10.2 one cent left is not empty', () => {
    const b = book({ pots: { needs: 1, wants: 1 } });
    expect(b.takeAlerts(fine(b))).toEqual([]);
  });

  it('10.2 only needs and wants: savings and the mom reserve at zero are not alerts', () => {
    const b = book({ pots: { savings: 0, momReserve: -5, needs: 10_000, wants: 10_000 } });
    expect(b.takeAlerts(fine(b))).toEqual([]);
  });

  it('10.2 both buckets empty gives two alerts', () => {
    const b = book({ pots: { needs: 0, wants: 0 } });
    expect(b.takeAlerts(fine(b))).toEqual([
      { kind: 'empty-bucket', bucket: 'needs', amount: 0 },
      { kind: 'empty-bucket', bucket: 'wants', amount: 0 },
    ]);
  });
});

describe('10.2 the empty-bucket alert comes once per bucket per pay period', () => {
  it('10.2 asking again in the same pay period does not repeat it, but other alerts still come', () => {
    const b = book({ pots: { needs: 0, wants: 10_000 } });
    b.receive(purchase('e1', '2026-10-05', 100, 'MADE UP STORE'));
    expect(b.takeAlerts(fine(b))).toEqual([
      { kind: 'empty-bucket', bucket: 'needs', amount: 0 },
      { kind: 'daily-review', at: '20:00', waiting: 1 },
    ]);
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'daily-review', at: '20:00', waiting: 1 }]);
  });

  it('10.2 a new pay period with the bucket still empty alerts again', () => {
    const b = book({ pots: { needs: 10_000, wants: -60_000 }, settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } });
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'empty-bucket', bucket: 'wants', amount: -60_000 }]);
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'empty-bucket', bucket: 'wants', amount: -10_000 }]);
    expect(b.takeAlerts(fine(b))).toEqual([]);
  });

  it('10.2 refilled and emptied again in the same pay period: still only once', () => {
    const b = book({ pots: { needs: 0, wants: 10_000 } });
    expect(b.takeAlerts(fine(b))).toHaveLength(1);
    b.moveMoney({ from: 'wants', to: 'needs', amount: 5_000 }, '2026-10-05');
    b.moveMoney({ from: 'needs', to: 'wants', amount: 5_000 }, '2026-10-06');
    expect(b.pots().needs).toBe(0);
    expect(b.takeAlerts(fine(b))).toEqual([]);
  });

  it('10.2 needs and wants are counted separately', () => {
    const b = book({ pots: { needs: 0, wants: 10_000 } });
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'empty-bucket', bucket: 'needs', amount: 0 }]);
    b.moveMoney({ from: 'wants', to: 'needs', amount: 10_000 }, '2026-10-05');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'empty-bucket', bucket: 'wants', amount: 0 }]);
  });

  it('10.2 a bucket that is not empty yet is not marked: it alerts when it does empty', () => {
    const b = book({ pots: { needs: 1, wants: 10_000 } });
    expect(b.takeAlerts(fine(b))).toEqual([]);
    b.moveMoney({ from: 'needs', to: 'wants', amount: 1 }, '2026-10-05');
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'empty-bucket', bucket: 'needs', amount: 0 }]);
  });

  it('10.2 bank balances that are not whole cents are refused, and nothing is marked as sent', () => {
    const b = book({ pots: { needs: 0, wants: 10_000 } });
    expect(() => b.takeAlerts({ bankConnection: 'ok', bankBalances: { checking: 0.5, savings: 0, everydayCard: 0 } })).toThrow();
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'empty-bucket', bucket: 'needs', amount: 0 }]);
  });
});

describe('10.3 daily review: at the review time, only if something is unsorted', () => {
  it('10.3 nothing waiting means no daily review alert', () => {
    const b = book();
    expect(b.takeAlerts(fine(b))).toEqual([]);
  });

  it('10.3 something waiting in review: the alert, at the review time, with how many', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-05', 100, 'MADE UP STORE'));
    b.receive(purchase('e2', '2026-10-05', 100, 'MADE UP STORE'));
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'daily-review', at: '20:00', waiting: 2 }]);
  });

  it('10.3 a leftover question and an old card flag count as waiting too', () => {
    const b = book({ pots: { needs: 10_000, wants: 10_000 } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(purchase('o1', '2026-10-10', 100, 'MADE UP STORE', { account: 'old-card' }));
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'daily-review', at: '20:00', waiting: 3 }]);
  });

  it('10.3 the review time is a setting', () => {
    const b = book({ settings: { dailyReviewTime: '21:15' } });
    b.receive(purchase('e1', '2026-10-05', 100, 'MADE UP STORE'));
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'daily-review', at: '21:15', waiting: 1 }]);
  });
});

describe('10.5 the bank connection needs you to log in again', () => {
  it('10.5 the alert shows when the bank connection asks for a new login', () => {
    const b = book();
    expect(b.takeAlerts({ ...fine(b), bankConnection: 'needs-login' })).toEqual([{ kind: 'bank-login' }]);
  });

  it('10.5 no alert while the connection is fine', () => {
    const b = book();
    expect(b.takeAlerts(fine(b))).toEqual([]);
  });
});
