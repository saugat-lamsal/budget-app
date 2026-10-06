// Second opinion, rulebook section 4 (spending). Starting pots:
// savings 5,000.00, needs 1,000.00, wants 500.00.

import { describe, expect, it } from 'vitest';
import { MoneyError, type SortingRule } from '../src/index.js';
import { Life } from './helpers.js';

const RULES: SortingRule[] = [
  { id: 'r-grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
  { id: 'r-cinema', for: 'purchase', contains: 'CINEMA', bucket: 'wants' },
];

describe('4.1 a card purchase comes out of a bucket', () => {
  it('4.1 everyday card purchase comes out of needs', () => {
    // needs 1,000.00 - 40.00 = 960.00
    const life = new Life({ rules: RULES });
    life.buy(4000, '2026-01-06', 'CITY GROCER');
    expect(life.book.pots()).toMatchObject({ needs: 96000, wants: 50000, unsortedOut: 0 });
    life.expectBalanced();
  });

  it('4.1 debit card purchase comes out of wants', () => {
    // wants 500.00 - 12.00 = 488.00
    const life = new Life({ rules: RULES });
    life.buy(1200, '2026-01-06', 'CINEMA 8', { account: 'checking' });
    expect(life.book.pots()).toMatchObject({ needs: 100000, wants: 48800 });
    life.expectBalanced();
  });

  it('4.1 one-cent purchase', () => {
    const life = new Life({ rules: RULES });
    life.buy(1, '2026-01-06', 'CITY GROCER');
    expect(life.book.pots().needs).toBe(99999);
    life.expectBalanced();
  });

  it('4.1 a purchase bigger than the bucket takes it negative', () => {
    // needs 1,000.00 - 1,000,000.00 = -999,000.00
    const life = new Life({ rules: RULES });
    life.buy(100000000, '2026-01-06', 'CITY GROCER');
    expect(life.book.pots().needs).toBe(-99900000);
    life.expectBalanced();
  });
});

describe('4.2 no matching rule means unsorted', () => {
  it('4.2 unmatched purchase is unsorted and waits in review', () => {
    const life = new Life({ rules: RULES });
    const r = life.buy(2550, '2026-01-06', 'MYSTERY SHOP');
    expect(life.book.pots()).toMatchObject({ needs: 100000, wants: 50000, unsortedOut: 2550 });
    const item = life.book.reviewItems().find((i) => i.id === r.id);
    expect(item).toMatchObject({ type: 'spending', reason: 'no-rule', amount: 2550 });
    life.expectBalanced();
  });
});

describe('4.3 unsorted spending is held back from safe to spend', () => {
  it('4.3 safe to spend drops by the unsorted amount until sorted', () => {
    // wants 500.00 - unsorted 25.50 = 474.50
    const life = new Life({ rules: RULES });
    const r = life.buy(2550, '2026-01-06', 'MYSTERY SHOP');
    expect(life.book.safeToSpend('2026-01-06').amount).toBe(47450);
    // sorted to needs: wants 500.00 - 0 = 500.00
    life.book.sort(r.id, { to: 'needs' }, '2026-01-06');
    expect(life.book.safeToSpend('2026-01-06').amount).toBe(50000);
    expect(life.book.pots()).toMatchObject({ needs: 97450, unsortedOut: 0 });
    life.expectBalanced();
  });
});

describe('4.4 a purchase can be split across buckets', () => {
  it('4.4 split 60.00 needs + 40.00 wants', () => {
    // needs 1,000 - 60 = 940.00; wants 500 - 40 = 460.00
    const life = new Life({ rules: RULES });
    const r = life.buy(10000, '2026-01-06', 'BIG STORE');
    life.book.sort(r.id, { split: [{ bucket: 'needs', amount: 6000 }, { bucket: 'wants', amount: 4000 }] }, '2026-01-06');
    expect(life.book.pots()).toMatchObject({ needs: 94000, wants: 46000, unsortedOut: 0 });
    life.expectBalanced();
  });

  it('4.4 parts one cent short are refused and nothing changes', () => {
    const life = new Life({ rules: RULES });
    const r = life.buy(10000, '2026-01-06', 'BIG STORE');
    const before = life.book.pots();
    expect(() =>
      life.book.sort(r.id, { split: [{ bucket: 'needs', amount: 6000 }, { bucket: 'wants', amount: 3999 }] }, '2026-01-06'),
    ).toThrow(MoneyError);
    expect(life.book.pots()).toEqual(before);
  });

  it('4.4 parts one cent over are refused', () => {
    const life = new Life({ rules: RULES });
    const r = life.buy(10000, '2026-01-06', 'BIG STORE');
    expect(() =>
      life.book.sort(r.id, { split: [{ bucket: 'needs', amount: 6001 }, { bucket: 'wants', amount: 4000 }] }, '2026-01-06'),
    ).toThrow(MoneyError);
  });
});

describe('4.5 a refund goes back to the bucket the purchase came from', () => {
  it('4.5 matched refund returns to needs', () => {
    // needs 1,000 - 40 + 40 = 1,000.00
    const life = new Life({ rules: RULES });
    const p = life.buy(4000, '2026-01-06', 'CITY GROCER');
    life.refund(4000, '2026-01-08', 'CITY GROCER REFUND', p.id);
    expect(life.book.pots()).toMatchObject({ needs: 100000, unsortedIn: 0 });
    life.expectBalanced();
  });

  it('4.5 partial refund', () => {
    // needs 1,000 - 40 + 10 = 970.00
    const life = new Life({ rules: RULES });
    const p = life.buy(4000, '2026-01-06', 'CITY GROCER');
    life.refund(1000, '2026-01-08', 'CITY GROCER REFUND', p.id);
    expect(life.book.pots().needs).toBe(97000);
    life.expectBalanced();
  });

  it('4.5 refund follows a purchase that was re-sorted', () => {
    // purchase 40.00 to needs, re-sorted to wants: wants 460.00; refund -> wants 500.00
    const life = new Life({ rules: RULES });
    const p = life.buy(4000, '2026-01-06', 'CITY GROCER');
    life.book.sort(p.id, { to: 'wants' }, '2026-01-06');
    life.refund(4000, '2026-01-08', 'CITY GROCER REFUND', p.id);
    expect(life.book.pots()).toMatchObject({ needs: 100000, wants: 50000 });
    life.expectBalanced();
  });

  it('4.5 unmatched refund goes to review as unsorted money in', () => {
    const life = new Life({ rules: RULES });
    const r = life.refund(1999, '2026-01-08', 'SOME REFUND');
    expect(life.book.pots()).toMatchObject({ needs: 100000, wants: 50000, unsortedIn: 1999 });
    expect(life.book.reviewItems().find((i) => i.id === r.id)).toMatchObject({ type: 'money-in', reason: 'refund' });
    life.expectBalanced();
  });
});

describe('4.6 a pending charge counts once', () => {
  it('4.6 pending 30.00 posts as 36.00 with a tip: counted once, at the final amount', () => {
    // pending: wants 500 - 30 = 470.00
    // posted:  replaces pending -> wants 500 - 36 = 464.00 (not 434.00)
    const life = new Life({ rules: RULES });
    const pend = life.buy(3000, '2026-01-06', 'CINEMA BAR', { pending: true });
    expect(life.book.pots().wants).toBe(47000);
    life.expectBalanced();
    life.buy(3600, '2026-01-08', 'CINEMA BAR', { pendingId: pend.id });
    expect(life.book.pots().wants).toBe(46400);
    expect(life.book.purchases().filter((p) => p.description.includes('CINEMA BAR'))).toHaveLength(1);
    life.expectBalanced();
  });

  it('4.6 posted amount lower than pending', () => {
    // wants 500 - 30 = 470; posts at 25.00 -> 475.00
    const life = new Life({ rules: RULES });
    const pend = life.buy(3000, '2026-01-06', 'CINEMA BAR', { pending: true });
    life.buy(2500, '2026-01-08', 'CINEMA BAR', { pendingId: pend.id });
    expect(life.book.pots().wants).toBe(47500);
    life.expectBalanced();
  });

  it('4.6 unsorted pending charge stays unsorted once at the final amount', () => {
    const life = new Life({ rules: RULES });
    const pend = life.buy(3000, '2026-01-06', 'MYSTERY', { pending: true });
    expect(life.book.pots().unsortedOut).toBe(3000);
    life.buy(3001, '2026-01-08', 'MYSTERY', { pendingId: pend.id });
    expect(life.book.pots().unsortedOut).toBe(3001);
    life.expectBalanced();
  });

  it('4.6 the same transaction received twice counts once', () => {
    const life = new Life({ rules: RULES });
    const txn = {
      kind: 'purchase' as const,
      id: 'dup-1',
      account: 'everyday-card' as const,
      date: '2026-01-06',
      amount: 4000,
      description: 'CITY GROCER',
      pending: false,
    };
    life.feed(txn);
    const r = life.book.receive(txn); // bank not changed again
    expect(r.outcome).toBe('duplicate');
    expect(life.book.pots().needs).toBe(96000);
    life.expectBalanced();
  });
});

describe('4.7 re-sorting a purchase updates the buckets right away', () => {
  it('4.7 needs -> wants', () => {
    // sorted needs: needs 960, wants 500; re-sorted: needs 1,000, wants 460
    const life = new Life({ rules: RULES });
    const p = life.buy(4000, '2026-01-06', 'CITY GROCER');
    life.book.sort(p.id, { to: 'wants' }, '2026-01-07');
    expect(life.book.pots()).toMatchObject({ needs: 100000, wants: 46000 });
    life.expectBalanced();
  });

  it('4.7 sorted -> split', () => {
    // 40.00 split 10.00 needs + 30.00 wants: needs 990.00, wants 470.00
    const life = new Life({ rules: RULES });
    const p = life.buy(4000, '2026-01-06', 'CITY GROCER');
    life.book.sort(p.id, { split: [{ bucket: 'needs', amount: 1000 }, { bucket: 'wants', amount: 3000 }] }, '2026-01-07');
    expect(life.book.pots()).toMatchObject({ needs: 99000, wants: 47000 });
    life.expectBalanced();
  });
});

describe('4.8 everyday card fees and interest go to review, suggested needs', () => {
  it('4.8 a fee goes to review with needs suggested; sorting it takes it from needs', () => {
    const life = new Life({ rules: RULES });
    const r = life.feed({ kind: 'card-charge', id: 'fee1', account: 'everyday-card', date: '2026-01-07', amount: 2500, description: 'LATE FEE', charge: 'fee' });
    expect(life.book.reviewItems().find((i) => i.id === r.id)).toMatchObject({ type: 'spending', reason: 'card-fee', suggestion: 'needs' });
    expect(life.book.pots()).toMatchObject({ needs: 100000, unsortedOut: 2500 });
    life.expectBalanced();
    // needs 1,000 - 25 = 975.00
    life.book.sort(r.id, { to: 'needs' }, '2026-01-07');
    expect(life.book.pots()).toMatchObject({ needs: 97500, unsortedOut: 0 });
    life.expectBalanced();
  });

  it('4.8 interest goes to review with needs suggested', () => {
    const life = new Life({ rules: RULES });
    const r = life.feed({ kind: 'card-charge', id: 'int1', account: 'everyday-card', date: '2026-01-07', amount: 1234, description: 'INTEREST CHARGE', charge: 'interest' });
    expect(life.book.reviewItems().find((i) => i.id === r.id)).toMatchObject({ type: 'spending', reason: 'card-interest', suggestion: 'needs' });
    life.expectBalanced();
  });
});
