import { describe, expect, it } from 'vitest';
import { alertsNow, withPendingCharges } from '../src/index.js';
import { TestBank, arrived, codeOf, deposit, openTestBook, posted, purchase, sent, type TestBookOptions } from './helpers.js';

// Buckets add up to 2,000.00 + 500.00 + 300.00 + 1,500.00 + 60.00 = 4,360.00.
function book(options: TestBookOptions = {}) {
  return openTestBook({
    pots: { savings: 200_000, needs: 50_000, wants: 30_000, momReserve: 150_000, heldForOthers: 6_000 },
    oldCardDebt: 300_000,
    rules: [{ id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' }],
    lastPaycheckDate: '2026-10-09',
    ...options,
  });
}

// One way the bank could hold 4,360.00: checking + savings - everyday card.
const MATCHING = { checking: 300_000, savings: 350_000, everydayCard: 214_000 };

describe('12.1 bank side: checking + savings - everyday card balance, including pending charges', () => {
  it('12.1 adds checking and savings and takes off the everyday card', () => {
    expect(book().selfCheck(MATCHING).bankSide).toBe(300_000 + 350_000 - 214_000);
  });

  it('12.1 pending charges are included: a pending debit lowers checking, a pending card charge raises the card', () => {
    const posted = { checking: 100_000, savings: 50_000, everydayCard: 20_000 };
    expect(
      withPendingCharges(posted, [
        { account: 'checking', amount: 1_000 },
        { account: 'everyday-card', amount: 2_500 },
        { account: 'everyday-card', amount: 1 },
      ]),
    ).toEqual({ checking: 99_000, savings: 50_000, everydayCard: 22_501 });
  });

  it('12.1 a pending charge on the old card is left out (12.4)', () => {
    const posted = { checking: 100_000, savings: 50_000, everydayCard: 20_000 };
    expect(withPendingCharges(posted, [{ account: 'old-card', amount: 9_999 }])).toEqual(posted);
  });

  it('12.1 pending charges must be more than zero, in whole cents', () => {
    const posted = { checking: 0, savings: 0, everydayCard: 0 };
    expect(codeOf(() => withPendingCharges(posted, [{ account: 'checking', amount: 0 }]))).toBe('not-positive');
    expect(codeOf(() => withPendingCharges(posted, [{ account: 'checking', amount: 1.5 }]))).toBe('not-cents');
  });

  it('12.1 a pending charge counts once: in the buckets (4.6) and in the bank balance, and the two still match', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-12', 4_800, 'MADE UP CAFE', { pending: true }));
    const bank = withPendingCharges(MATCHING, [{ account: 'everyday-card', amount: 4_800 }]);
    expect(b.selfCheck(bank)).toMatchObject({ ok: true, difference: 0 });
  });

  it('12.1 when it posts at a new amount, the posted balance matches again', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-12', 4_800, 'MADE UP CAFE', { pending: true }));
    b.receive(posted('e2', 'e1', '2026-10-14', 5_500, 'MADE UP CAFE'));
    expect(b.selfCheck({ ...MATCHING, everydayCard: MATCHING.everydayCard + 5_500 })).toMatchObject({ ok: true, difference: 0 });
  });
});

describe('12.2 app side: all buckets + held for others + unsorted money in - unsorted spending', () => {
  it('12.2 adds every bucket and held for others', () => {
    expect(book().selfCheck(MATCHING).appSide).toBe(436_000);
  });

  it('12.2 money waiting in review counts on the app side, and unsorted spending comes off', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-12', 10_000, 'MADE UP GIFT'));
    b.receive(purchase('e1', '2026-10-12', 2_500, 'MADE UP HARDWARE'));
    expect(b.selfCheck(MATCHING).appSide).toBe(436_000 + 10_000 - 2_500);
  });

  it('12.2 the app side matches a made-up bank through a mix of activity', () => {
    const b = book();
    const bank = new TestBank(MATCHING);
    for (const txn of [
      deposit('d1', '2026-10-12', 10_000, 'MADE UP GIFT'),
      purchase('e1', '2026-10-12', 2_500, 'MADE UP HARDWARE', { account: 'checking' }),
      purchase('e2', '2026-10-13', 1_250, 'MADE UP CAFE', { pending: true }),
      posted('e3', 'e2', '2026-10-14', 1_500, 'MADE UP CAFE'),
    ]) {
      b.receive(txn);
      bank.apply(txn);
    }
    expect(b.selfCheck(bank)).toMatchObject({ ok: true, difference: 0 });
  });
});

describe('12.3 the two must be equal; if not, a warning with the difference', () => {
  it('12.3 equal: no warning', () => {
    expect(book().selfCheck(MATCHING)).toEqual({ bankSide: 436_000, inTransit: 0, appSide: 436_000, difference: 0, ok: true });
  });

  it('12.3 the bank one cent higher: warning, difference +1', () => {
    expect(book().selfCheck({ ...MATCHING, checking: 300_001 })).toEqual({ bankSide: 436_001, inTransit: 0, appSide: 436_000, difference: 1, ok: false });
  });

  it('12.3 the bank one cent lower: warning, difference -1', () => {
    expect(book().selfCheck({ ...MATCHING, everydayCard: 214_001 })).toMatchObject({ difference: -1, ok: false });
  });

  it('12.3 very large balances are compared exactly', () => {
    const b = book({ pots: { savings: 4_000_000_000_000_000, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 } });
    expect(b.selfCheck({ checking: 4_000_000_000_000_000, savings: 0, everydayCard: 0 }).ok).toBe(true);
    expect(b.selfCheck({ checking: 4_000_000_000_000_001, savings: 0, everydayCard: 0 }).difference).toBe(1);
  });

  it('12.3 bank balances must be whole cents', () => {
    expect(codeOf(() => book().selfCheck({ ...MATCHING, savings: 0.5 }))).toBe('not-cents');
  });
});

describe('12.4 the old card is tracked separately as debt, not part of this check', () => {
  it('12.4 old card activity never moves the check', () => {
    const b = book();
    b.receive(purchase('o1', '2026-10-12', 7_500, 'MADE UP STORE', { account: 'old-card' }));
    expect(b.selfCheck(MATCHING)).toMatchObject({ ok: true });
    expect(b.oldCardDebt()).toBe(307_500);
  });

  it('12.4 the bank balance object has no old card in it', () => {
    expect(Object.keys(book().selfCheck(MATCHING))).toEqual(['bankSide', 'inTransit', 'appSide', 'difference', 'ok']);
  });
});

describe('0.5 when the totals do not match the bank, the app says so instead of showing a number', () => {
  it('0.5 matching totals: safe to spend is shown', () => {
    expect(book().checkedSafeToSpend('2026-10-14', MATCHING)).toEqual({
      ok: true,
      safeToSpend: { amount: 30_000, nextPayday: '2026-10-23', daysToPayday: 9 },
    });
  });

  it('0.5 one cent off: no safe-to-spend number, only the difference', () => {
    expect(book().checkedSafeToSpend('2026-10-14', { ...MATCHING, checking: 299_999 })).toEqual({
      ok: false,
      difference: -1,
      nextPayday: '2026-10-23',
      daysToPayday: 9,
    });
  });
});

describe('10.4 alert when the totals do not match the bank', () => {
  it('10.4 the alert carries the difference', () => {
    expect(alertsNow(book(), { bankConnection: 'ok', bankBalances: { ...MATCHING, savings: 350_250 } })).toEqual([
      { kind: 'totals-mismatch', difference: 250 },
    ]);
  });

  it('10.4 no alert when they match', () => {
    expect(alertsNow(book(), { bankConnection: 'ok', bankBalances: MATCHING })).toEqual([]);
  });

  it('10.4 it comes after the review alert and before the bank login alert', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-12', 100, 'MADE UP HARDWARE'));
    expect(alertsNow(b, { bankConnection: 'needs-login', bankBalances: MATCHING }).map((a) => a.kind)).toEqual([
      'daily-review',
      'totals-mismatch',
      'bank-login',
    ]);
  });
});

describe('12.5 money in transit: left one of your accounts, not yet arrived in another', () => {
  // A card payment usually leaves checking a day or two before it reaches
  // the card. The bank shows the two halves on different days.
  const PAID = { ...MATCHING, checking: MATCHING.checking - 20_000 };
  const LANDED = { ...PAID, everydayCard: MATCHING.everydayCard - 20_000 };

  it('12.5 a card payment that has left checking but not reached the card: the check passes, with it in transit', () => {
    const b = book();
    const before = b.pots();
    expect(b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'everyday-card')).outcome).toBe('sorted');
    expect(b.pots()).toEqual(before);
    expect(b.selfCheck(PAID)).toEqual({ bankSide: 416_000, inTransit: 20_000, appSide: 436_000, difference: 0, ok: true });
    expect(b.inTransit()).toEqual({
      total: 20_000,
      items: [{ id: 's1', date: '2026-10-12', from: 'checking', to: 'everyday-card', amount: 20_000, seen: 'left' }],
    });
  });

  it('12.5 safe to spend stays on while the payment is on its way (0.5)', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'everyday-card'));
    expect(b.checkedSafeToSpend('2026-10-13', PAID)).toMatchObject({ ok: true, safeToSpend: { amount: 30_000 } });
  });

  it('12.5 when it lands, nothing is in transit, no bucket changed, and the check still passes', () => {
    const b = book();
    const before = b.pots();
    b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'everyday-card'));
    b.receive(arrived('a1', '2026-10-14', 20_000, 'checking', 'everyday-card', 's1'));
    expect(b.pots()).toEqual(before);
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
    expect(b.selfCheck(LANDED)).toMatchObject({ inTransit: 0, ok: true });
  });

  it('12.5 without a link, an arrival pairs with the oldest payment of the same amount between the same accounts', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'everyday-card'));
    b.receive(sent('s2', '2026-10-13', 15_000, 'checking', 'everyday-card'));
    b.receive(sent('s3', '2026-10-14', 20_000, 'checking', 'everyday-card'));
    b.receive(sent('s4', '2026-10-14', 20_000, 'savings', 'everyday-card'));
    b.receive(arrived('a1', '2026-10-15', 20_000, 'checking', 'everyday-card'));
    expect(b.inTransit().items.map((i) => i.id)).toEqual(['s2', 's3', 's4']);
    expect(b.inTransit().total).toBe(55_000);
  });

  it('12.5 seen landing before it is seen leaving: in transit the other way until it is', () => {
    const b = book();
    b.receive(arrived('a1', '2026-10-12', 20_000, 'checking', 'everyday-card'));
    const cardOnly = { ...MATCHING, everydayCard: MATCHING.everydayCard - 20_000 };
    expect(b.selfCheck(cardOnly)).toMatchObject({ bankSide: 456_000, inTransit: -20_000, ok: true });
    expect(b.inTransit().items).toEqual([{ id: 'a1', date: '2026-10-12', from: 'checking', to: 'everyday-card', amount: 20_000, seen: 'arrived' }]);
    b.receive(sent('s1', '2026-10-11', 20_000, 'checking', 'everyday-card'));
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
    expect(b.selfCheck(LANDED)).toMatchObject({ ok: true });
  });

  it('12.5 a second arrival pairs with the next payment, never with one that already arrived', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'everyday-card'));
    b.receive(sent('s2', '2026-10-13', 20_000, 'checking', 'everyday-card'));
    b.receive(arrived('a1', '2026-10-14', 20_000, 'checking', 'everyday-card'));
    b.receive(arrived('a2', '2026-10-15', 20_000, 'checking', 'everyday-card'));
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
  });

  it('12.5 arrivals seen before their payments pair oldest first', () => {
    const b = book();
    b.receive(arrived('a1', '2026-10-12', 20_000, 'checking', 'everyday-card'));
    b.receive(arrived('a2', '2026-10-13', 20_000, 'checking', 'everyday-card'));
    b.receive(sent('s1', '2026-10-11', 20_000, 'checking', 'everyday-card'));
    expect(b.inTransit().items.map((i) => i.id)).toEqual(['a2']);
  });

  it('12.5 an arrival that names its payment pairs with that one, even when another matches first', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'everyday-card'));
    b.receive(sent('s2', '2026-10-13', 20_000, 'checking', 'everyday-card'));
    b.receive(arrived('a1', '2026-10-14', 20_000, 'checking', 'everyday-card', 's2'));
    expect(b.inTransit().items.map((i) => i.id)).toEqual(['s1']);
  });

  it('12.5 checking to savings in transit counts as already moved for what is left to move (3.8)', () => {
    const b = book();
    expect(b.savingsTransfer(300_000).stillToMove).toBe(50_000);
    b.receive(sent('s1', '2026-10-12', 30_000, 'checking', 'savings'));
    expect(b.savingsTransfer(300_000).stillToMove).toBe(20_000);
    b.receive(arrived('a1', '2026-10-13', 30_000, 'checking', 'savings', 's1'));
    expect(b.savingsTransfer(330_000).stillToMove).toBe(20_000);
  });

  it('12.5 money on its way to the old card: out of needs when it leaves, the debt goes down when it lands, never in the check', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'old-card'));
    expect(b.pots().needs).toBe(30_000);
    expect(b.oldCardDebt()).toBe(300_000);
    expect(b.selfCheck(PAID)).toMatchObject({ inTransit: 0, ok: true });
    expect(b.inTransit()).toEqual({ total: 0, items: [{ id: 's1', date: '2026-10-12', from: 'checking', to: 'old-card', amount: 20_000, seen: 'left' }] });
    b.receive(arrived('a1', '2026-10-14', 20_000, 'checking', 'old-card', 's1'));
    expect(b.oldCardDebt()).toBe(280_000);
    expect(b.pots().needs).toBe(30_000);
    expect(b.inTransit().items).toEqual([]);
    expect(b.selfCheck(PAID)).toMatchObject({ ok: true });
  });

  it('12.5 an old card payment seen landing first lowers the debt now and comes out of needs once it is seen leaving', () => {
    const b = book();
    b.receive(arrived('a1', '2026-10-12', 20_000, 'checking', 'old-card'));
    expect(b.oldCardDebt()).toBe(280_000);
    expect(b.pots().needs).toBe(50_000);
    b.receive(sent('s1', '2026-10-11', 20_000, 'checking', 'old-card'));
    expect(b.pots().needs).toBe(30_000);
    expect(b.oldCardDebt()).toBe(280_000);
  });

  it('12.5 from savings to the old card waits in review when it leaves (QUESTIONS.md A4)', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-12', 20_000, 'savings', 'old-card'));
    expect(b.pots().unsortedOut).toBe(20_000);
    expect(b.oldCardDebt()).toBe(300_000);
  });

  it('12.5 money that left checking without any transfer is still a mismatch', () => {
    expect(book().selfCheck(PAID)).toMatchObject({ inTransit: 0, difference: -20_000, ok: false });
  });

  it('12.5 each half sent twice counts once', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'everyday-card'));
    expect(b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'everyday-card')).outcome).toBe('duplicate');
    b.receive(arrived('a1', '2026-10-14', 20_000, 'checking', 'everyday-card', 's1'));
    expect(b.receive(arrived('a1', '2026-10-14', 20_000, 'checking', 'everyday-card', 's1')).outcome).toBe('duplicate');
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
  });

  it('12.5 halves that do not fit together are refused and change nothing', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'everyday-card'));
    expect(codeOf(() => b.receive(arrived('a1', '2026-10-14', 19_999, 'checking', 'everyday-card', 's1')))).toBe('bad-transaction');
    expect(codeOf(() => b.receive(arrived('a1', '2026-10-14', 20_000, 'savings', 'everyday-card', 's1')))).toBe('bad-transaction');
    b.receive(deposit('d1', '2026-10-12', 100, 'MADE UP GIFT'));
    expect(codeOf(() => b.receive(arrived('a1', '2026-10-14', 20_000, 'checking', 'everyday-card', 'd1')))).toBe('bad-transaction');
    expect(codeOf(() => b.receive(sent('s2', '2026-10-12', 20_000, 'checking', 'checking')))).toBe('bad-transaction');
    expect(codeOf(() => b.receive(sent('s2', '2026-10-12', 0, 'checking', 'savings')))).toBe('not-positive');
    expect(b.inTransit().total).toBe(20_000);
  });

  it('12.5 an arrival naming a payment the app has not seen waits for it', () => {
    const b = book();
    b.receive(arrived('a1', '2026-10-14', 20_000, 'checking', 'everyday-card', 's9'));
    b.receive(sent('s8', '2026-10-13', 20_000, 'checking', 'everyday-card'));
    expect(b.inTransit().items.map((i) => [i.id, i.seen])).toEqual([
      ['a1', 'arrived'],
      ['s8', 'left'],
    ]);
    b.receive(sent('s9', '2026-10-13', 20_000, 'checking', 'everyday-card'));
    expect(b.inTransit().items.map((i) => i.id)).toEqual(['s8']);
  });

  it('12.5 a payment that already arrived cannot arrive again', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-12', 20_000, 'checking', 'everyday-card'));
    b.receive(arrived('a1', '2026-10-14', 20_000, 'checking', 'everyday-card', 's1'));
    expect(codeOf(() => b.receive(arrived('a2', '2026-10-15', 20_000, 'checking', 'everyday-card', 's1')))).toBe('already-arrived');
    expect(b.inTransit().total).toBe(0);
  });

  it('12.5 one cent and very large amounts in transit', () => {
    const b = book();
    b.receive(sent('s1', '2026-10-12', 1, 'checking', 'savings'));
    b.receive(sent('s2', '2026-10-12', 4_000_000_000_000_000, 'savings', 'checking'));
    expect(b.inTransit().total).toBe(4_000_000_000_000_001);
  });
});
