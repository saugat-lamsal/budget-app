import { describe, expect, it } from 'vitest';
import { TestBank, appSide, arrived, cardCharge, codeOf, deposit, dropped, openTestBook, payPerson, posted, purchase, refund, sent, transfer, withdrawal } from './helpers.js';

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
      { id: 't1', date: '2026-10-05', description: 'TRANSFER checking TO old-card', amount: 20_000, refunded: 0, countedAtSetup: 0, pending: false, kind: 'debt-payoff', sortedTo: { to: 'needs' } },
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

  it('5.4 a pending old card charge the bank drops lowers the debt again and clears its flag (A2)', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-05', 7_500, 'MADE UP CAFE', { account: 'old-card', pending: true }));
    expect(b.oldCardDebt()).toBe(307_500);
    b.receive(dropped('d1', 'o1', '2026-10-07'));
    expect(b.oldCardDebt()).toBe(300_000);
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toEqual([]);
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

  it('5.2 from savings, it lowers the debt and waits for your OK, with the savings bucket suggested (A4)', () => {
    const b = book();
    expect(b.receive(transfer('t1', '2026-10-05', 20_000, 'savings', 'old-card')).outcome).toBe('review');
    expect(b.oldCardDebt()).toBe(280_000);
    expect(b.pots()).toEqual({ ...START, unsortedOut: 20_000 });
    expect(b.reviewItems()).toEqual([
      { type: 'spending', id: 't1', date: '2026-10-05', amount: 20_000, description: 'TRANSFER savings TO old-card', reason: 'old-card-from-savings', suggestion: 'savings' },
    ]);
    b.sort('t1', { to: 'savings' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, savings: 480_000 });
    expect(b.reviewItems()).toEqual([]);
  });

  it('5.2 from savings, you can pick needs instead (A4)', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 20_000, 'savings', 'old-card'));
    b.sort('t1', { to: 'needs' }, '2026-10-06');
    expect(b.pots()).toEqual({ ...START, needs: 80_000 });
  });

  it('5.2 from savings, it cannot go to wants or be split, and a refusal changes nothing (A4)', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 20_000, 'savings', 'old-card'));
    expect(codeOf(() => b.sort('t1', { to: 'wants' }, '2026-10-06'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('t1', { to: 'momReserve' }, '2026-10-06'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('t1', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 10_000 }] }, '2026-10-06'))).toBe('bad-choice');
    expect(b.pots()).toEqual({ ...START, unsortedOut: 20_000 });
  });

  it('5.2 from savings, the choice can be changed later (4.7)', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-05', 20_000, 'savings', 'old-card'));
    b.sort('t1', { to: 'savings' }, '2026-10-06');
    b.sort('t1', { to: 'needs' }, '2026-10-07');
    expect(b.pots()).toEqual({ ...START, needs: 80_000 });
  });

  it('5.2 from savings taken from the savings bucket leaves nothing extra to move (3.8)', () => {
    const b = book();
    // The savings account held exactly savings + reserve, 6,500.00, and the payment came out of it.
    b.receive(transfer('t1', '2026-10-05', 20_000, 'savings', 'old-card'));
    b.sort('t1', { to: 'savings' }, '2026-10-06');
    expect(b.savingsTransfer(630_000)).toEqual({ shouldBeInSavings: 630_000, savingsAccountBalance: 630_000, stillToMove: 0 });
  });
});

describe('5.6 in review, spending or money in can be marked as a transfer between your accounts (A12)', () => {
  it('5.6 money that left checking, read as a purchase, becomes the leaving half: no bucket changes, in transit until it lands', () => {
    const b = book();
    const bank = new TestBank({ checking: appSide(b.pots()) });
    const out = purchase('x1', '2026-10-03', 30_000, 'MADE UP ONLINE TRANSFER', { account: 'checking' });
    b.receive(out);
    bank.apply(out);
    expect(b.pots()).toEqual({ ...START, unsortedOut: 30_000 });
    b.sort('x1', { transfer: 'savings' }, '2026-10-03');
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toEqual([]);
    expect(b.inTransit()).toMatchObject({ total: 30_000, items: [{ id: 'x1', from: 'checking', to: 'savings', amount: 30_000, seen: 'left' }] });
    // The money left checking and has not landed: bank side plus in transit is the app side.
    expect(b.selfCheck({ checking: bank.checking, savings: bank.savings, everydayCard: bank.everydayCard }).ok).toBe(true);
    b.receive(arrived('x2', '2026-10-04', 30_000, 'checking', 'savings'));
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
    expect(b.pots()).toEqual(START);
  });

  it('5.6 money that came into savings, read as a deposit, becomes the arriving half and pairs with the half that left', () => {
    const b = book();
    const bank = new TestBank({ checking: appSide(b.pots()) });
    for (const txn of [sent('t1', '2026-10-03', 20_000, 'checking', 'savings'), deposit('d1', '2026-10-03', 20_000, 'MADE UP INCOMING', 'savings')]) {
      b.receive(txn);
      bank.apply(txn);
    }
    expect(b.pots()).toEqual({ ...START, unsortedIn: 20_000 });
    b.sort('d1', { transfer: 'checking' }, '2026-10-04');
    expect(b.pots()).toEqual(START);
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
  });

  it('5.6 a card payment read as a refund on the everyday card becomes its arriving half (5.1)', () => {
    const b = book();
    b.receive(sent('t1', '2026-10-03', 45_000, 'checking', 'everyday-card'));
    b.receive(refund('r1', '2026-10-04', 45_000, undefined, 'everyday-card'));
    b.sort('r1', { transfer: 'checking' }, '2026-10-04');
    expect(b.pots()).toEqual(START);
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
    expect(b.cardPayments('everyday-card')).toEqual([{ date: '2026-10-03', amount: 45_000, landedOn: '2026-10-04' }]);
  });

  it('5.6 marked as a payment to the old card from checking, it comes out of needs (5.2)', () => {
    const b = book();
    b.receive(purchase('x1', '2026-10-03', 10_000, 'MADE UP BILL PAY', { account: 'checking' }));
    b.sort('x1', { transfer: 'old-card' }, '2026-10-03');
    expect(b.pots()).toEqual({ ...START, needs: 90_000 });
    expect(b.oldCardDebt()).toBe(300_000);
    // The payment landing on the old card, read as a refund there, is its arriving half.
    b.receive(refund('r1', '2026-10-04', 10_000, undefined, 'old-card'));
    expect(b.oldCardDebt()).toBe(290_000);
    b.sort('r1', { transfer: 'checking' }, '2026-10-04');
    expect(b.oldCardDebt()).toBe(290_000);
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
    expect(b.pots()).toEqual({ ...START, needs: 90_000 });
  });

  it('5.6 from savings to the old card, it waits for savings or needs, like any payment from savings (5.2, A4)', () => {
    const b = book();
    b.receive(withdrawal('s1', '2026-10-03', 10_000, 'MADE UP BILL PAY'));
    b.sort('s1', { transfer: 'old-card' }, '2026-10-03');
    expect(b.reviewItems()).toMatchObject([{ id: 's1', reason: 'old-card-from-savings', suggestion: 'savings' }]);
    b.sort('s1', { to: 'savings' }, '2026-10-04');
    expect(b.pots()).toEqual({ ...START, savings: 490_000 });
  });

  it('5.6 a payment to a person can be one too', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-03', 7_000, 'MADE UP ME AT ANOTHER BANK'));
    b.sort('z1', { transfer: 'savings' }, '2026-10-03');
    expect(b.pots()).toEqual(START);
    expect(b.inTransit().total).toBe(7_000);
  });

  it('5.6 it can be sorted back, and is then spending or money in again', () => {
    const b = book();
    b.receive(purchase('x1', '2026-10-03', 30_000, 'MADE UP CAFE', { account: 'checking' }));
    expect(b.pots()).toEqual({ ...START, wants: 20_000 });
    b.sort('x1', { transfer: 'savings' }, '2026-10-03');
    expect(b.pots()).toEqual(START);
    b.sort('x1', { to: 'needs' }, '2026-10-04');
    expect(b.pots()).toEqual({ ...START, needs: 70_000 });
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
    b.receive(deposit('d1', '2026-10-03', 5_000, 'MADE UP INCOMING', 'savings'));
    b.sort('d1', { transfer: 'checking' }, '2026-10-04');
    b.sort('d1', { to: 'wants' }, '2026-10-04');
    expect(b.pots()).toEqual({ ...START, needs: 70_000, wants: 55_000 });
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
  });

  it('5.6 the bank sending the original again is still a duplicate, and nothing is counted twice', () => {
    const b = book();
    const out = purchase('x1', '2026-10-03', 30_000, 'MADE UP TRANSFER', { account: 'checking' });
    b.receive(out);
    b.sort('x1', { transfer: 'savings' }, '2026-10-03');
    expect(b.receive(out).outcome).toBe('duplicate');
    expect(b.inTransit().total).toBe(30_000);
  });

  it('5.6 a charge that posted at a new amount is marked as posted; sorted back, it is the posted charge again, and both versions sent again are duplicates', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-03', 5_000, 'ONLINE TRANSFER', { account: 'checking', pending: true }));
    b.receive(posted('p2', 'p1', '2026-10-04', 5_200, 'ONLINE TRANSFER', 'checking'));
    b.sort('p1', { transfer: 'savings' }, '2026-10-05');
    expect(b.inTransit()).toMatchObject({ total: 5_200, items: [{ id: 'p1', amount: 5_200, seen: 'left' }] });
    expect(b.receive(purchase('p1', '2026-10-03', 5_000, 'ONLINE TRANSFER', { account: 'checking', pending: true })).outcome).toBe('duplicate');
    expect(b.receive(posted('p2', 'p1', '2026-10-04', 5_200, 'ONLINE TRANSFER', 'checking')).outcome).toBe('duplicate');
    b.sort('p1', { to: 'needs' }, '2026-10-06');
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
    expect(b.pots()).toEqual({ ...START, needs: 94_800 });
    expect(b.purchases()).toMatchObject([{ id: 'p1', amount: 5_200, pending: false }]);
  });

  it('5.6 a purchase partly refunded, or one counted on setup day, cannot be marked as a transfer, and nothing changes', () => {
    const b = openTestBook({
      pots: { savings: 500_000, needs: 100_000, wants: 50_000, momReserve: 150_000 },
      countedAtSetup: [purchase('s1', '2026-09-30', 3_000, 'MADE UP SHOP', { account: 'checking', pending: true })],
    });
    b.receive(posted('s2', 's1', '2026-10-02', 3_000, 'MADE UP SHOP', 'checking'));
    b.receive(purchase('x1', '2026-10-03', 8_000, 'MADE UP SHOP', { account: 'checking' }));
    b.receive(refund('r1', '2026-10-04', 1_000, 'x1', 'checking'));
    const before = b.pots();
    expect(codeOf(() => b.sort('x1', { transfer: 'savings' }, '2026-10-05'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('s1', { transfer: 'savings' }, '2026-10-05'))).toBe('bad-choice');
    expect(b.pots()).toEqual(before);
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
  });

  it('5.6 only money out of checking or savings, or money in, can be a transfer, to another account, once it has posted', () => {
    const b = book();
    b.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP CAFE'));
    b.receive(purchase('p1', '2026-10-03', 1_000, 'MADE UP STORE', { account: 'checking', pending: true }));
    b.receive(purchase('x1', '2026-10-03', 1_000, 'MADE UP STORE', { account: 'checking' }));
    b.receive(deposit('d1', '2026-10-03', 1_000, 'MADE UP INCOMING', 'savings'));
    b.receive(cardCharge('f1', '2026-10-03', 1_000));
    // A card purchase is money leaving a card: never a transfer.
    expect(codeOf(() => b.sort('c1', { transfer: 'checking' }, '2026-10-04'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('p1', { transfer: 'savings' }, '2026-10-04'))).toBe('still-pending');
    expect(codeOf(() => b.sort('x1', { transfer: 'checking' }, '2026-10-04'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('x1', { transfer: 'brokerage' } as never, '2026-10-04'))).toBe('bad-choice');
    // Money cannot arrive from a card, or from the account it landed in.
    expect(codeOf(() => b.sort('d1', { transfer: 'everyday-card' }, '2026-10-04'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('d1', { transfer: 'savings' }, '2026-10-04'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('f1', { transfer: 'checking' }, '2026-10-04'))).toBe('bad-choice');
    expect(b.pots()).toEqual({ ...START, wants: 49_000, unsortedOut: 3_000, unsortedIn: 1_000 });
  });
});
