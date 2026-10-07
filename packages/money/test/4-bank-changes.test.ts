import { describe, expect, it } from 'vitest';
import type { Book, SortingRule } from '../src/index.js';
import {
  MOM_NAME,
  TestBank,
  appSide,
  arrived,
  cardCharge,
  codeOf,
  deposit,
  dropped,
  openTestBook,
  payPerson,
  paycheck,
  pendingChanged,
  posted,
  purchase,
  refund,
  sent,
  takenBack,
  transfer,
  type TestBookOptions,
} from './helpers.js';

// When the bank changes its mind about something the app already counted.
// Made-up numbers.
const RULES: SortingRule[] = [
  { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
];
const POTS = { savings: 200_000, needs: 100_000, wants: 50_000, momReserve: 40_000, heldForOthers: 0 };
const START = { ...POTS, unsortedIn: 0, unsortedOut: 0 };

function book(options: TestBookOptions = {}): Book {
  return openTestBook({ pots: POTS, oldCardDebt: 300_000, rules: RULES, ...options });
}

const fine = (b: Book) => ({ bankConnection: 'ok' as const, bankBalances: { checking: appSide(b.pots()), savings: 0, everydayCard: 0 } });

describe('4.6 a pending charge whose amount changes before it posts (A13)', () => {
  it('4.6 the new amount replaces the old right away, in the same bucket', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true }));
    expect(b.receive(pendingChanged('c1', 'p1', '2026-10-04', 4_800))).toEqual({ id: 'c1', outcome: 'changed' });
    expect(b.pots()).toEqual({ ...START, wants: 45_200 });
    expect(b.purchases()).toMatchObject([{ id: 'p1', amount: 4_800, pending: true, date: '2026-10-03' }]);
    // When it posts, the posted charge replaces it as always (4.6).
    b.receive(posted('p2', 'p1', '2026-10-05', 5_000, 'MADE UP CAFE'));
    expect(b.pots()).toEqual({ ...START, wants: 45_000 });
  });

  it('4.6 it can go down too, by one cent, and an unsorted one stays unsorted', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-03', 4_000, 'MADE UP SHOP', { pending: true }));
    b.receive(pendingChanged('c1', 'p1', '2026-10-04', 3_999));
    expect(b.pots()).toEqual({ ...START, unsortedOut: 3_999 });
    expect(b.reviewItems()).toMatchObject([{ id: 'p1', amount: 3_999 }]);
  });

  it('4.6 a split one no longer adds up, so it goes back to review to be split again (A1)', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-03', 4_000, 'MADE UP SHOP', { pending: true }));
    b.sort('p1', { split: [{ bucket: 'needs', amount: 3_000 }, { bucket: 'wants', amount: 1_000 }] }, '2026-10-03');
    b.receive(pendingChanged('c1', 'p1', '2026-10-04', 4_400));
    expect(b.pots()).toEqual({ ...START, unsortedOut: 4_400 });
    expect(b.reviewItems()).toMatchObject([{ id: 'p1', reason: 'split-changed', amount: 4_400 }]);
  });

  it('4.6 one counted on setup day: only the difference waits in review (14.2)', () => {
    const b = book({ countedAtSetup: [purchase('p1', '2026-09-30', 4_000, 'MADE UP CAFE', { pending: true })] });
    b.receive(pendingChanged('c1', 'p1', '2026-10-02', 4_250));
    expect(b.pots()).toEqual({ ...START, unsortedOut: 250 });
  });

  it('4.6 on the old card, the debt follows the new amount, and no bucket (5.4)', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-03', 2_000, 'MADE UP HARDWARE', { account: 'old-card', pending: true }));
    b.receive(pendingChanged('c1', 'o1', '2026-10-04', 2_600));
    expect(b.oldCardDebt()).toBe(302_600);
    expect(b.pots()).toEqual(START);
  });

  it('4.6 the bank side follows the bank, so the self-check still passes (12.1)', () => {
    const b = book();
    const bank = new TestBank({ checking: appSide(b.pots()) });
    for (const txn of [purchase('p1', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true }), pendingChanged('c1', 'p1', '2026-10-04', 4_800)]) {
      b.receive(txn);
      bank.apply(txn);
    }
    expect(b.selfCheck({ checking: bank.checking, savings: bank.savings, everydayCard: bank.everydayCard })).toMatchObject({ ok: true });
  });

  it('4.6 the same change sent twice counts once; a change to a charge that is not pending, or to zero, is refused', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true }));
    b.receive(pendingChanged('c1', 'p1', '2026-10-04', 4_800));
    expect(b.receive(pendingChanged('c1', 'p1', '2026-10-04', 4_800)).outcome).toBe('duplicate');
    expect(codeOf(() => b.receive(pendingChanged('c1', 'p1', '2026-10-04', 4_900)))).toBe('conflicting-id');
    b.receive(purchase('e1', '2026-10-03', 1_000, 'MADE UP CAFE'));
    expect(codeOf(() => b.receive(pendingChanged('c2', 'e1', '2026-10-04', 1_100)))).toBe('not-pending');
    expect(codeOf(() => b.receive(pendingChanged('c3', 'nobody', '2026-10-04', 1_100)))).toBe('not-pending');
    expect(codeOf(() => b.receive(pendingChanged('c4', 'p1', '2026-10-04', 0)))).toBe('not-positive');
    expect(b.pots()).toEqual({ ...START, wants: 44_200 });
  });
});

describe('4.10 the bank takes back a transaction the app counted: the app takes it back too (A14)', () => {
  it('4.10 a purchase: its money goes back to its bucket, the change is logged, and you are told once (10.6)', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 4_200, 'MADE UP CAFE'));
    expect(b.receive(takenBack('k1', 'e1', '2026-10-05'))).toEqual({ id: 'k1', outcome: 'taken-back' });
    expect(b.pots()).toEqual(START);
    expect(b.changeLog()).toEqual([{ date: '2026-10-05', kind: 'bank-took-back', id: 'e1', description: 'MADE UP CAFE', amount: 4_200 }]);
    expect(b.takeAlerts(fine(b))).toEqual([{ kind: 'bank-took-back', id: 'e1', date: '2026-10-05', description: 'MADE UP CAFE', amount: 4_200 }]);
    expect(b.takeAlerts(fine(b))).toEqual([]);
  });

  it('4.10 an unsorted purchase leaves review, and a split one gives each bucket its part back', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 4_200, 'MADE UP SHOP'));
    b.receive(purchase('e2', '2026-10-03', 9_000, 'MADE UP BIG BOX'));
    b.sort('e2', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-03');
    b.receive(takenBack('k1', 'e1', '2026-10-05'));
    b.receive(takenBack('k2', 'e2', '2026-10-05'));
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toEqual([]);
  });

  it('4.10 a posted charge that replaced a pending one: the bank names the posted one', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-03', 4_000, 'MADE UP CAFE', { pending: true }));
    b.receive(posted('p2', 'p1', '2026-10-04', 4_400, 'MADE UP CAFE'));
    b.receive(takenBack('k1', 'p2', '2026-10-06'));
    expect(b.pots()).toEqual(START);
  });

  it('4.10 a purchase that was partly refunded: the refund stays where it went', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 10_000, 'MADE UP GROCER'));
    b.receive(refund('r1', '2026-10-04', 3_000, 'e1'));
    b.receive(takenBack('k1', 'e1', '2026-10-05'));
    // The bank still has the 30.00 refund; only the purchase is gone.
    expect(b.pots()).toEqual({ ...START, needs: 103_000 });
  });

  it('4.10 a refund that was matched to its purchase: the purchase counts in full again', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 10_000, 'MADE UP GROCER'));
    b.receive(refund('r1', '2026-10-04', 3_000, 'e1'));
    b.receive(takenBack('k1', 'r1', '2026-10-05'));
    expect(b.pots()).toEqual({ ...START, needs: 90_000 });
  });

  it('4.10 money in: what it gave a bucket comes back out, and other income comes back out of every part of its split', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-03', 6_000, 'MADE UP FRIEND'));
    b.sort('d1', { to: 'wants' }, '2026-10-03');
    b.receive(deposit('d2', '2026-10-03', 10_001, 'MADE UP GIG'));
    b.sort('d2', { to: 'other-income' }, '2026-10-03');
    b.receive(deposit('d3', '2026-10-03', 777, 'MADE UP MYSTERY'));
    b.receive(takenBack('k1', 'd1', '2026-10-05'));
    b.receive(takenBack('k2', 'd2', '2026-10-05'));
    b.receive(takenBack('k3', 'd3', '2026-10-05'));
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toEqual([]);
  });

  it('4.10 a paycheck: each bucket gives back what the paycheck gave it; the pay period it started stays', () => {
    const b = book();
    b.receive(paycheck('pay', '2026-10-09', 400_000));
    expect(b.period().number).toBe(1);
    b.receive(takenBack('k1', 'pay', '2026-10-12'));
    expect(b.pots()).toEqual(START);
    expect(b.period()).toEqual({ number: 1, startDate: '2026-10-09' });
    expect(b.lastPaycheckDate()).toBe('2026-10-09');
  });

  it('4.10 a mom payment: the reserve gets its money back, the difference goes away, and the month no longer counts it', () => {
    const b = book();
    b.receive(payPerson('m1', '2026-10-03', 50_000, MOM_NAME));
    expect(b.pots()).toEqual({ ...START, momReserve: 0, unsortedOut: 10_000 });
    b.receive(takenBack('k1', 'm1', '2026-10-05'));
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toEqual([]);
    expect(b.momSentInMonth('2026-10').sent).toBe(0);
    // Neither it nor its difference can be sorted any more (found by the random scenarios).
    expect(codeOf(() => b.sort('m1:difference', { to: 'needs' }, '2026-10-06'))).toBe('not-sortable');
    expect(codeOf(() => b.sort('m1', { to: 'needs' }, '2026-10-06'))).toBe('not-sortable');
    expect(b.pots()).toEqual(START);
  });

  it('4.10 a half of a transfer: its other half is in transit again, and no bucket changes (12.5)', () => {
    const b = book();
    b.receive(sent('t1', '2026-10-03', 30_000, 'checking', 'everyday-card'));
    b.receive(arrived('t2', '2026-10-04', 30_000, 'checking', 'everyday-card'));
    expect(b.inTransit().total).toBe(0);
    b.receive(takenBack('k1', 't1', '2026-10-05'));
    expect(b.inTransit()).toMatchObject({ total: -30_000, items: [{ id: 't2', seen: 'arrived' }] });
    expect(b.pots()).toEqual(START);
    b.receive(transfer('t3', '2026-10-05', 5_000, 'checking', 'savings'));
    b.receive(takenBack('k2', 't3', '2026-10-06'));
    expect(b.pots()).toEqual(START);
  });

  it('4.10 an arriving half that names a leaving half the bank took back has nothing to pair with: it shows as arrived (12.5)', () => {
    const b = book();
    b.receive(sent('t1', '2026-10-03', 30_000, 'checking', 'everyday-card'));
    b.receive(takenBack('k1', 't1', '2026-10-04'));
    expect(b.inTransit()).toMatchObject({ total: 0, items: [] });
    b.receive(arrived('t2', '2026-10-05', 30_000, 'checking', 'everyday-card', 't1'));
    // Listed and counted the same way, so the list still adds up to the total.
    expect(b.inTransit()).toMatchObject({ total: -30_000, items: [{ id: 't2', seen: 'arrived', amount: 30_000 }] });
    expect(b.pots()).toEqual(START);
    // A new leaving half for it pairs with it as usual.
    b.receive(sent('t3', '2026-10-06', 30_000, 'checking', 'everyday-card'));
    expect(b.inTransit()).toMatchObject({ total: 0, items: [] });
  });

  it('4.10 a card payment the bank takes back no longer counts toward the card statement (9.3)', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-03', 20_000, 'checking', 'everyday-card'));
    b.receive(sent('t2', '2026-10-04', 5_000, 'checking', 'everyday-card'));
    expect(b.cardPayments('everyday-card').map((p) => p.amount)).toEqual([20_000, 5_000]);
    b.receive(takenBack('k1', 't1', '2026-10-05'));
    expect(b.cardPayments('everyday-card').map((p) => p.amount)).toEqual([5_000]);
    b.receive(takenBack('k2', 't2', '2026-10-05'));
    expect(b.cardPayments('everyday-card')).toEqual([]);
  });

  it('4.10 a payment to the old card: needs gets it back (5.2), and the debt follows the bank', () => {
    const b = book();
    b.receive(transfer('t1', '2026-10-03', 20_000, 'checking', 'old-card'));
    expect(b.pots()).toEqual({ ...START, needs: 80_000 });
    expect(b.oldCardDebt()).toBe(280_000);
    b.receive(takenBack('k1', 't1', '2026-10-05'));
    expect(b.pots()).toEqual(START);
    expect(b.oldCardDebt()).toBe(300_000);
  });

  it('4.10 old card activity: the debt goes back, and no bucket changes (5.4, 5.5)', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-03', 2_000, 'MADE UP HARDWARE', { account: 'old-card' }));
    b.receive(cardCharge('o2', '2026-10-03', 900, 'interest', 'old-card'));
    b.receive(refund('o3', '2026-10-03', 500, undefined, 'old-card'));
    expect(b.oldCardDebt()).toBe(302_400);
    for (const [i, id] of ['o1', 'o2', 'o3'].entries()) b.receive(takenBack(`k${i}`, id, '2026-10-05'));
    expect(b.oldCardDebt()).toBe(300_000);
    expect(b.pots()).toEqual(START);
    expect(b.reviewItems()).toEqual([]);
  });

  it('4.10 the self-check still passes against the bank, which no longer has it (12.3)', () => {
    const b = book();
    const bank = new TestBank({ checking: appSide(b.pots()) });
    const txns = [purchase('e1', '2026-10-03', 4_200, 'MADE UP CAFE', { account: 'checking' }), payPerson('z1', '2026-10-03', 900, 'MADE UP FRIEND'), takenBack('k1', 'e1', '2026-10-05'), takenBack('k2', 'z1', '2026-10-05')];
    for (const txn of txns) {
      b.receive(txn);
      bank.apply(txn);
      expect(b.selfCheck({ checking: bank.checking, savings: bank.savings, everydayCard: bank.everydayCard }).ok, txn.id).toBe(true);
    }
  });

  it('4.10 the same take-back twice counts once; a pending charge is dropped, not taken back; unknown ones are refused', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 4_200, 'MADE UP CAFE'));
    b.receive(takenBack('k1', 'e1', '2026-10-05'));
    expect(b.receive(takenBack('k1', 'e1', '2026-10-05')).outcome).toBe('duplicate');
    expect(codeOf(() => b.receive(takenBack('k2', 'e1', '2026-10-05')))).toBe('already-taken-back');
    b.receive(purchase('p1', '2026-10-03', 1_000, 'MADE UP CAFE', { pending: true }));
    expect(codeOf(() => b.receive(takenBack('k3', 'p1', '2026-10-05')))).toBe('still-pending');
    expect(codeOf(() => b.receive(takenBack('k4', 'nobody', '2026-10-05')))).toBe('unknown-item');
    b.receive(dropped('x1', 'p1', '2026-10-06'));
    expect(b.pots()).toEqual(START);
    expect(b.changeLog().filter((c) => c.kind === 'bank-took-back')).toHaveLength(1);
  });

  it('4.10 a purchase taken back cannot be sorted any more', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-03', 4_200, 'MADE UP SHOP'));
    b.receive(takenBack('k1', 'e1', '2026-10-05'));
    expect(codeOf(() => b.sort('e1', { to: 'needs' }, '2026-10-06'))).toBe('not-sortable');
    expect(b.pots()).toEqual(START);
  });
});
