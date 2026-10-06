// Second opinion, rulebook sections 11 (safe to spend) and 12 (daily
// self-check). Starting pots: savings 5,000.00, needs 1,000.00, wants 500.00.
// Bank: checking 3,000.00 + savings 4,000.00 - everyday card 500.00 = 6,500.00.
// Last paycheck Jan 2, paydays every 14 days -> next payday Jan 16.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bankSide, withPendingCharges, type SortingRule } from '../src/index.js';
import { Life, appSideOf } from './helpers.js';

const RULES: SortingRule[] = [{ id: 'r-grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }];

describe('11.1 safe to spend = wants left - unsorted spending', () => {
  it('11.1 500.00 - 25.50 = 474.50', () => {
    const life = new Life({ rules: RULES });
    life.buy(2550, '2026-01-06', 'MYSTERY SHOP');
    expect(life.book.safeToSpend('2026-01-06').amount).toBe(47450);
  });

  it('11.1 needs spending does not touch safe to spend', () => {
    const life = new Life({ rules: RULES });
    life.buy(90000, '2026-01-06', 'CITY GROCER');
    expect(life.book.safeToSpend('2026-01-06').amount).toBe(50000);
  });

  it('11.1 unsorted bigger than wants: negative', () => {
    // 500.00 - 600.00 = -100.00
    const life = new Life({ rules: RULES });
    life.buy(60000, '2026-01-06', 'MYSTERY SHOP');
    expect(life.book.safeToSpend('2026-01-06').amount).toBe(-10000);
  });
});

describe('11.2 days until the next payday', () => {
  it('11.2 Jan 5 -> next payday Jan 16, 11 days', () => {
    const life = new Life();
    expect(life.book.safeToSpend('2026-01-05')).toMatchObject({ nextPayday: '2026-01-16', daysToPayday: 11 });
  });

  it('11.2 the day before payday: 1 day', () => {
    const life = new Life();
    expect(life.book.safeToSpend('2026-01-15')).toMatchObject({ nextPayday: '2026-01-16', daysToPayday: 1 });
  });

  it('11.2 counted from the last paycheck', () => {
    // paycheck Jan 16 -> next payday Jan 30; on Jan 20 that is 10 days
    const life = new Life();
    life.paycheck(200000, '2026-01-16');
    expect(life.book.safeToSpend('2026-01-20')).toMatchObject({ nextPayday: '2026-01-30', daysToPayday: 10 });
  });
});

describe('11.3 savings, reserve, held for others, unsorted money in are never part of it', () => {
  it('11.3 none of them change safe to spend', () => {
    const life = new Life({ pots: { momReserve: 100000, heldForOthers: 20000 }, bank: { checking: 420000 } });
    life.deposit(30000, '2026-01-07', 'TAX REFUND'); // unsorted money in
    const notMine = life.deposit(10000, '2026-01-07', 'ZELLE FROM ROOMMATE');
    life.book.sort(notMine.id, { to: 'not-mine' }, '2026-01-07');
    expect(life.book.safeToSpend('2026-01-07').amount).toBe(50000);
    life.expectBalanced();
  });
});

describe('12.1 bank side = checking + savings - everyday card, with pending charges', () => {
  it('12.1 pending charges are added to the balances', () => {
    // checking 1,000.00 - pending 15.00 = 985.00
    // card 200.00 + pending 25.00 = 225.00
    // old card pending ignored (12.4)
    const bank = withPendingCharges({ checking: 100000, savings: 0, everydayCard: 20000 }, [
      { account: 'checking', amount: 1500 },
      { account: 'everyday-card', amount: 2500 },
      { account: 'old-card', amount: 999 },
    ]);
    expect(bank).toEqual({ checking: 98500, savings: 0, everydayCard: 22500 });
    // 985.00 + 0 - 225.00 = 760.00
    expect(bankSide(bank)).toBe(76000);
  });

  it('12.1 bank side formula', () => {
    // 3,000.00 + 4,000.00 - 500.00 = 6,500.00
    expect(bankSide({ checking: 300000, savings: 400000, everydayCard: 50000 })).toBe(650000);
  });

  it('12.1 a pending charge balances because it already counts in the buckets', () => {
    const life = new Life({ rules: RULES });
    life.buy(4321, '2026-01-06', 'CITY GROCER', { pending: true });
    const check = life.book.selfCheck(life.bank());
    expect(check.bankSide).toBe(650000 - 4321);
    expect(check.ok).toBe(true);
  });
});

describe('12.2 app side', () => {
  it('12.2 savings + needs + wants + reserve + held + unsorted in - unsorted spending', () => {
    // pots: 5,000 + 1,000 + 500 + 1,000 + 200 = 7,700.00
    // + unsorted in 300.00 - unsorted out 45.00 = 7,955.00
    const life = new Life({ pots: { momReserve: 100000, heldForOthers: 20000 }, bank: { checking: 420000 } });
    life.deposit(30000, '2026-01-07', 'TAX REFUND');
    life.buy(4500, '2026-01-07', 'MYSTERY SHOP');
    const check = life.book.selfCheck(life.bank());
    expect(check.appSide).toBe(795500);
    expect(check.appSide).toBe(appSideOf(life.book));
    expect(check.ok).toBe(true);
  });
});

describe('12.3 the two sides must be equal, else a warning with the difference', () => {
  it('12.3 equal: ok', () => {
    const life = new Life();
    expect(life.book.selfCheck(life.bank())).toMatchObject({ bankSide: 650000, appSide: 650000, inTransit: 0, difference: 0, ok: true });
  });

  it('12.3 one cent off: not ok, difference 0.01', () => {
    const life = new Life();
    const check = life.book.selfCheck({ ...life.bank(), savings: 400001 });
    expect(check.ok).toBe(false);
    expect(Math.abs(check.difference)).toBe(1);
  });

  it('12.3 a large gap', () => {
    const life = new Life();
    const check = life.book.selfCheck({ ...life.bank(), everydayCard: 50000 + 100000000 });
    expect(check.ok).toBe(false);
    expect(Math.abs(check.difference)).toBe(100000000);
  });
});

describe('12.4 the old card is tracked separately and is not in the check', () => {
  it('12.4 old card purchase and interest leave the check balanced with the same bank', () => {
    const life = new Life();
    life.buy(50000, '2026-01-06', 'HARDWARE', { account: 'old-card' });
    life.feed({ kind: 'card-charge', id: 'oi', account: 'old-card', date: '2026-01-07', amount: 2000, description: 'INTEREST', charge: 'interest' });
    // debt 3,000 + 500 + 20 = 3,520.00
    expect(life.book.oldCardDebt()).toBe(352000);
    expect(life.book.selfCheck(life.bank())).toMatchObject({ bankSide: 650000, appSide: 650000, ok: true });
  });
});

describe('12.5 money in transit', () => {
  it('12.5 card payment on its way: bank side + in transit = app side', () => {
    const life = new Life();
    const sent = life.feed({ kind: 'transfer-sent', id: 's1', from: 'checking', to: 'everyday-card', date: '2026-01-07', amount: 20000, description: 'CARD PAYMENT' });
    // bank: 2,800 + 4,000 - 500 = 6,300.00; in transit 200.00; app 6,500.00
    expect(life.book.selfCheck(life.bank())).toMatchObject({ bankSide: 630000, inTransit: 20000, appSide: 650000, ok: true });
    expect(life.book.inTransit().total).toBe(20000);
    life.feed({ kind: 'transfer-arrived', id: 'a1', from: 'checking', to: 'everyday-card', date: '2026-01-09', amount: 20000, description: 'PAYMENT RECEIVED', sentId: sent.id });
    // bank: 2,800 + 4,000 - 300 = 6,500.00
    expect(life.book.selfCheck(life.bank())).toMatchObject({ bankSide: 650000, inTransit: 0, appSide: 650000, ok: true });
    expect(life.book.pots()).toMatchObject({ savings: 500000, needs: 100000, wants: 50000 });
  });

  it('12.5 checking to savings on its way: no bucket change, in transit counted', () => {
    const life = new Life();
    const sent = life.feed({ kind: 'transfer-sent', id: 's2', from: 'checking', to: 'savings', date: '2026-01-07', amount: 50000, description: 'TO SAVINGS' });
    expect(life.book.selfCheck(life.bank())).toMatchObject({ inTransit: 50000, ok: true });
    expect(life.book.pots()).toMatchObject({ savings: 500000, needs: 100000, wants: 50000 });
    life.feed({ kind: 'transfer-arrived', id: 'a2', from: 'checking', to: 'savings', date: '2026-01-08', amount: 50000, description: 'FROM CHECKING', sentId: sent.id });
    expect(life.book.selfCheck(life.bank())).toMatchObject({ inTransit: 0, ok: true });
  });

  it('12.5 old card payment on its way: shown, not counted; needs drops when it leaves; debt when it lands', () => {
    const life = new Life();
    const sent = life.feed({ kind: 'transfer-sent', id: 's3', from: 'checking', to: 'old-card', date: '2026-01-07', amount: 15000, description: 'OLD CARD PAYMENT' });
    // needs 1,000 - 150 = 850.00 now; debt still 3,000.00
    expect(life.book.pots().needs).toBe(85000);
    expect(life.book.oldCardDebt()).toBe(300000);
    expect(life.book.inTransit().items.map((i) => ({ to: i.to, amount: i.amount }))).toEqual([{ to: 'old-card', amount: 15000 }]);
    // bank 2,850 + 4,000 - 500 = 6,350.00; app 6,350.00; in transit counted 0
    expect(life.book.selfCheck(life.bank())).toMatchObject({ bankSide: 635000, inTransit: 0, appSide: 635000, ok: true });
    life.feed({ kind: 'transfer-arrived', id: 'a3', from: 'checking', to: 'old-card', date: '2026-01-09', amount: 15000, description: 'PAYMENT RECEIVED', sentId: sent.id });
    // debt 3,000 - 150 = 2,850.00; needs unchanged at 850.00
    expect(life.book.oldCardDebt()).toBe(285000);
    expect(life.book.pots().needs).toBe(85000);
    expect(life.book.inTransit().items).toEqual([]);
    life.expectBalanced();
  });
});

describe('12.3 random days: the self-check holds after every transaction', () => {
  it('12.3 random mixes of paychecks, purchases, refunds, transfers and sorting', () => {
    const step = fc.oneof(
      fc.record({ k: fc.constant('dep' as const), amount: fc.integer({ min: 1, max: 500000 }) }),
      fc.record({ k: fc.constant('buy' as const), amount: fc.integer({ min: 1, max: 100000 }), sorted: fc.boolean(), card: fc.boolean() }),
      fc.record({ k: fc.constant('cardpay' as const), amount: fc.integer({ min: 1, max: 100000 }) }),
      fc.record({ k: fc.constant('save' as const), amount: fc.integer({ min: 1, max: 100000 }), toSavings: fc.boolean() }),
      fc.record({ k: fc.constant('notmine' as const), amount: fc.integer({ min: 1, max: 100000 }) }),
    );
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 28 }), (steps) => {
        const life = new Life({ rules: RULES });
        let day = 0;
        for (const s of steps) {
          day += 1;
          // one step a day, Feb 1 to Feb 28
          const d = `2026-02-${String(day).padStart(2, '0')}`;
          const before = life.book.pots();
          if (s.k === 'dep') {
            life.deposit(s.amount, d, 'TAX REFUND');
          } else if (s.k === 'buy') {
            life.buy(s.amount, d, s.sorted ? 'CITY GROCER' : 'MYSTERY', { account: s.card ? 'everyday-card' : 'checking' });
          } else if (s.k === 'cardpay') {
            life.transfer(s.amount, d, 'checking', 'everyday-card');
            // 5.1: no bucket changes
            expect(life.book.pots()).toEqual(before);
          } else if (s.k === 'save') {
            life.transfer(s.amount, d, s.toSavings ? 'checking' : 'savings', s.toSavings ? 'savings' : 'checking');
            // 5.3: no bucket changes
            expect(life.book.pots()).toEqual(before);
          } else {
            const r = life.deposit(s.amount, d, 'ZELLE FROM ROOMMATE');
            life.book.sort(r.id, { to: 'not-mine' }, d);
          }
          life.expectBalanced();
        }
      }),
      { numRuns: 300 },
    );
  });
});
