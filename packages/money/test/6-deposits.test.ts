import { describe, expect, it } from 'vitest';
import type { SortingRule } from '../src/index.js';
import { codeOf, deposit, openTestBook, paycheck, refund, type TestBookOptions } from './helpers.js';

function book(options: TestBookOptions = {}) {
  return openTestBook({ pots: { savings: 10_000, needs: 20_000, wants: 30_000, momReserve: 40_000, heldForOthers: 0 }, ...options });
}

const START = { savings: 10_000, needs: 20_000, wants: 30_000, momReserve: 40_000, heldForOthers: 0, unsortedIn: 0, unsortedOut: 0 };

const MAX = Number.MAX_SAFE_INTEGER;

describe('6.1 deposits that are not a paycheck go to review: my paycheck, other income, payback, or not mine', () => {
  it('6.1 a deposit always waits in review first, as unsorted money in', () => {
    const b = book();
    expect(b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP TAX REFUND')).outcome).toBe('review');
    expect(b.pots()).toEqual({ ...START, unsortedIn: 25_000 });
    expect(b.reviewItems()).toEqual([{ type: 'money-in', id: 'd1', date: '2026-10-05', amount: 25_000, description: 'MADE UP TAX REFUND', reason: 'deposit' }]);
  });

  it('6.1 other income is split by the percentages only: no mom reserve is taken', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'other-income' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, savings: 210_000, needs: 140_000, wants: 110_000 });
    expect(b.reviewItems()).toEqual([]);
  });

  it('6.1 other income takes no reserve even when the reserve is empty', () => {
    const b = book({ pots: { momReserve: 0 } });
    b.receive(deposit('d1', '2026-10-05', 20_000, 'MADE UP SIDE JOB'));
    b.sort('d1', { to: 'other-income' }, '2026-10-06');
    expect(b.pots()).toEqual({ savings: 10_000, needs: 6_000, wants: 4_000, momReserve: 0, heldForOthers: 0, unsortedIn: 0, unsortedOut: 0 });
  });

  it('6.1 other income: cents left over from rounding go to savings, so the parts add up exactly', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 7, 'MADE UP INTEREST'));
    b.sort('d1', { to: 'other-income' }, '2026-10-06');
    // 50% of 7 is 3, 30% is 2, 20% is 1, and the 1 cent left goes to savings.
    expect(b.pots()).toEqual({ ...START, savings: 10_004, needs: 20_002, wants: 30_001 });
    b.receive(deposit('d2', '2026-10-05', 1, 'MADE UP INTEREST'));
    b.sort('d2', { to: 'other-income' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, savings: 10_005, needs: 20_002, wants: 30_001 });
  });

  it('6.1 other income does not start a new pay period or move the pay schedule', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'other-income' }, '2026-10-06');
    expect(b.period()).toEqual({ number: 0, startDate: '2026-10-01' });
    expect(b.lastPaycheckDate()).toBe('2026-09-25');
    expect(b.paychecks()).toEqual([]);
  });

  it('6.1 this is my paycheck: a new pay period, the mom reserve first, then the split', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP NEW JOB'));
    b.sort('d1', { to: 'paycheck' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, momReserve: 190_000, savings: 135_000, needs: 95_000, wants: 80_000 });
    // The pay period starts on the day the money arrived, and so does the pay schedule.
    expect(b.period()).toEqual({ number: 1, startDate: '2026-10-05' });
    expect(b.lastPaycheckDate()).toBe('2026-10-05');
    expect(b.paychecks()).toMatchObject([{ id: 'd1', date: '2026-10-05', amount: 400_000, split: { momReserve: 150_000, needs: 75_000 } }]);
    expect(b.safeToSpend('2026-10-06')).toMatchObject({ nextPayday: '2026-10-19', daysToPayday: 13 });
  });

  it('6.1 this is my paycheck asks the leftover question for the pay period it closes (3.4)', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP NEW JOB'));
    b.sort('d1', { to: 'paycheck' }, '2026-10-06');
    expect(b.reviewItems()).toEqual([
      { type: 'leftover', id: 'leftover:d1:needs', date: '2026-10-05', bucket: 'needs', amount: 20_000, atPayday: 20_000, lessSincePayday: 0 },
      { type: 'leftover', id: 'leftover:d1:wants', date: '2026-10-05', bucket: 'wants', amount: 30_000, atPayday: 30_000, lessSincePayday: 0 },
    ]);
  });

  it('6.1 one cent as your paycheck goes to the mom reserve, like any paycheck smaller than the reserve', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 1, 'MADE UP NEW JOB'));
    b.sort('d1', { to: 'paycheck' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, momReserve: 40_001 });
    expect(b.period().number).toBe(1);
  });

  it('6.1 your paycheck fills the mom reserve only up to its cap; the rest of the reserve goes to savings', () => {
    const b = book({ pots: { momReserve: 290_000 } });
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP NEW JOB'));
    b.sort('d1', { to: 'paycheck' }, '2026-10-06');
    expect(b.pots()).toMatchObject({ momReserve: 300_000, savings: 140_000 + 125_000, needs: 75_000, wants: 50_000 });
  });

  it('6.1 an early paycheck (3.7) you call your paycheck restarts the pay schedule and the 10-day count', () => {
    const b = book({ lastPaycheckDate: '2026-10-01' });
    expect(b.receive(paycheck('p1', '2026-10-05', 400_000)).outcome).toBe('review');
    expect(b.reviewItems()).toMatchObject([{ id: 'p1', reason: 'early-paycheck' }]);
    b.sort('p1', { to: 'paycheck' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, momReserve: 190_000, savings: 135_000, needs: 95_000, wants: 80_000 });
    expect(b.lastPaycheckDate()).toBe('2026-10-05');
    // 9 days after it is too soon again; 10 days after is a paycheck.
    expect(b.receive(paycheck('p2', '2026-10-14', 400_000)).outcome).toBe('review');
    expect(b.receive(paycheck('p3', '2026-10-15', 400_000)).outcome).toBe('paycheck');
    expect(b.period().number).toBe(2);
  });

  it('6.1 an early paycheck can be other income instead: split, no reserve, schedule unchanged', () => {
    const b = book({ lastPaycheckDate: '2026-10-01' });
    b.receive(paycheck('p1', '2026-10-05', 400_000));
    b.sort('p1', { to: 'other-income' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, savings: 210_000, needs: 140_000, wants: 110_000 });
    expect(b.lastPaycheckDate()).toBe('2026-10-01');
    expect(b.period().number).toBe(0);
  });

  it('6.1 a deposit already sorted another way can still be made your paycheck; the earlier choice is undone', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP NEW JOB'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-06');
    b.sort('d1', { to: 'paycheck' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, momReserve: 190_000, savings: 135_000, needs: 95_000, wants: 80_000 });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('6.1 a deposit already sorted as other income can be made your paycheck', () => {
    const b = book({ settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } });
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP NEW JOB'));
    b.sort('d1', { to: 'other-income' }, '2026-10-06');
    b.sort('d1', { to: 'paycheck' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, momReserve: 190_000, savings: 135_000, needs: 95_000, wants: 80_000 });
    expect(b.reviewItems()).toEqual([]);
  });

  it('6.1 once it is your paycheck it is final, like any paycheck', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP NEW JOB'));
    b.sort('d1', { to: 'paycheck' }, '2026-10-06');
    const after = b.pots();
    for (const to of ['paycheck', 'other-income', 'wants', 'not-mine'] as const) {
      expect(codeOf(() => b.sort('d1', { to }, '2026-10-07')), to).toBe('not-sortable');
    }
    expect(b.pots()).toEqual(after);
    expect(b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP NEW JOB')).outcome).toBe('duplicate');
  });

  it('6.1 a deposit older than the last paycheck cannot start a new pay period, and keeps waiting', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP NEW JOB'));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const before = { pots: b.pots(), review: b.reviewItems(), period: b.period() };
    expect(codeOf(() => b.sort('d1', { to: 'paycheck' }, '2026-10-10'))).toBe('bad-choice');
    expect({ pots: b.pots(), review: b.reviewItems(), period: b.period() }).toEqual(before);
    b.sort('d1', { to: 'other-income' }, '2026-10-10');
    expect(b.reviewItems().map((i) => i.id)).not.toContain('d1');
  });

  it('6.1 a deposit on the same day as the last paycheck can be your paycheck too', () => {
    const b = book({ settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(deposit('d1', '2026-10-09', 100_000, 'MADE UP SECOND JOB'));
    b.sort('d1', { to: 'paycheck' }, '2026-10-10');
    expect(b.period()).toEqual({ number: 2, startDate: '2026-10-09' });
    expect(b.paychecks().map((p) => p.id)).toEqual(['p1', 'd1']);
  });

  it('6.1 a paycheck from review too large to stay exact is refused, and the deposit keeps waiting', () => {
    const b = book({ pots: { savings: MAX - 100_000 } });
    b.receive(deposit('d1', '2026-10-05', 1_000_000, 'MADE UP NEW JOB'));
    const before = { pots: b.pots(), review: b.reviewItems(), period: b.period(), paychecks: b.paychecks() };
    expect(codeOf(() => b.sort('d1', { to: 'paycheck' }, '2026-10-06'))).toBe('not-cents');
    expect({ pots: b.pots(), review: b.reviewItems(), period: b.period(), paychecks: b.paychecks() }).toEqual(before);
    expect(b.recountPots()).toEqual(b.pots());
    b.sort('d1', { to: 'not-mine' }, '2026-10-06');
    expect(b.pots().heldForOthers).toBe(1_000_000);
  });

  it('6.1 making a sorted deposit your paycheck takes its earlier choice back before checking the totals fit', () => {
    // Wants is near the limit only because of the deposit's own payback.
    const b = book({ pots: { wants: MAX - 1_000_010 }, settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } });
    b.receive(deposit('d1', '2026-10-05', 1_000_000, 'MADE UP NEW JOB'));
    b.sort('d1', { to: 'wants' }, '2026-10-06');
    b.sort('d1', { to: 'paycheck' }, '2026-10-07');
    expect(b.pots().wants).toBe(MAX - 1_000_010 + 170_000);
  });

  it('6.1 payback goes into the bucket you pick', () => {
    const b = book();
    for (const [n, to] of (['savings', 'needs', 'wants', 'momReserve'] as const).entries()) {
      b.receive(deposit(`d${n}`, '2026-10-05', 1_000, 'MADE UP FRIEND'));
      b.sort(`d${n}`, { to }, '2026-10-06');
    }
    expect(b.pots()).toEqual({ ...START, savings: 11_000, needs: 21_000, wants: 31_000, momReserve: 41_000 });
  });

  it('6.1 not mine goes to held for others', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 6_000, 'MADE UP ROOMMATE'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, heldForOthers: 6_000 });
  });

  it('6.1 a deposit into savings has the same choices', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 321, 'MADE UP INTEREST', 'savings'));
    b.sort('d1', { to: 'savings' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, savings: 10_321 });
  });

  it('6.1 only the listed choices are accepted', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 6_000, 'MADE UP ROOMMATE'));
    for (const choice of [{ to: 'income' }, { to: 'unsorted' }, { to: 'nope' }, { split: [{ bucket: 'needs', amount: 6_000 }] }]) {
      expect(codeOf(() => b.sort('d1', choice as never, '2026-10-06')), JSON.stringify(choice)).toBe('bad-choice');
    }
    expect(b.pots()).toEqual({ ...START, unsortedIn: 6_000 });
  });

  it('6.1 a store refund in review can be payback or not mine, but neither kind of income', () => {
    const b = book();
    b.receive(refund('r1', '2026-10-05', 500));
    expect(codeOf(() => b.sort('r1', { to: 'paycheck' }, '2026-10-06'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('r1', { to: 'other-income' }, '2026-10-06'))).toBe('bad-choice');
    expect(b.pots()).toEqual({ ...START, unsortedIn: 500 });
    b.sort('r1', { to: 'not-mine' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, heldForOthers: 500 });
  });

  it('6.1 changing your mind undoes the old choice exactly', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_001, 'MADE UP BONUS'));
    b.sort('d1', { to: 'other-income' }, '2026-10-06');
    b.sort('d1', { to: 'not-mine' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, heldForOthers: 400_001 });
    b.sort('d1', { to: 'other-income' }, '2026-10-08');
    b.sort('d1', { to: 'other-income' }, '2026-10-08');
    expect(b.pots()).toEqual({ ...START, savings: 210_001, needs: 140_000, wants: 110_000 });
    b.sort('d1', { to: 'wants' }, '2026-10-09');
    expect(b.pots()).toEqual({ ...START, wants: 430_001 });
  });
});

describe('6.2 a rule can make the choice automatic for a known source', () => {
  const rules: SortingRule[] = [
    { id: 'bonus', for: 'deposit', contains: 'BONUS', choice: { to: 'other-income' } },
    { id: 'friend', for: 'deposit', contains: 'MADE UP FRIEND', choice: { to: 'wants' } },
    { id: 'roommate', for: 'deposit', contains: 'ROOMMATE', choice: { to: 'not-mine' } },
    { id: 'shop', for: 'purchase', contains: 'FRIEND', bucket: 'needs' },
  ];

  it('6.2 a deposit rule sorts the deposit right away, with no review', () => {
    const b = book({ rules });
    expect(b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP BONUS')).outcome).toBe('sorted');
    expect(b.receive(deposit('d2', '2026-10-05', 2_500, 'MADE UP FRIEND ZELLE')).outcome).toBe('sorted');
    expect(b.receive(deposit('d3', '2026-10-05', 6_000, 'made up roommate')).outcome).toBe('sorted');
    expect(b.pots()).toEqual({ ...START, savings: 210_000, needs: 140_000, wants: 112_500, heldForOthers: 6_000 });
    expect(b.reviewItems()).toEqual([]);
  });

  it('6.2 the first matching deposit rule wins, and purchase rules never apply to deposits', () => {
    const b = book({ rules: [{ id: 'a', for: 'deposit', contains: 'MADE UP', choice: { to: 'savings' } }, ...rules] });
    b.receive(deposit('d1', '2026-10-05', 2_500, 'MADE UP FRIEND ZELLE'));
    expect(b.pots()).toEqual({ ...START, savings: 12_500 });
    const onlyPurchaseRule = book({ rules: [{ id: 'shop', for: 'purchase', contains: 'FRIEND', bucket: 'needs' }] });
    expect(onlyPurchaseRule.receive(deposit('d1', '2026-10-05', 2_500, 'MADE UP FRIEND ZELLE')).outcome).toBe('review');
  });

  it('6.2 a deposit rule never applies to a paycheck, early or not', () => {
    const everything: SortingRule[] = [{ id: 'all', for: 'deposit', contains: 'ACME', choice: { to: 'not-mine' } }];
    const b = book({ rules: everything, lastPaycheckDate: '2026-10-01' });
    expect(b.receive(paycheck('p1', '2026-10-05', 400_000)).outcome).toBe('review');
    expect(b.receive(paycheck('p2', '2026-10-11', 400_000)).outcome).toBe('paycheck');
    expect(b.pots().heldForOthers).toBe(0);
  });

  it('6.2 a refund the app cannot match is not a deposit, so deposit rules do not apply', () => {
    const b = book({ rules: [{ id: 'all', for: 'deposit', contains: 'REFUND', choice: { to: 'wants' } }] });
    expect(b.receive(refund('r1', '2026-10-05', 500)).outcome).toBe('review');
  });

  it('6.2 a deposit rule must pick other income, a bucket, or not mine', () => {
    for (const choice of [{ to: 'income' }, { to: 'unsorted' }, { to: 'nope' }, { split: [] }]) {
      expect(codeOf(() => book({ rules: [{ id: 'x', for: 'deposit', contains: 'A', choice } as never] })), JSON.stringify(choice)).toBe('bad-rule');
    }
  });

  it('6.2 a deposit rule cannot say "this is my paycheck": the paycheck rule in settings does that, with its 10-day check (3.7)', () => {
    expect(codeOf(() => book({ rules: [{ id: 'x', for: 'deposit', contains: 'NEW JOB', choice: { to: 'paycheck' } } as never] }))).toBe('bad-rule');
    const b = book();
    expect(codeOf(() => b.addRule({ id: 'x', for: 'deposit', contains: 'NEW JOB', choice: { to: 'paycheck' } } as never, '2026-10-05'))).toBe('bad-rule');
    expect(b.rules()).toEqual([]);
  });
});
