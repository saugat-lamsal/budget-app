import { describe, expect, it } from 'vitest';
import type { SortingRule } from '../src/index.js';
import { codeOf, deposit, openTestBook, paycheck, refund, type TestBookOptions } from './helpers.js';

function book(options: TestBookOptions = {}) {
  return openTestBook({ pots: { savings: 10_000, needs: 20_000, wants: 30_000, momReserve: 40_000, heldForOthers: 0 }, ...options });
}

const START = { savings: 10_000, needs: 20_000, wants: 30_000, momReserve: 40_000, heldForOthers: 0, unsortedIn: 0, unsortedOut: 0 };

describe('6.1 deposits that are not a paycheck go to review: income, payback, or not mine', () => {
  it('6.1 a deposit always waits in review first, as unsorted money in', () => {
    const b = book();
    expect(b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP TAX REFUND')).outcome).toBe('review');
    expect(b.pots()).toEqual({ ...START, unsortedIn: 25_000 });
    expect(b.reviewItems()).toEqual([{ type: 'money-in', id: 'd1', date: '2026-10-05', amount: 25_000, description: 'MADE UP TAX REFUND', reason: 'deposit' }]);
  });

  it('6.1 income is treated like a paycheck: the mom reserve first, then the split', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'income' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, momReserve: 190_000, savings: 135_000, needs: 95_000, wants: 80_000 });
    expect(b.reviewItems()).toEqual([]);
  });

  it('6.1 income fills the mom reserve only up to its cap; the rest of the reserve goes to savings', () => {
    const b = book({ pots: { momReserve: 290_000 } });
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'income' }, '2026-10-06');
    expect(b.pots()).toMatchObject({ momReserve: 300_000, savings: 140_000 + 125_000, needs: 75_000, wants: 50_000 });
  });

  it('6.1 one cent of income goes to the mom reserve', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 1, 'MADE UP INTEREST'));
    b.sort('d1', { to: 'income' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, momReserve: 40_001 });
  });

  it('6.1 income does not start a new pay period or move the pay schedule', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'income' }, '2026-10-06');
    expect(b.period().number).toBe(0);
    expect(b.lastPaycheckDate()).toBe('2026-09-25');
    expect(b.paychecks()).toEqual([]);
  });

  it('6.1 an early paycheck from review (3.7) sorted as income is split like a paycheck', () => {
    const b = book({ lastPaycheckDate: '2026-10-01' });
    b.receive(paycheck('p1', '2026-10-05', 400_000));
    b.sort('p1', { to: 'income' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, momReserve: 190_000, savings: 135_000, needs: 95_000, wants: 80_000 });
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

  it('6.1 a deposit into savings has the same three choices', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 321, 'MADE UP INTEREST', 'savings'));
    b.sort('d1', { to: 'savings' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, savings: 10_321 });
  });

  it('6.1 only the three choices are accepted', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 6_000, 'MADE UP ROOMMATE'));
    for (const choice of [{ to: 'unsorted' }, { to: 'nope' }, { split: [{ bucket: 'needs', amount: 6_000 }] }]) {
      expect(codeOf(() => b.sort('d1', choice as never, '2026-10-06')), JSON.stringify(choice)).toBe('bad-choice');
    }
    expect(b.pots()).toEqual({ ...START, unsortedIn: 6_000 });
  });

  it('6.1 a store refund in review can be payback or not mine, but not income', () => {
    const b = book();
    b.receive(refund('r1', '2026-10-05', 500));
    expect(codeOf(() => b.sort('r1', { to: 'income' }, '2026-10-06'))).toBe('bad-choice');
    b.sort('r1', { to: 'not-mine' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, heldForOthers: 500 });
  });

  it('6.1 changing your mind undoes the old choice exactly', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 400_001, 'MADE UP BONUS'));
    b.sort('d1', { to: 'income' }, '2026-10-06');
    b.sort('d1', { to: 'not-mine' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, heldForOthers: 400_001 });
    b.sort('d1', { to: 'income' }, '2026-10-08');
    b.sort('d1', { to: 'wants' }, '2026-10-09');
    expect(b.pots()).toEqual({ ...START, wants: 430_001 });
  });

  it('6.1 changing an income choice to income again works out the reserve without counting itself', () => {
    const b = book({ pots: { momReserve: 150_000 } });
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'income' }, '2026-10-06');
    b.sort('d1', { to: 'income' }, '2026-10-07');
    expect(b.pots().momReserve).toBe(300_000);
  });
});

describe('6.2 a rule can make the choice automatic for a known source', () => {
  const rules: SortingRule[] = [
    { id: 'bonus', for: 'deposit', contains: 'BONUS', choice: { to: 'income' } },
    { id: 'friend', for: 'deposit', contains: 'MADE UP FRIEND', choice: { to: 'wants' } },
    { id: 'roommate', for: 'deposit', contains: 'ROOMMATE', choice: { to: 'not-mine' } },
    { id: 'shop', for: 'purchase', contains: 'FRIEND', bucket: 'needs' },
  ];

  it('6.2 a deposit rule sorts the deposit right away, with no review', () => {
    const b = book({ rules });
    expect(b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP BONUS')).outcome).toBe('sorted');
    expect(b.receive(deposit('d2', '2026-10-05', 2_500, 'MADE UP FRIEND ZELLE')).outcome).toBe('sorted');
    expect(b.receive(deposit('d3', '2026-10-05', 6_000, 'made up roommate')).outcome).toBe('sorted');
    expect(b.pots()).toEqual({ ...START, momReserve: 190_000, savings: 135_000, needs: 95_000, wants: 82_500, heldForOthers: 6_000 });
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

  it('6.2 a deposit rule must pick one of the three choices', () => {
    for (const choice of [{ to: 'unsorted' }, { to: 'nope' }, { split: [] }]) {
      expect(codeOf(() => book({ rules: [{ id: 'x', for: 'deposit', contains: 'A', choice } as never] })), JSON.stringify(choice)).toBe('bad-rule');
    }
  });
});
