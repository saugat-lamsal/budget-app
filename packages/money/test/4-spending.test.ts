import { describe, expect, it } from 'vitest';
import type { SortingRule } from '../src/index.js';
import { cardCharge, codeOf, deposit, openTestBook, paycheck, posted, purchase, refund, type TestBookOptions } from './helpers.js';

const RULES: SortingRule[] = [
  { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
];

function book(options: TestBookOptions = {}) {
  return openTestBook({ pots: { needs: 100_000, wants: 50_000 }, rules: RULES, ...options });
}

describe('4.1 a purchase comes out of a bucket on the day of the purchase', () => {
  it('4.1 a debit card purchase comes out of its bucket', () => {
    const b = book();
    expect(b.receive(purchase('c1', '2026-10-03', 4_250, 'MADE UP GROCER', { account: 'checking' }))).toEqual({ id: 'c1', outcome: 'sorted' });
    expect(b.pots()).toMatchObject({ needs: 95_750, wants: 50_000, unsortedOut: 0 });
  });

  it('4.1 an everyday card purchase comes out of its bucket', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 1_299, 'MADE UP CAFE'));
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 48_701 });
  });

  it('4.1 a pending purchase counts right away, dated the day you made it', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 1_299, 'MADE UP CAFE', { pending: true }));
    expect(b.pots().wants).toBe(48_701);
    expect(b.purchases()).toEqual([
      { id: 'e1', date: '2026-10-03', description: 'MADE UP CAFE', amount: 1_299, refunded: 0, pending: true, kind: 'purchase', sortedTo: { to: 'wants' } },
    ]);
  });

  it('4.1 a purchase can take a bucket below zero', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 50_001, 'MADE UP CAFE'));
    expect(b.pots().wants).toBe(-1);
  });

  it('4.1 one cent and very large purchases are exact', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 1, 'MADE UP CAFE'));
    b.receive(purchase('e2', '2026-10-03', 4_000_000_000_000_000, 'MADE UP GROCER'));
    expect(b.pots()).toMatchObject({ wants: 49_999, needs: 100_000 - 4_000_000_000_000_000 });
  });

  it('4.1 a purchase of zero, a negative amount, or part of a cent is refused and changes nothing', () => {
    const b = book();
    expect(codeOf(() => b.receive(purchase('e1', '2026-10-03', 0)))).toBe('not-positive');
    expect(codeOf(() => b.receive(purchase('e1', '2026-10-03', -5)))).toBe('not-positive');
    expect(codeOf(() => b.receive(purchase('e1', '2026-10-03', 9.99)))).toBe('not-cents');
    expect(codeOf(() => b.receive({ ...purchase('e1', '2026-10-03', 100), account: 'savings' } as never))).toBe('bad-transaction');
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, unsortedOut: 0 });
    expect(b.purchases()).toEqual([]);
  });
});

describe('4.2 the bucket is picked by your rules; no rule means unsorted', () => {
  it('4.2 a matching rule picks the bucket, ignoring upper and lower case', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 500, 'made up cafe #12'));
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'wants' });
  });

  it('4.2 when two rules match, the first one in the list wins', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 500, 'THE CAFE GROCER'));
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'needs' });
    const reversed = book({ rules: [...RULES].reverse() });
    reversed.receive(purchase('e1', '2026-10-03', 500, 'THE CAFE GROCER'));
    expect(reversed.purchases()[0]?.sortedTo).toEqual({ to: 'wants' });
  });

  it('4.2 no matching rule means unsorted, waiting in review', () => {
    const b = book();
    expect(b.receive(purchase('e1', '2026-10-03', 2_500, 'MADE UP HARDWARE')).outcome).toBe('review');
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'unsorted' });
    expect(b.reviewItems()).toEqual([
      { type: 'spending', id: 'e1', date: '2026-10-03', amount: 2_500, description: 'MADE UP HARDWARE', reason: 'no-rule', suggestion: null },
    ]);
  });

  it('4.2 with no rules at all, every purchase is unsorted', () => {
    const b = book({ rules: [] });
    b.receive(purchase('e1', '2026-10-03', 500, 'MADE UP CAFE'));
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'unsorted' });
  });

  it('4.2 rules that make no sense are refused', () => {
    expect(codeOf(() => book({ rules: [{ id: 'x', for: 'purchase', contains: ' ', bucket: 'needs' }] }))).toBe('bad-rule');
    expect(codeOf(() => book({ rules: [{ id: 'x', for: 'purchase', contains: 'A', bucket: 'savings' as never }] }))).toBe('bad-rule');
    expect(codeOf(() => book({ rules: [RULES[0] as SortingRule, RULES[0] as SortingRule] }))).toBe('bad-rule');
  });
});

describe('4.3 unsorted spending is held back until you sort it', () => {
  it('4.3 unsorted spending is held on its own, not in a bucket, until sorted', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 2_500, 'MADE UP HARDWARE'));
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, unsortedOut: 2_500 });
    b.sort('e1', { to: 'needs' }, '2026-10-04');
    expect(b.pots()).toMatchObject({ needs: 97_500, wants: 50_000, unsortedOut: 0 });
    expect(b.reviewItems()).toEqual([]);
  });

  it('4.3 one cent of unsorted spending is held back too', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 1, 'MADE UP HARDWARE'));
    expect(b.pots().unsortedOut).toBe(1);
  });

  it('4.3 spending can be sorted only to needs or wants', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 100, 'MADE UP HARDWARE'));
    for (const to of ['savings', 'momReserve', 'income', 'unsorted', 'nope']) {
      expect(codeOf(() => b.sort('e1', { to } as never, '2026-10-04')), to).toBe('bad-choice');
    }
    expect(b.pots().unsortedOut).toBe(100);
  });
});

describe('4.4 a purchase can be split across buckets; the parts must add up', () => {
  it('4.4 split between needs and wants', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 12_000, 'MADE UP HARDWARE'));
    b.sort('e1', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 2_000 }] }, '2026-10-04');
    expect(b.pots()).toMatchObject({ needs: 90_000, wants: 48_000, unsortedOut: 0 });
    expect(b.purchases()[0]?.sortedTo).toEqual({ split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 2_000 }] });
  });

  it('4.4 parts one cent short or one cent over are refused, and nothing changes', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 12_000, 'MADE UP HARDWARE'));
    expect(codeOf(() => b.sort('e1', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 1_999 }] }, '2026-10-04'))).toBe('split-does-not-add-up');
    expect(codeOf(() => b.sort('e1', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 2_001 }] }, '2026-10-04'))).toBe('split-does-not-add-up');
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, unsortedOut: 12_000 });
  });

  it('4.4 each part must be more than zero, whole cents, in needs or wants', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 100, 'MADE UP HARDWARE'));
    expect(codeOf(() => b.sort('e1', { split: [{ bucket: 'needs', amount: 100 }, { bucket: 'wants', amount: 0 }] }, '2026-10-04'))).toBe('not-positive');
    expect(codeOf(() => b.sort('e1', { split: [{ bucket: 'needs', amount: 150 }, { bucket: 'wants', amount: -50 }] }, '2026-10-04'))).toBe('not-positive');
    expect(codeOf(() => b.sort('e1', { split: [{ bucket: 'needs', amount: 50.5 }, { bucket: 'wants', amount: 49.5 }] }, '2026-10-04'))).toBe('not-cents');
    expect(codeOf(() => b.sort('e1', { split: [{ bucket: 'savings' as never, amount: 100 }] }, '2026-10-04'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('e1', { split: [] }, '2026-10-04'))).toBe('split-does-not-add-up');
    expect(b.pots().unsortedOut).toBe(100);
  });

  it('4.4 a one-cent split works', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 2, 'MADE UP HARDWARE'));
    b.sort('e1', { split: [{ bucket: 'needs', amount: 1 }, { bucket: 'wants', amount: 1 }] }, '2026-10-04');
    expect(b.pots()).toMatchObject({ needs: 99_999, wants: 49_999 });
  });
});

describe('4.5 a refund goes back to the bucket the purchase came from', () => {
  it('4.5 a refund goes back to the bucket of its purchase', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 3_500, 'MADE UP CAFE'));
    expect(b.receive(refund('r1', '2026-10-06', 3_500, 'e1')).outcome).toBe('sorted');
    expect(b.pots()).toMatchObject({ wants: 50_000, unsortedIn: 0 });
    expect(b.purchases()[0]).toMatchObject({ amount: 3_500, refunded: 3_500 });
  });

  it('4.5 partial refunds add up; once the whole purchase is refunded, the next cent goes to review', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 3_500, 'MADE UP CAFE'));
    b.receive(refund('r1', '2026-10-06', 1_000, 'e1'));
    b.receive(refund('r2', '2026-10-07', 2_500, 'e1'));
    expect(b.pots().wants).toBe(50_000);
    expect(b.receive(refund('r3', '2026-10-08', 1, 'e1')).outcome).toBe('review');
    expect(b.pots()).toMatchObject({ wants: 50_000, unsortedIn: 1 });
  });

  it('4.5 a refund bigger than what is left of the purchase goes to review', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 3_500, 'MADE UP CAFE'));
    expect(b.receive(refund('r1', '2026-10-06', 3_501, 'e1')).outcome).toBe('review');
    expect(b.pots()).toMatchObject({ wants: 46_500, unsortedIn: 3_501 });
  });

  it('4.5 a refund the app cannot match goes to review as money in', () => {
    const b = book();
    expect(b.receive(refund('r1', '2026-10-06', 700)).outcome).toBe('review');
    expect(b.receive(refund('r2', '2026-10-06', 800, 'no-such-purchase')).outcome).toBe('review');
    b.receive(deposit('d1', '2026-10-06', 5_000, 'MADE UP GIFT'));
    expect(b.receive(refund('r3', '2026-10-06', 900, 'd1')).outcome).toBe('review');
    expect(b.pots().unsortedIn).toBe(700 + 800 + 5_000 + 900);
    expect(b.reviewItems().filter((i) => i.type === 'money-in').map((i) => i.type === 'money-in' && i.reason)).toEqual(['refund', 'refund', 'deposit', 'refund']);
  });

  it('4.5 a refund in review can be put in any bucket', () => {
    const b = book();
    for (const [n, to] of (['savings', 'needs', 'wants', 'momReserve'] as const).entries()) {
      b.receive(refund(`r${n}`, '2026-10-06', 100));
      b.sort(`r${n}`, { to }, '2026-10-07');
    }
    expect(b.pots()).toMatchObject({ savings: 100, needs: 100_100, wants: 50_100, momReserve: 100, unsortedIn: 0 });
    b.receive(refund('r9', '2026-10-06', 100));
    expect(codeOf(() => b.sort('r9', { split: [{ bucket: 'needs', amount: 100 }] }, '2026-10-07'))).toBe('bad-choice');
  });

  it('4.5 a refund of an unsorted purchase lowers the unsorted spending; sorting it later moves only what is left', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 3_500, 'MADE UP HARDWARE'));
    b.receive(refund('r1', '2026-10-06', 1_000, 'e1'));
    expect(b.pots()).toMatchObject({ unsortedOut: 2_500, unsortedIn: 0 });
    b.sort('e1', { to: 'needs' }, '2026-10-07');
    expect(b.pots()).toMatchObject({ needs: 97_500, unsortedOut: 0 });
  });

  it('4.5 a refund of a split purchase sends the purchase back to review to be split again', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 12_000, 'MADE UP HARDWARE'));
    b.sort('e1', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 2_000 }] }, '2026-10-04');
    b.receive(refund('r1', '2026-10-06', 2_000, 'e1'));
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, unsortedOut: 10_000 });
    expect(b.reviewItems()).toEqual([
      { type: 'spending', id: 'e1', date: '2026-10-03', amount: 10_000, description: 'MADE UP HARDWARE', reason: 'split-changed', suggestion: null },
    ]);
    b.sort('e1', { split: [{ bucket: 'needs', amount: 10_000 }] }, '2026-10-07');
    expect(b.pots()).toMatchObject({ needs: 90_000, wants: 50_000, unsortedOut: 0 });
  });

  it('4.5 a refund on the debit card can match an everyday card purchase', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 3_500, 'MADE UP CAFE'));
    expect(b.receive(refund('r1', '2026-10-06', 3_500, 'e1', 'checking')).outcome).toBe('sorted');
    expect(b.pots().wants).toBe(50_000);
  });
});

describe('4.6 a pending charge counts once; the posted charge replaces it', () => {
  it('4.6 posting at the same amount changes nothing', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true }));
    expect(b.receive(posted('post', 'pend', '2026-10-05', 4_000, 'MADE UP CAFE')).outcome).toBe('posted');
    expect(b.pots().wants).toBe(46_000);
    expect(b.purchases()).toEqual([
      { id: 'pend', date: '2026-10-03', description: 'MADE UP CAFE', amount: 4_000, refunded: 0, pending: false, kind: 'purchase', sortedTo: { to: 'wants' } },
    ]);
  });

  it('4.6 posting with a tip takes only the difference, from the same bucket', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true }));
    b.receive(posted('post', 'pend', '2026-10-05', 4_800, 'MADE UP CAFE'));
    expect(b.pots().wants).toBe(45_200);
  });

  it('4.6 posting lower gives the difference back', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true }));
    b.receive(posted('post', 'pend', '2026-10-05', 3_999, 'MADE UP CAFE'));
    expect(b.pots().wants).toBe(46_001);
  });

  it('4.6 the bucket you chose stays, even if the posted description matches another rule', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-03', 4_000, 'MADE UP HARDWARE', { pending: true }));
    b.sort('pend', { to: 'wants' }, '2026-10-04');
    b.receive(posted('post', 'pend', '2026-10-05', 4_100, 'MADE UP GROCER'));
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 45_900 });
  });

  it('4.6 an unsorted pending charge stays unsorted with the posted amount', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-03', 4_000, 'MADE UP HARDWARE', { pending: true }));
    b.receive(posted('post', 'pend', '2026-10-05', 4_400, 'MADE UP HARDWARE'));
    expect(b.pots().unsortedOut).toBe(4_400);
    expect(b.reviewItems()).toMatchObject([{ id: 'pend', amount: 4_400 }]);
  });

  it('4.6 the pending and the posted charge each sent twice still count once', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true }));
    b.receive(posted('post', 'pend', '2026-10-05', 4_800, 'MADE UP CAFE'));
    expect(b.receive(posted('post', 'pend', '2026-10-05', 4_800, 'MADE UP CAFE')).outcome).toBe('duplicate');
    expect(b.receive(purchase('pend', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true })).outcome).toBe('duplicate');
    expect(b.pots().wants).toBe(45_200);
  });

  it('4.6 a second, different posting for the same pending charge is refused', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true }));
    b.receive(posted('post', 'pend', '2026-10-05', 4_800, 'MADE UP CAFE'));
    expect(codeOf(() => b.receive(posted('post2', 'pend', '2026-10-05', 4_900, 'MADE UP CAFE')))).toBe('already-posted');
    expect(codeOf(() => b.receive(posted('post', 'pend', '2026-10-05', 4_900, 'MADE UP CAFE')))).toBe('conflicting-id');
    expect(b.pots().wants).toBe(45_200);
  });

  it('4.6 a posted charge whose pending one the app never saw is a new purchase', () => {
    const b = book();
    expect(b.receive(posted('post', 'never-seen', '2026-10-05', 4_800, 'MADE UP CAFE')).outcome).toBe('sorted');
    expect(b.pots().wants).toBe(45_200);
  });

  it('4.6 only a posted charge can replace a pending one, and only a pending one can be replaced', () => {
    const b = book();
    b.receive(purchase('done', '2026-10-03', 4_000, 'MADE UP CAFE'));
    expect(codeOf(() => b.receive({ ...purchase('p2', '2026-10-03', 100, 'MADE UP CAFE', { pending: true }), pendingId: 'done' }))).toBe('bad-transaction');
    expect(codeOf(() => b.receive(posted('post', 'done', '2026-10-05', 4_800, 'MADE UP CAFE')))).toBe('already-posted');
    expect(b.pots().wants).toBe(46_000);
  });

  it('4.6 a split purchase that posts at the same amount keeps its split', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-03', 12_000, 'MADE UP HARDWARE', { pending: true }));
    b.sort('pend', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 2_000 }] }, '2026-10-04');
    b.receive(posted('post', 'pend', '2026-10-05', 12_000, 'MADE UP HARDWARE'));
    expect(b.pots()).toMatchObject({ needs: 90_000, wants: 48_000, unsortedOut: 0 });
  });

  it('4.6 a split purchase that posts at a different amount goes back to review to be split again', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-03', 12_000, 'MADE UP HARDWARE', { pending: true }));
    b.sort('pend', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 2_000 }] }, '2026-10-04');
    b.receive(posted('post', 'pend', '2026-10-05', 13_000, 'MADE UP HARDWARE'));
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, unsortedOut: 13_000 });
    expect(b.reviewItems()).toMatchObject([{ id: 'pend', amount: 13_000, reason: 'split-changed' }]);
  });

  it('4.6 a refund can name the posted charge or the pending one', () => {
    const b = book();
    b.receive(purchase('pend', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true }));
    b.receive(posted('post', 'pend', '2026-10-05', 4_000, 'MADE UP CAFE'));
    b.receive(refund('r1', '2026-10-06', 1_000, 'post'));
    b.receive(refund('r2', '2026-10-06', 1_000, 'pend'));
    expect(b.pots().wants).toBe(48_000);
  });
});

describe('4.7 re-sorting a purchase updates the buckets right away', () => {
  it('4.7 moving a purchase from needs to wants', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 4_250, 'MADE UP GROCER'));
    b.sort('e1', { to: 'wants' }, '2026-10-04');
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 45_750 });
  });

  it('4.7 re-sorting a split purchase into one bucket, and back to a split', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 12_000, 'MADE UP GROCER'));
    b.sort('e1', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 2_000 }] }, '2026-10-04');
    b.sort('e1', { to: 'wants' }, '2026-10-05');
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 38_000 });
    b.sort('e1', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 6_000 }] }, '2026-10-06');
    expect(b.pots()).toMatchObject({ needs: 94_000, wants: 44_000 });
  });

  it('4.7 re-sorting a partly refunded purchase moves only what is left of it', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 4_000, 'MADE UP GROCER'));
    b.receive(refund('r1', '2026-10-04', 1_500, 'e1'));
    b.sort('e1', { to: 'wants' }, '2026-10-05');
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 47_500 });
  });

  it('4.7 re-sorting a purchase from a past pay period still updates the buckets now', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 4_000, 'MADE UP GROCER'));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.answerLeftover('leftover:p1:needs', 'roll-over', '2026-10-09');
    b.answerLeftover('leftover:p1:wants', 'roll-over', '2026-10-09');
    b.sort('e1', { to: 'wants' }, '2026-10-10');
    expect(b.pots()).toMatchObject({ needs: 175_000, wants: 96_000 });
  });

  it('4.7 only something that can be sorted can be re-sorted', () => {
    const b = book();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(codeOf(() => b.sort('p1', { to: 'needs' }, '2026-10-10'))).toBe('not-sortable');
    expect(codeOf(() => b.sort('nope', { to: 'needs' }, '2026-10-10'))).toBe('unknown-item');
    expect(codeOf(() => b.sort('leftover:p1:needs', { to: 'needs' }, '2026-10-10'))).toBe('not-sortable');
  });
});

describe('4.8 fees and interest on the everyday card go to review, suggested bucket needs', () => {
  it('4.8 a fee waits in review with needs suggested, even if a rule matches its description', () => {
    const b = book({ rules: [{ id: 'late', for: 'purchase', contains: 'LATE FEE', bucket: 'wants' }] });
    expect(b.receive(cardCharge('f1', '2026-10-03', 2_900, 'fee')).outcome).toBe('review');
    expect(b.pots()).toMatchObject({ needs: 100_000, unsortedOut: 2_900 });
    expect(b.reviewItems()).toEqual([
      { type: 'spending', id: 'f1', date: '2026-10-03', amount: 2_900, description: 'LATE FEE', reason: 'card-fee', suggestion: 'needs' },
    ]);
    b.sort('f1', { to: 'needs' }, '2026-10-04');
    expect(b.pots()).toMatchObject({ needs: 97_100, unsortedOut: 0 });
  });

  it('4.8 interest waits in review too, and can be put in wants if you choose', () => {
    const b = book();
    b.receive(cardCharge('i1', '2026-10-03', 1, 'interest'));
    expect(b.reviewItems()).toMatchObject([{ id: 'i1', reason: 'card-interest', suggestion: 'needs' }]);
    b.sort('i1', { to: 'wants' }, '2026-10-04');
    expect(b.pots()).toMatchObject({ wants: 49_999, unsortedOut: 0 });
  });

  it('4.8 a fee can be refunded back to where it was sorted', () => {
    const b = book();
    b.receive(cardCharge('f1', '2026-10-03', 2_900, 'fee'));
    b.sort('f1', { to: 'needs' }, '2026-10-04');
    b.receive(refund('r1', '2026-10-06', 2_900, 'f1'));
    expect(b.pots()).toMatchObject({ needs: 100_000, unsortedIn: 0 });
  });
});
