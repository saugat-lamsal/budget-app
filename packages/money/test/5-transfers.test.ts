import { describe, expect, it } from 'vitest';
import { TestBank, appSide, cardCharge, codeOf, openTestBook, posted, purchase, refund, transfer } from './helpers.js';

function book() {
  return openTestBook({
    pots: { savings: 500_000, needs: 100_000, wants: 50_000, momReserve: 150_000 },
    oldCardDebt: 300_000,
    rules: [{ id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' }],
  });
}

const START = { savings: 500_000, needs: 100_000, wants: 50_000, momReserve: 150_000, heldForOthers: 0, unsortedIn: 0, unsortedOut: 0 };

describe('5.1 checking to the everyday card is not spending', () => {
  it('5.1 paying the everyday card changes no bucket and asks nothing', () => {
    const b = book();
    expect(b.receive(transfer('t1', '2026-10-05', 45_000, 'checking', 'everyday-card'))).toEqual({ id: 't1', outcome: 'sorted' });
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toEqual([]);
    expect(b.oldCardDebt()).toBe(300_000);
  });

  it('5.1 the buckets still match the bank afterward: the purchases were already counted', () => {
    const b = book();
    const bank = new TestBank({ checking: appSide(b.pots()) });
    for (const txn of [purchase('e1', '2026-10-03', 4_500, 'MADE UP CAFE'), transfer('t1', '2026-10-05', 4_500, 'checking', 'everyday-card')]) {
      b.receive(txn);
      bank.apply(txn);
    }
    expect(appSide(b.pots())).toBe(bank.side());
    expect(b.pots().wants).toBe(45_500);
  });

  it('5.1 paying the everyday card from savings is not spending either', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 45_000, 'savings', 'everyday-card'));
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toEqual([]);
  });

  it('5.1 one cent and very large payments change nothing', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 1, 'checking', 'everyday-card'));
    b.receive(transfer('t2', '2026-10-05', 9_000_000_000_000_000, 'checking', 'everyday-card'));
    expect(b.pots()).toEqual(START);
  });
});

describe('5.2 checking to the old card is spending from needs, on a debt payoff line', () => {
  it('5.2 a payment to the old card comes out of needs and lowers the debt', () => {
    const b = book();
    expect(b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card')).outcome).toBe('sorted');
    expect(b.pots()).toEqual({ ...START, needs: 80_000 });
    expect(b.oldCardDebt()).toBe(280_000);
    expect(b.purchases()).toEqual([
      { id: 't1', date: '2026-10-05', description: 'TRANSFER checking TO old-card', amount: 20_000, refunded: 0, pending: false, kind: 'debt-payoff', sortedTo: { to: 'needs' } },
    ]);
    expect(b.reviewItems()).toEqual([]);
  });

  it('5.2 the debt payoff line always stays in needs', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card'));
    expect(codeOf(() => b.sort('t1', { to: 'wants' }, '2026-10-06'))).toBe('not-sortable');
    expect(b.pots().needs).toBe(80_000);
  });

  it('5.2 paying more than the debt leaves a credit (a negative debt), all from needs', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 300_001, 'checking', 'old-card'));
    expect(b.oldCardDebt()).toBe(-1);
    expect(b.pots().needs).toBe(100_000 - 300_001);
  });

  it('5.2 paying off exactly the whole debt brings it to zero', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 300_000, 'checking', 'old-card'));
    expect(b.oldCardDebt()).toBe(0);
  });

  it('5.2 a refund cannot attach to a debt payoff line', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card'));
    expect(b.receive(refund('r1', '2026-10-06', 100, 't1', 'checking')).outcome).toBe('review');
  });
});

describe('5.3 checking to savings, or back: no bucket changes, only what is left to move', () => {
  it('5.3 checking to savings changes no bucket and lowers what is left to move', () => {
    const b = book();
    expect(b.savingsTransfer(400_000).stillToMove).toBe(250_000);
    b.receive(transfer('t1', '2026-10-05', 60_000, 'checking', 'savings'));
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toEqual([]);
    expect(b.savingsTransfer(460_000).stillToMove).toBe(190_000);
  });

  it('5.3 savings to checking changes no bucket and raises what is left to move', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 1, 'savings', 'checking'));
    expect(b.pots()).toEqual(START);
    expect(b.savingsTransfer(649_999).stillToMove).toBe(1);
  });

  it('5.3 a transfer must go between two different accounts, from checking or savings, for more than zero', () => {
    const b = book();
    expect(codeOf(() => b.receive(transfer('t1', '2026-10-05', 100, 'checking', 'checking')))).toBe('bad-transaction');
    expect(codeOf(() => b.receive(transfer('t1', '2026-10-05', 100, 'everyday-card' as never, 'checking')))).toBe('bad-transaction');
    expect(codeOf(() => b.receive(transfer('t1', '2026-10-05', 100, 'checking', 'brokerage' as never)))).toBe('bad-transaction');
    expect(codeOf(() => b.receive(transfer('t1', '2026-10-05', 0, 'checking', 'savings')))).toBe('not-positive');
  });

  it('5.3 the same transfer sent twice counts once', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card'));
    expect(b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card')).outcome).toBe('duplicate');
    expect(b.oldCardDebt()).toBe(280_000);
    expect(b.pots().needs).toBe(80_000);
  });
});

describe('5.4 a new purchase on the old card is flagged and raises the debt', () => {
  it('5.4 it goes to review as a flag, raises the debt, and touches no bucket', () => {
    const b = book();
    expect(b.receive(purchase('o1', '2026-10-05', 7_500, 'MADE UP CAFE', { account: 'old-card' })).outcome).toBe('review');
    expect(b.pots()).toEqual(START);
    expect(b.oldCardDebt()).toBe(307_500);
    expect(b.reviewItems()).toEqual([{ type: 'old-card-purchase', id: 'o1', date: '2026-10-05', amount: 7_500, description: 'MADE UP CAFE' }]);
  });

  it('5.4 seeing the flag clears it and changes no money', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-05', 7_500, 'MADE UP CAFE', { account: 'old-card' }));
    b.acknowledge('o1', '2026-10-06');
    expect(b.reviewItems()).toEqual([]);
    expect(b.pots()).toEqual(START);
    expect(b.oldCardDebt()).toBe(307_500);
    expect(codeOf(() => b.acknowledge('o1', '2026-10-06'))).toBe('unknown-item');
    expect(codeOf(() => b.acknowledge('nope', '2026-10-06'))).toBe('unknown-item');
    expect(codeOf(() => b.sort('o1', { to: 'needs' }, '2026-10-06'))).toBe('not-sortable');
  });

  it('5.4 it touches needs only when you pay it (5.2)', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-05', 7_500, 'MADE UP CAFE', { account: 'old-card' }));
    b.receive(transfer('t1', '2026-10-20', 7_500, 'checking', 'old-card'));
    expect(b.pots()).toEqual({ ...START, needs: 92_500 });
    expect(b.oldCardDebt()).toBe(300_000);
  });

  it('5.4 a pending old card purchase that posts at a new amount changes the debt only', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-05', 7_500, 'MADE UP CAFE', { account: 'old-card', pending: true }));
    expect(b.receive(posted('o2', 'o1', '2026-10-07', 8_000, 'MADE UP CAFE', 'old-card')).outcome).toBe('posted');
    expect(b.oldCardDebt()).toBe(308_000);
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toMatchObject([{ id: 'o1', amount: 8_000 }]);
  });

  it('5.4 a posted old card charge sent twice counts once (found by the random scenarios)', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-05', 7_500, 'MADE UP CAFE', { account: 'old-card', pending: true }));
    b.receive(posted('o2', 'o1', '2026-10-07', 7_500, 'MADE UP CAFE', 'old-card'));
    expect(b.receive(posted('o2', 'o1', '2026-10-07', 7_500, 'MADE UP CAFE', 'old-card')).outcome).toBe('duplicate');
    expect(b.oldCardDebt()).toBe(307_500);
  });

  it('5.4 a posted charge must be on the same account as its pending one', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-05', 7_500, 'MADE UP CAFE', { account: 'old-card', pending: true }));
    expect(codeOf(() => b.receive(posted('o2', 'o1', '2026-10-07', 7_500, 'MADE UP CAFE', 'everyday-card')))).toBe('bad-transaction');
    expect(b.oldCardDebt()).toBe(307_500);
  });

  it('5.4 one cent on the old card is flagged too', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-05', 1, 'MADE UP CAFE', { account: 'old-card' }));
    expect(b.oldCardDebt()).toBe(300_001);
    expect(b.reviewItems()).toHaveLength(1);
  });
});

describe('5.5 interest or fees on the old card raise the debt; buckets only when paid', () => {
  it('5.5 interest raises the debt, touches no bucket, and asks nothing', () => {
    const b = book();
    expect(b.receive(cardCharge('i1', '2026-10-05', 4_321, 'interest', 'old-card')).outcome).toBe('sorted');
    expect(b.oldCardDebt()).toBe(304_321);
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toEqual([]);
  });

  it('5.5 a fee raises the debt; paying it later comes out of needs', () => {
    const b = book();
    b.receive(cardCharge('f1', '2026-10-05', 3_900, 'fee', 'old-card'));
    b.receive(transfer('t1', '2026-10-20', 3_900, 'checking', 'old-card'));
    expect(b.oldCardDebt()).toBe(300_000);
    expect(b.pots()).toEqual({ ...START, needs: 96_100 });
  });
});

describe('the old card outside the rulebook (see QUESTIONS.md)', () => {
  it('a refund on the old card lowers the debt and touches no bucket', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-05', 7_500, 'MADE UP CAFE', { account: 'old-card' }));
    expect(b.receive(refund('r1', '2026-10-06', 7_500, 'o1', 'old-card')).outcome).toBe('sorted');
    expect(b.oldCardDebt()).toBe(300_000);
    expect(b.pots()).toEqual(START);
  });

  it('a payment to the old card from savings lowers the debt and waits in review for a bucket', () => {
    const b = book();
    expect(b.receive(transfer('t1', '2026-10-05', 20_000, 'savings', 'old-card')).outcome).toBe('review');
    expect(b.oldCardDebt()).toBe(280_000);
    expect(b.pots()).toEqual({ ...START, unsortedOut: 20_000 });
    expect(b.reviewItems()).toEqual([
      { type: 'spending', id: 't1', date: '2026-10-05', amount: 20_000, description: 'TRANSFER savings TO old-card', reason: 'old-card-from-savings', suggestion: 'needs' },
    ]);
    b.sort('t1', { to: 'needs' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, needs: 80_000 });
  });
});
