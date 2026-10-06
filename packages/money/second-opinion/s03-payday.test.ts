// Second opinion, rulebook section 3 (payday). Expected numbers are worked
// out by hand from the rulebook; the arithmetic is in the comments.
// Settings are section 2: split 50/30/20, reserve 1,500.00 per paycheck,
// cap 3,000.00, early-paycheck window 10 days, paydays every 14 days.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { splitPaycheck } from '../src/index.js';
import { Life, SETTINGS } from './helpers.js';

describe('3.1 a paycheck starts a new pay period', () => {
  it('3.1 matching deposit is a paycheck and starts a new period', () => {
    const life = new Life();
    const before = life.book.period().number;
    const r = life.paycheck(200000, '2026-01-16');
    expect(r.outcome).toBe('paycheck');
    expect(life.book.period().number).toBe(before + 1);
    expect(life.book.period().startDate).toBe('2026-01-16');
    expect(life.book.lastPaycheckDate()).toBe('2026-01-16');
    expect(life.book.paychecks()).toHaveLength(1);
    life.expectBalanced();
  });

  it('3.1 a deposit that does not match the paycheck rule does not start a period', () => {
    const life = new Life();
    const before = life.book.period().number;
    life.deposit(200000, '2026-01-16', 'SOMEONE ELSE');
    expect(life.book.period().number).toBe(before);
    expect(life.book.paychecks()).toHaveLength(0);
  });
});

describe('3.2 the mom reserve comes off first', () => {
  it('3.2 reserve below cap takes the full 1,500.00 first', () => {
    // paycheck 2,000.00, reserve 0
    // reserve takes 1,500.00 -> rest 500.00
    // savings 50% = 250.00, needs 30% = 150.00, wants 20% = 100.00
    // pots: savings 5,000 + 250 = 5,250.00; needs 1,000 + 150 = 1,150.00;
    //       wants 500 + 100 = 600.00; reserve 0 + 1,500 = 1,500.00
    const life = new Life();
    life.paycheck(200000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 525000, needs: 115000, wants: 60000, momReserve: 150000 });
    life.expectBalanced();
  });

  it('3.2 the part that does not fit under the cap goes to savings', () => {
    // reserve 2,000.00, cap 3,000.00 -> room 1,000.00
    // 1,500.00 comes off: 1,000.00 to reserve, 500.00 to savings
    // rest 500.00 -> savings 250.00, needs 150.00, wants 100.00
    // savings 5,000 + 500 + 250 = 5,750.00; reserve 3,000.00
    const life = new Life({ pots: { momReserve: 200000 }, bank: { checking: 500000 } });
    life.paycheck(200000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 575000, needs: 115000, wants: 60000, momReserve: 300000 });
    life.expectBalanced();
  });

  it('3.2 exactly at the cap: the whole 1,500.00 goes to savings', () => {
    // reserve 3,000.00 = cap -> room 0
    // savings 5,000 + 1,500 + 250 = 6,750.00; reserve stays 3,000.00
    const life = new Life({ pots: { momReserve: 300000 }, bank: { checking: 600000 } });
    life.paycheck(200000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 675000, needs: 115000, wants: 60000, momReserve: 300000 });
    life.expectBalanced();
  });

  it('3.2 one cent below the cap: one cent to the reserve, the rest of 1,500.00 to savings', () => {
    // reserve 2,999.99 -> room 0.01
    // reserve +0.01 = 3,000.00; overflow 1,499.99 to savings
    // savings 5,000 + 1,499.99 + 250 = 6,749.99
    const life = new Life({ pots: { momReserve: 299999 }, bank: { checking: 599999 } });
    life.paycheck(200000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 674999, needs: 115000, wants: 60000, momReserve: 300000 });
    life.expectBalanced();
  });

  it('3.2 a paycheck smaller than the reserve all goes to the reserve', () => {
    // paycheck 1,000.00 < 1,500.00 -> reserve takes 1,000.00, rest 0
    const life = new Life();
    life.paycheck(100000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 500000, needs: 100000, wants: 50000, momReserve: 100000 });
    life.expectBalanced();
  });

  it('3.2 a small paycheck near the cap: fills the cap, the rest to savings', () => {
    // reserve 2,500.00, room 500.00; paycheck 1,000.00 all comes off as reserve
    // 500.00 to reserve (now 3,000.00), 500.00 to savings, rest 0
    const life = new Life({ pots: { momReserve: 250000 }, bank: { checking: 550000 } });
    life.paycheck(100000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 550000, needs: 100000, wants: 50000, momReserve: 300000 });
    life.expectBalanced();
  });

  it('3.2 a one-cent paycheck goes to the reserve', () => {
    const split = splitPaycheck(1, 0, SETTINGS);
    expect(split).toMatchObject({ momReserve: 1, savings: 0, needs: 0, wants: 0 });
  });

  it('3.2 a very large paycheck', () => {
    // paycheck 1,000,000.00 = 100,000,000 cents, reserve 0
    // reserve 150,000; rest 99,850,000
    // savings 49,925,000; needs 29,955,000; wants 19,970,000
    const split = splitPaycheck(100000000, 0, SETTINGS);
    expect(split).toMatchObject({ momReserve: 150000, savings: 49925000, needs: 29955000, wants: 19970000 });
  });
});

describe('3.3 the rest is split by percentages; rounding cents go to savings', () => {
  it('3.3 leftover rounding cents go to savings (rest 100.01)', () => {
    // paycheck 1,600.01, reserve 0 -> reserve 1,500.00, rest 100.01 = 10,001 cents
    // needs 30% = 3,000.3 -> 3,000; wants 20% = 2,000.2 -> 2,000
    // savings = 10,001 - 3,000 - 2,000 = 5,001 (50% is 5,000.5; the cent goes to savings)
    const split = splitPaycheck(160001, 0, SETTINGS);
    expect(split).toMatchObject({ momReserve: 150000, savings: 5001, needs: 3000, wants: 2000 });
  });

  it('3.3 rest of one cent goes to savings', () => {
    // rest 1 cent: needs 0.3 -> 0, wants 0.2 -> 0, savings 1
    const split = splitPaycheck(150001, 0, SETTINGS);
    expect(split).toMatchObject({ momReserve: 150000, savings: 1, needs: 0, wants: 0 });
  });

  it('3.3 random paychecks: the parts always add up to the paycheck exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100000000 }), fc.integer({ min: 0, max: 300000 }), (amount, reserveNow) => {
        const s = splitPaycheck(amount, reserveNow, SETTINGS);
        for (const part of [s.momReserve, s.savings, s.needs, s.wants]) {
          expect(Number.isInteger(part)).toBe(true);
          expect(part).toBeGreaterThanOrEqual(0);
        }
        expect(s.momReserve + s.savings + s.needs + s.wants).toBe(amount);
        // the reserve never goes over its cap (3.2)
        expect(reserveNow + s.momReserve).toBeLessThanOrEqual(300000);
        // what comes off first is min(paycheck, 1,500.00); the rest is split.
        // needs and wants are within one cent of their exact share whichever way
        // the rounding goes.
        const rest = amount - Math.min(amount, 150000);
        expect(Math.abs(s.needs - rest * 0.3)).toBeLessThan(1);
        expect(Math.abs(s.wants - rest * 0.2)).toBeLessThan(1);
      }),
      { numRuns: 2000 },
    );
  });
});

describe('3.4 unspent needs and wants at payday: roll over or move to savings', () => {
  it('3.4 "ask": the money stays put until answered, then moves', () => {
    // before payday: needs 1,000.00, wants 500.00
    // paycheck 2,000.00 -> savings +250, needs +150, wants +100, reserve +1,500
    // needs 1,150.00, wants 600.00, savings 5,250.00 (leftovers not moved yet)
    const life = new Life({ settings: { leftoverAtPayday: { needs: 'ask', wants: 'ask' } } });
    life.paycheck(200000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 525000, needs: 115000, wants: 60000 });
    const items = life.book.reviewItems().filter((i) => i.type === 'leftover');
    const needsItem = items.find((i) => i.type === 'leftover' && i.bucket === 'needs');
    const wantsItem = items.find((i) => i.type === 'leftover' && i.bucket === 'wants');
    expect(needsItem).toMatchObject({ amount: 100000 });
    expect(wantsItem).toMatchObject({ amount: 50000 });

    // needs leftover 1,000.00 to savings: needs 1,150 - 1,000 = 150.00,
    // savings 5,250 + 1,000 = 6,250.00. wants rolls over: stays 600.00.
    life.book.answerLeftover(needsItem!.id, 'move-to-savings', '2026-01-16');
    life.book.answerLeftover(wantsItem!.id, 'roll-over', '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 625000, needs: 15000, wants: 60000 });
    expect(life.book.reviewItems().filter((i) => i.type === 'leftover')).toHaveLength(0);
    life.expectBalanced();
  });

  it('3.4 each bucket separately: needs always to savings, wants always roll over', () => {
    // needs: 1,000 leftover to savings -> needs 150.00, savings 5,250 + 1,000 = 6,250.00
    // wants: 500 + 100 = 600.00
    const life = new Life({ settings: { leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } } });
    life.paycheck(200000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 625000, needs: 15000, wants: 60000 });
    expect(life.book.reviewItems().filter((i) => i.type === 'leftover')).toHaveLength(0);
    life.expectBalanced();
  });

  it('3.4 unanswered leftover can still be moved by hand later', () => {
    const life = new Life({ settings: { leftoverAtPayday: { needs: 'ask', wants: 'ask' } } });
    life.paycheck(200000, '2026-01-16');
    // hand move wants -> savings 300.00: wants 600 - 300 = 300.00, savings 5,250 + 300 = 5,550.00
    const r = life.book.moveMoney({ from: 'wants', to: 'savings', amount: 30000 }, '2026-01-20');
    expect(r).toEqual({ moved: true });
    expect(life.book.pots()).toMatchObject({ savings: 555000, wants: 30000 });
    life.expectBalanced();
  });
});

describe('3.5 an overspent bucket carries over as a negative', () => {
  it('3.5 negative needs is not moved to savings and the next period starts smaller', () => {
    // needs -50.00 before payday; leftover setting move-to-savings, but nothing is unspent
    // needs -50 + 150 = 100.00; savings 5,000 + 250 = 5,250.00
    // bank: pots 5,000 - 50 + 500 = 5,450.00 -> checking 1,950.00 + savings 4,000 - card 500
    const life = new Life({
      pots: { needs: -5000 },
      bank: { checking: 195000 },
      settings: { leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } },
    });
    life.paycheck(200000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 525000, needs: 10000, wants: 60000 });
    life.expectBalanced();
  });

  it('3.5 "ask" does not ask about a negative bucket; it simply carries', () => {
    const life = new Life({
      pots: { wants: -1 },
      bank: { checking: 249999 },
      settings: { leftoverAtPayday: { needs: 'ask', wants: 'ask' } },
    });
    // wants -0.01 + 100.00 = 99.99
    life.paycheck(200000, '2026-01-16');
    expect(life.book.pots().wants).toBe(9999);
    const wantsItems = life.book.reviewItems().filter((i) => i.type === 'leftover' && i.bucket === 'wants');
    expect(wantsItems).toHaveLength(0);
  });
});

describe('3.6 a third paycheck in a month is handled like any other', () => {
  it('3.6 three January paychecks each split and each start a period', () => {
    // last paycheck Dec 19; paychecks Jan 2, Jan 16, Jan 30 (14 days apart)
    // each 2,000.00:
    //   #1 reserve 0 -> 1,500; overflow 0
    //   #2 reserve 1,500 -> 3,000; overflow 0
    //   #3 reserve at cap -> overflow 1,500 to savings
    // savings 5,000 + 3 x 250 + 1,500 = 7,250.00
    // needs 1,000 + 3 x 150 = 1,450.00; wants 500 + 3 x 100 = 800.00
    const life = new Life({ date: '2025-12-20', lastPaycheckDate: '2025-12-19' });
    const start = life.book.period().number;
    life.paycheck(200000, '2026-01-02');
    life.paycheck(200000, '2026-01-16');
    const r = life.paycheck(200000, '2026-01-30');
    expect(r.outcome).toBe('paycheck');
    expect(life.book.period().number).toBe(start + 3);
    expect(life.book.pots()).toMatchObject({ savings: 725000, needs: 145000, wants: 80000, momReserve: 300000 });
    life.expectBalanced();
  });
});

describe('3.7 a paycheck less than 10 days after the last one goes to review', () => {
  it('3.7 nine days after: review, no split, no new period', () => {
    // last paycheck Jan 2; Jan 11 is 9 days later
    const life = new Life();
    const start = life.book.period().number;
    const r = life.paycheck(200000, '2026-01-11');
    expect(r.outcome).toBe('review');
    expect(life.book.period().number).toBe(start);
    expect(life.book.pots()).toMatchObject({ savings: 500000, needs: 100000, wants: 50000, momReserve: 0, unsortedIn: 200000 });
    const item = life.book.reviewItems().find((i) => i.type === 'money-in');
    expect(item).toMatchObject({ reason: 'early-paycheck', amount: 200000 });
    life.expectBalanced();
  });

  it('3.7 exactly ten days after: splits as a paycheck', () => {
    const life = new Life();
    const r = life.paycheck(200000, '2026-01-12');
    expect(r.outcome).toBe('paycheck');
    expect(life.book.pots()).toMatchObject({ savings: 525000, needs: 115000, wants: 60000, momReserve: 150000, unsortedIn: 0 });
  });

  it('3.7 a held paycheck answered "this is my paycheck" splits like any paycheck', () => {
    const life = new Life();
    const start = life.book.period().number;
    const r = life.paycheck(200000, '2026-01-11');
    life.book.sort(r.id, { to: 'paycheck' }, '2026-01-11');
    // same as 3.2: savings 5,250, needs 1,150, wants 600, reserve 1,500
    expect(life.book.pots()).toMatchObject({ savings: 525000, needs: 115000, wants: 60000, momReserve: 150000, unsortedIn: 0 });
    expect(life.book.period().number).toBe(start + 1);
    life.expectBalanced();
  });

  it('3.7 a held paycheck answered "other income" is split only, no reserve', () => {
    // 2,000.00 split 50/30/20: savings +1,000, needs +600, wants +400
    const life = new Life();
    const start = life.book.period().number;
    const r = life.paycheck(200000, '2026-01-11');
    life.book.sort(r.id, { to: 'other-income' }, '2026-01-11');
    expect(life.book.pots()).toMatchObject({ savings: 600000, needs: 160000, wants: 90000, momReserve: 0, unsortedIn: 0 });
    expect(life.book.period().number).toBe(start);
    life.expectBalanced();
  });
});

describe('3.8 payday tells how much should be in the savings account', () => {
  it('3.8 should be savings + reserve; still to move is the gap', () => {
    // after paycheck: savings 5,250.00 + reserve 1,500.00 = 6,750.00
    // savings account holds 4,000.00 -> still to move 2,750.00
    const life = new Life();
    life.paycheck(200000, '2026-01-16');
    expect(life.book.savingsTransfer(400000)).toEqual({
      shouldBeInSavings: 675000,
      savingsAccountBalance: 400000,
      stillToMove: 275000,
    });
  });

  it('3.8 nothing left to move when the account already matches', () => {
    const life = new Life();
    life.paycheck(200000, '2026-01-16');
    expect(life.book.savingsTransfer(675000).stillToMove).toBe(0);
  });
});
