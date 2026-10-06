import { describe, expect, it } from 'vitest';
import type { SortingRule } from '../src/index.js';
import { codeOf, deposit, openTestBook, payPerson, purchase, type TestBookOptions } from './helpers.js';

function book(options: TestBookOptions = {}) {
  return openTestBook({ pots: { savings: 10_000, needs: 20_000, wants: 30_000, momReserve: 40_000, heldForOthers: 0 }, ...options });
}

const START = { savings: 10_000, needs: 20_000, wants: 30_000, momReserve: 40_000, heldForOthers: 0, unsortedIn: 0, unsortedOut: 0 };

describe('7.1 a deposit marked "not mine" adds to held for others', () => {
  it('7.1 it is not income and is not split', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 6_000, 'MADE UP ROOMMATE'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-05');
    expect(b.pots()).toEqual({ ...START, heldForOthers: 6_000 });
  });

  it('7.1 one cent and very large amounts', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 1, 'MADE UP ROOMMATE'));
    b.receive(deposit('d2', '2026-10-05', 5_000_000_000_000_000, 'MADE UP ROOMMATE'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-05');
    b.sort('d2', { to: 'not-mine' }, '2026-10-05');
    expect(b.pots().heldForOthers).toBe(5_000_000_000_000_001);
  });
});

describe('7.2 a payment out marked "not mine" lowers held for others', () => {
  it('7.2 it is not spending: no bucket changes', () => {
    const b = book({ pots: { heldForOthers: 6_000 } });
    b.receive(payPerson('z1', '2026-10-06', 6_000, 'MADE UP LANDLORD'));
    b.sort('z1', { to: 'not-mine' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 });
  });

  it('7.2 changing a payment from wants to not mine gives wants its money back', () => {
    const b = book({ pots: { wants: 30_000, heldForOthers: 6_000 } });
    b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP LANDLORD'));
    b.sort('z1', { to: 'wants' }, '2026-10-06');
    expect(b.pots()).toMatchObject({ wants: 27_500, heldForOthers: 6_000 });
    b.sort('z1', { to: 'not-mine' }, '2026-10-07');
    expect(b.pots()).toMatchObject({ wants: 30_000, heldForOthers: 3_500 });
  });
});

describe('7.3 held for others is its own number, should return to zero; negative means someone owes you', () => {
  it('7.3 zero means settled', () => {
    expect(book().othersMoney()).toEqual({ heldForOthers: 0, meaning: 'settled' });
  });

  it('7.3 money in and the same money out brings it back to zero', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 6_000, 'MADE UP ROOMMATE'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-05');
    expect(b.othersMoney()).toEqual({ heldForOthers: 6_000, meaning: 'holding-for-others' });
    b.receive(payPerson('z1', '2026-10-06', 6_000, 'MADE UP UTILITY CO'));
    b.sort('z1', { to: 'not-mine' }, '2026-10-06');
    expect(b.othersMoney()).toEqual({ heldForOthers: 0, meaning: 'settled' });
  });

  it('7.3 paying for someone before they pay you makes it negative: they owe you', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 1, 'MADE UP UTILITY CO'));
    b.sort('z1', { to: 'not-mine' }, '2026-10-06');
    expect(b.othersMoney()).toEqual({ heldForOthers: -1, meaning: 'owed-to-you' });
    expect(b.pots()).toEqual({ ...START, heldForOthers: -1 });
  });
});

describe('7.4 payments to people go to the daily review unless there is a rule for that person', () => {
  it('7.4 with no rule, a payment to a person waits in review as unsorted spending', () => {
    const b = book();
    expect(b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP FRIEND')).outcome).toBe('review');
    expect(b.pots()).toEqual({ ...START, unsortedOut: 2_500 });
    expect(b.reviewItems()).toEqual([
      { type: 'spending', id: 'z1', date: '2026-10-06', amount: 2_500, description: 'ZELLE TO MADE UP FRIEND', reason: 'person-payment', suggestion: null },
    ]);
  });

  it('7.4 a rule for that person sorts it right away, ignoring upper and lower case', () => {
    const rules: SortingRule[] = [
      { id: 'landlord', for: 'person', contains: 'made up landlord', choice: { to: 'needs' } },
      { id: 'roommate', for: 'person', contains: 'MADE UP ROOMMATE', choice: { to: 'not-mine' } },
    ];
    const b = book({ rules });
    expect(b.receive(payPerson('z1', '2026-10-06', 150_000, 'MADE UP LANDLORD')).outcome).toBe('sorted');
    expect(b.receive(payPerson('z2', '2026-10-06', 2_000, 'MADE UP ROOMMATE')).outcome).toBe('sorted');
    expect(b.pots()).toEqual({ ...START, needs: 20_000 - 150_000, heldForOthers: -2_000 });
    expect(b.reviewItems()).toEqual([]);
  });

  it('7.4 person rules never apply to purchases, and purchase rules never apply to people', () => {
    const rules: SortingRule[] = [
      { id: 'friend-purchase', for: 'purchase', contains: 'FRIEND', bucket: 'wants' },
      { id: 'cafe-person', for: 'person', contains: 'CAFE', choice: { to: 'needs' } },
    ];
    const b = book({ rules });
    expect(b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP FRIEND')).outcome).toBe('review');
    expect(b.receive(purchase('e1', '2026-10-06', 500, 'MADE UP CAFE')).outcome).toBe('review');
  });

  it('7.4 a payment to a person can be sorted to needs, wants, or not mine, and nothing else', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 2_500, 'MADE UP FRIEND'));
    for (const choice of [{ to: 'savings' }, { to: 'income' }, { to: 'momReserve' }, { split: [{ bucket: 'needs', amount: 2_500 }] }]) {
      expect(codeOf(() => b.sort('z1', choice as never, '2026-10-07')), JSON.stringify(choice)).toBe('bad-choice');
    }
    b.sort('z1', { to: 'needs' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, needs: 17_500 });
  });

  it('7.4 a person rule must pick needs, wants, or not mine', () => {
    for (const choice of [{ to: 'savings' }, { to: 'income' }, { to: 'unsorted' }]) {
      expect(codeOf(() => book({ rules: [{ id: 'x', for: 'person', contains: 'A', choice } as never] })), JSON.stringify(choice)).toBe('bad-rule');
    }
  });

  it('7.4 a payment to a person comes from checking', () => {
    const b = book();
    expect(codeOf(() => b.receive({ ...payPerson('z1', '2026-10-06', 2_500, 'MADE UP FRIEND'), account: 'savings' } as never))).toBe('bad-transaction');
  });
});

describe('7.5 a friend paying you back is a payback', () => {
  it('7.5 it goes into the bucket you pick, not held for others', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-06', 4_000, 'MADE UP FRIEND'));
    b.sort('z1', { to: 'wants' }, '2026-10-06');
    b.receive(deposit('d1', '2026-10-08', 2_000, 'ZELLE FROM MADE UP FRIEND'));
    b.sort('d1', { to: 'wants' }, '2026-10-08');
    expect(b.pots()).toEqual({ ...START, wants: 28_000 });
    expect(b.othersMoney().meaning).toBe('settled');
  });
});
