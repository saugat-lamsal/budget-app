// Second opinion, rulebook sections 6 (deposits that are not a paycheck),
// 7 (other people's money) and 8 (mom). Starting pots: savings 5,000.00,
// needs 1,000.00, wants 500.00, reserve 0 unless a test says otherwise.
// The mom rule is "PAT SAMPLE" (made-up name).

import { describe, expect, it } from 'vitest';
import { type SortingRule } from '../src/index.js';
import { Life, MOM } from './helpers.js';

describe('6.1 a deposit that is not a paycheck goes to review with four choices', () => {
  it('6.1 it waits in review as unsorted money in', () => {
    const life = new Life();
    const r = life.deposit(30000, '2026-01-07', 'TAX REFUND');
    expect(r.outcome).toBe('review');
    expect(life.book.reviewItems().find((i) => i.id === r.id)).toMatchObject({ type: 'money-in', reason: 'deposit', amount: 30000 });
    expect(life.book.pots()).toMatchObject({ savings: 500000, needs: 100000, wants: 50000, unsortedIn: 30000 });
    life.expectBalanced();
  });

  it('6.1 "this is my paycheck": reserve first, then split, new period', () => {
    // 2,000.00: reserve 1,500; rest 500 -> savings 250, needs 150, wants 100
    const life = new Life();
    const start = life.book.period().number;
    const r = life.deposit(200000, '2026-01-16', 'NEW EMPLOYER INC');
    life.book.sort(r.id, { to: 'paycheck' }, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 525000, needs: 115000, wants: 60000, momReserve: 150000, unsortedIn: 0 });
    expect(life.book.period().number).toBe(start + 1);
    life.expectBalanced();
  });

  it('6.1 "other income": split only, no reserve, no new period', () => {
    // 100.00: savings 50.00, needs 30.00, wants 20.00
    const life = new Life();
    const start = life.book.period().number;
    const r = life.deposit(10000, '2026-01-07', 'SIDE GIG');
    life.book.sort(r.id, { to: 'other-income' }, '2026-01-07');
    expect(life.book.pots()).toMatchObject({ savings: 505000, needs: 103000, wants: 52000, momReserve: 0, unsortedIn: 0 });
    expect(life.book.period().number).toBe(start);
    life.expectBalanced();
  });

  it('6.1 "other income" rounding cents go to savings', () => {
    // 100.01 = 10,001: needs 3,000.3 -> 3,000; wants 2,000.2 -> 2,000; savings 5,001
    const life = new Life();
    const r = life.deposit(10001, '2026-01-07', 'SIDE GIG');
    life.book.sort(r.id, { to: 'other-income' }, '2026-01-07');
    expect(life.book.pots()).toMatchObject({ savings: 505001, needs: 103000, wants: 52000 });
    life.expectBalanced();
  });

  it('6.1 "payback": goes into the bucket picked', () => {
    // wants 500 + 45 = 545.00
    const life = new Life();
    const r = life.deposit(4500, '2026-01-07', 'ZELLE FROM SAM');
    life.book.sort(r.id, { to: 'wants' }, '2026-01-07');
    expect(life.book.pots()).toMatchObject({ wants: 54500, needs: 100000, savings: 500000, unsortedIn: 0 });
    life.expectBalanced();
  });

  it('6.1 "not mine": goes to held for others', () => {
    const life = new Life();
    const r = life.deposit(30000, '2026-01-07', 'ZELLE FROM SAM');
    life.book.sort(r.id, { to: 'not-mine' }, '2026-01-07');
    expect(life.book.pots()).toMatchObject({ heldForOthers: 30000, savings: 500000, needs: 100000, wants: 50000, unsortedIn: 0 });
    life.expectBalanced();
  });
});

describe('6.2 a rule can make the deposit choice automatic', () => {
  it('6.2 known source marked not mine automatically', () => {
    const rules: SortingRule[] = [{ id: 'd1', for: 'deposit', contains: 'VENMO FROM ALEX', choice: { to: 'not-mine' } }];
    const life = new Life({ rules });
    const r = life.deposit(6000, '2026-01-07', 'VENMO FROM ALEX');
    expect(life.book.reviewItems().find((i) => i.id === r.id)).toBeUndefined();
    expect(life.book.pots()).toMatchObject({ heldForOthers: 6000, unsortedIn: 0 });
    life.expectBalanced();
  });

  it('6.2 known source as other income is split automatically', () => {
    // 200.00: savings 100, needs 60, wants 40
    const rules: SortingRule[] = [{ id: 'd2', for: 'deposit', contains: 'ETSY PAYOUT', choice: { to: 'other-income' } }];
    const life = new Life({ rules });
    life.deposit(20000, '2026-01-07', 'ETSY PAYOUT 123');
    expect(life.book.pots()).toMatchObject({ savings: 510000, needs: 106000, wants: 54000, unsortedIn: 0 });
    life.expectBalanced();
  });
});

describe('7.1 a deposit marked not mine adds to held for others', () => {
  it('7.1 it is not income and not split', () => {
    const life = new Life();
    const r = life.deposit(25000, '2026-01-07', 'ZELLE FROM ROOMMATE');
    life.book.sort(r.id, { to: 'not-mine' }, '2026-01-07');
    expect(life.book.pots()).toMatchObject({ heldForOthers: 25000, savings: 500000, needs: 100000, wants: 50000, momReserve: 0 });
    life.expectBalanced();
  });
});

describe('7.2 a payment out marked not mine lowers held for others', () => {
  it('7.2 it is not spending', () => {
    // held 250.00 - 250.00 = 0; buckets unchanged
    const life = new Life({ pots: { heldForOthers: 25000 }, bank: { checking: 325000 } });
    const r = life.payPerson(25000, '2026-01-08', 'ZELLE TO LANDLORD');
    life.book.sort(r.id, { to: 'not-mine' }, '2026-01-08');
    expect(life.book.pots()).toMatchObject({ heldForOthers: 0, needs: 100000, wants: 50000, savings: 500000, unsortedOut: 0 });
    life.expectBalanced();
  });
});

describe('7.3 held for others is its own number; negative means someone owes you', () => {
  it('7.3 settled, holding, owed', () => {
    const life = new Life();
    expect(life.book.othersMoney()).toEqual({ heldForOthers: 0, meaning: 'settled' });
    const d = life.deposit(12000, '2026-01-07', 'ZELLE FROM ROOMMATE');
    life.book.sort(d.id, { to: 'not-mine' }, '2026-01-07');
    expect(life.book.othersMoney()).toEqual({ heldForOthers: 12000, meaning: 'holding-for-others' });
    // 120.00 - 150.00 = -30.00
    const p = life.payPerson(15000, '2026-01-08', 'ZELLE TO LANDLORD');
    life.book.sort(p.id, { to: 'not-mine' }, '2026-01-08');
    expect(life.book.othersMoney()).toEqual({ heldForOthers: -3000, meaning: 'owed-to-you' });
    life.expectBalanced();
  });
});

describe('7.4 payments to people go to review unless a rule covers the person', () => {
  it('7.4 no rule: review', () => {
    const life = new Life();
    const r = life.payPerson(4000, '2026-01-08', 'ZELLE TO SAM');
    expect(life.book.reviewItems().find((i) => i.id === r.id)).toMatchObject({ type: 'spending', reason: 'person-payment' });
    expect(life.book.pots()).toMatchObject({ needs: 100000, wants: 50000, unsortedOut: 4000 });
    life.expectBalanced();
  });

  it('7.4 with a rule for the person: sorted automatically', () => {
    // wants 500 - 40 = 460.00
    const rules: SortingRule[] = [{ id: 'p1', for: 'person', contains: 'ZELLE TO SAM', choice: { to: 'wants' } }];
    const life = new Life({ rules });
    const r = life.payPerson(4000, '2026-01-08', 'ZELLE TO SAM');
    expect(life.book.reviewItems().find((i) => i.id === r.id)).toBeUndefined();
    expect(life.book.pots()).toMatchObject({ wants: 46000, unsortedOut: 0 });
    life.expectBalanced();
  });
});

describe('7.5 a friend paying you back is a payback', () => {
  it('7.5 payback into needs', () => {
    // needs 1,000 + 22.50 = 1,022.50
    const life = new Life();
    const r = life.deposit(2250, '2026-01-09', 'VENMO FROM SAM');
    life.book.sort(r.id, { to: 'needs' }, '2026-01-09');
    expect(life.book.pots()).toMatchObject({ needs: 102250, unsortedIn: 0 });
    life.expectBalanced();
  });
});

// Reserve 1,500.00 to start: bank checking 3,000 + 1,500 = 4,500.00
const WITH_RESERVE = { pots: { momReserve: 150000 }, bank: { checking: 450000 } };

describe('8.1 a mom payment comes out of the mom reserve, any day, any amount', () => {
  it('8.1 400.00 to mom: reserve 1,100.00, buckets unchanged', () => {
    const life = new Life(WITH_RESERVE);
    life.payPerson(40000, '2026-01-09', `ZELLE TO ${MOM}`);
    expect(life.book.pots()).toMatchObject({ momReserve: 110000, needs: 100000, wants: 50000, savings: 500000, unsortedOut: 0 });
    life.expectBalanced();
  });

  it('8.1 one cent on the last day of the month', () => {
    const life = new Life(WITH_RESERVE);
    life.payPerson(1, '2026-01-31', `ZELLE TO ${MOM}`);
    expect(life.book.pots().momReserve).toBe(149999);
    life.expectBalanced();
  });

  it('8.1 exactly the whole reserve: reserve 0, nothing to review', () => {
    const life = new Life(WITH_RESERVE);
    life.payPerson(150000, '2026-01-09', `ZELLE TO ${MOM}`);
    expect(life.book.pots().momReserve).toBe(0);
    expect(life.book.reviewItems()).toHaveLength(0);
    life.expectBalanced();
  });
});

describe('8.2 sent to mom this calendar month against the target', () => {
  it('8.2 January and February counted separately', () => {
    // Jan: 400 + 300 = 700.00; Feb: 200.00
    const life = new Life(WITH_RESERVE);
    life.payPerson(40000, '2026-01-10', `ZELLE TO ${MOM}`);
    life.payPerson(30000, '2026-01-31', `ZELLE TO ${MOM}`);
    life.payPerson(20000, '2026-02-01', `ZELLE TO ${MOM}`);
    expect(life.book.momSentInMonth('2026-01')).toEqual({ month: '2026-01', sent: 70000, target: { low: 200000, high: 300000 } });
    expect(life.book.momSentInMonth('2026-02').sent).toBe(20000);
  });
});

describe('8.3 a mom payment bigger than the reserve asks which bucket covers the rest', () => {
  it('8.3 reserve 500.00, payment 800.00: reserve 0, 300.00 to review; needs covers it', () => {
    // bank checking 3,000 + 500 = 3,500.00
    const life = new Life({ pots: { momReserve: 50000 }, bank: { checking: 350000 } });
    life.payPerson(80000, '2026-01-09', `ZELLE TO ${MOM}`);
    expect(life.book.pots().momReserve).toBe(0);
    const item = life.book.reviewItems().find((i) => i.type === 'spending' && i.reason === 'mom-difference');
    expect(item).toMatchObject({ amount: 30000 });
    life.expectBalanced();
    // needs 1,000 - 300 = 700.00
    life.book.sort(item!.id, { to: 'needs' }, '2026-01-09');
    expect(life.book.pots()).toMatchObject({ needs: 70000, momReserve: 0, unsortedOut: 0 });
    life.expectBalanced();
  });

  it('8.3 one cent over the reserve', () => {
    const life = new Life({ pots: { momReserve: 50000 }, bank: { checking: 350000 } });
    life.payPerson(50001, '2026-01-09', `ZELLE TO ${MOM}`);
    const item = life.book.reviewItems().find((i) => i.type === 'spending' && i.reason === 'mom-difference');
    expect(item).toMatchObject({ amount: 1 });
    expect(life.book.pots().momReserve).toBe(0);
    life.expectBalanced();
  });
});

describe('8.4 the reserve carries over between months, up to its cap', () => {
  it('8.4 January reserve carries into February paychecks', () => {
    // reserve 1,000.00 at end of January (bank checking 3,000 + 1,000)
    // Feb 6 paycheck 2,000: reserve 1,000 + 1,500 = 2,500.00; savings +250
    // Feb 20 paycheck 2,000: room 500 -> reserve 3,000.00; overflow 1,000 + 250 to savings
    // savings 5,000 + 250 + 1,250 = 6,500.00
    const life = new Life({ date: '2026-01-24', lastPaycheckDate: '2026-01-23', pots: { momReserve: 100000 }, bank: { checking: 400000 } });
    life.paycheck(200000, '2026-02-06');
    expect(life.book.pots().momReserve).toBe(250000);
    life.paycheck(200000, '2026-02-20');
    expect(life.book.pots()).toMatchObject({ momReserve: 300000, savings: 650000 });
    life.expectBalanced();
  });
});
