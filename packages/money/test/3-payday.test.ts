import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, changeSettings, splitPaycheck } from '../src/index.js';
import { codeOf, deposit, openTestBook, paycheck, sent, LAST_PAYCHECK } from './helpers.js';

const RULES = DEFAULT_SETTINGS; // 50/30/20, $1,500 reserve, $3,000 cap

describe('3.1 a paycheck starts a new pay period', () => {
  it('3.1 a deposit that matches the paycheck rule is a paycheck and starts a new pay period', () => {
    const book = openTestBook();
    expect(book.period()).toEqual({ number: 0, startDate: '2026-10-01' });
    const result = book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(result).toEqual({ id: 'p1', outcome: 'paycheck' });
    expect(book.period()).toEqual({ number: 1, startDate: '2026-10-09' });
    expect(book.lastPaycheckDate()).toBe('2026-10-09');
    expect(book.paychecks().map((p) => p.id)).toEqual(['p1']);
  });

  it('3.1 the paycheck rule ignores upper and lower case', () => {
    const book = openTestBook();
    book.receive(deposit('p1', '2026-10-09', 400_000, 'acme payroll dir dep'));
    expect(book.period().number).toBe(1);
  });

  it('3.1 a paycheck into savings is still a paycheck', () => {
    const book = openTestBook();
    book.receive({ ...paycheck('p1', '2026-10-09', 400_000), account: 'savings' });
    expect(book.period().number).toBe(1);
  });

  it('3.1 a deposit that does not match is not a paycheck: no split, no new period, it waits in review', () => {
    const book = openTestBook();
    expect(book.receive(deposit('d1', '2026-10-09', 400_000, 'MADE UP REFUND CHECK'))).toEqual({ id: 'd1', outcome: 'review' });
    expect(book.period().number).toBe(0);
    expect(book.pots()).toMatchObject({ savings: 0, needs: 0, wants: 0, momReserve: 0, unsortedIn: 400_000 });
  });

  it('3.1 before the paycheck rule is set, no deposit is treated as a paycheck', () => {
    const book = openTestBook({ settings: { paycheckRule: null } });
    expect(book.receive(paycheck('p1', '2026-10-09', 400_000)).outcome).toBe('review');
    expect(book.period().number).toBe(0);
  });

  it('3.1 the same paycheck received twice counts once', () => {
    const book = openTestBook();
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    const before = book.pots();
    expect(book.receive(paycheck('p1', '2026-10-09', 400_000))).toEqual({ id: 'p1', outcome: 'duplicate' });
    expect(book.pots()).toEqual(before);
    expect(book.period().number).toBe(1);
  });

  it('3.1 a different transaction reusing an id is refused', () => {
    const book = openTestBook();
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(codeOf(() => book.receive(paycheck('p1', '2026-10-09', 400_001)))).toBe('conflicting-id');
  });

  it('3.1 a deposit of zero, a negative amount, or part of a cent is refused and changes nothing', () => {
    const book = openTestBook();
    expect(codeOf(() => book.receive(paycheck('p0', '2026-10-09', 0)))).toBe('not-positive');
    expect(codeOf(() => book.receive(paycheck('p0', '2026-10-09', -100)))).toBe('not-positive');
    expect(codeOf(() => book.receive(paycheck('p0', '2026-10-09', 100.5)))).toBe('not-cents');
    expect(codeOf(() => book.receive(paycheck('p0', '2026-02-30', 100)))).toBe('not-a-date');
    expect(codeOf(() => book.receive({ ...paycheck('', '2026-10-09', 100) }))).toBe('bad-transaction');
    expect(book.period().number).toBe(0);
    expect(book.pots().savings).toBe(0);
  });
});

describe('3.2 the mom reserve comes off first, up to its cap', () => {
  it('3.2 an empty reserve takes the full $1,500', () => {
    expect(splitPaycheck(400_000, 0, RULES)).toMatchObject({ momReserve: 150_000, detail: { overflowToSavings: 0, rest: 250_000 } });
  });

  it('3.2 a reserve already at its cap sends the whole $1,500 to savings', () => {
    const split = splitPaycheck(400_000, 300_000, RULES);
    expect(split.momReserve).toBe(0);
    expect(split.detail.overflowToSavings).toBe(150_000);
    expect(split.detail.rest).toBe(250_000);
    expect(split.savings).toBe(150_000 + 125_000);
  });

  it('3.2 a part-full reserve fills to the cap and the part that does not fit goes to savings', () => {
    const split = splitPaycheck(400_000, 200_000, RULES);
    expect(split.momReserve).toBe(100_000);
    expect(split.detail.overflowToSavings).toBe(50_000);
    expect(split.savings).toBe(50_000 + 125_000);
  });

  it('3.2 filling exactly to the cap sends nothing to savings', () => {
    const split = splitPaycheck(400_000, 150_000, RULES);
    expect(split.momReserve).toBe(150_000);
    expect(split.detail.overflowToSavings).toBe(0);
  });

  it('3.2 one cent below the cap takes one cent', () => {
    const split = splitPaycheck(400_000, 299_999, RULES);
    expect(split.momReserve).toBe(1);
    expect(split.detail.overflowToSavings).toBe(149_999);
  });

  it('3.2 a paycheck smaller than the reserve all goes to the reserve, leaving nothing to split', () => {
    expect(splitPaycheck(100_000, 0, RULES)).toEqual({
      momReserve: 100_000,
      savings: 0,
      needs: 0,
      wants: 0,
      detail: { reserveTaken: 100_000, overflowToSavings: 0, rest: 0, savingsShare: 0, roundingToSavings: 0 },
    });
  });

  it('3.2 a paycheck smaller than the reserve with little room under the cap: the rest of it goes to savings', () => {
    expect(splitPaycheck(100_000, 250_000, RULES)).toMatchObject({ momReserve: 50_000, savings: 50_000, needs: 0, wants: 0 });
  });

  it('3.2 a paycheck of exactly the reserve amount leaves nothing to split', () => {
    expect(splitPaycheck(150_000, 0, RULES)).toMatchObject({ momReserve: 150_000, savings: 0, needs: 0, wants: 0 });
  });

  it('3.2 a one-cent paycheck goes to the reserve', () => {
    expect(splitPaycheck(1, 0, RULES)).toMatchObject({ momReserve: 1, savings: 0, needs: 0, wants: 0 });
    expect(splitPaycheck(1, 300_000, RULES)).toMatchObject({ momReserve: 0, savings: 1, needs: 0, wants: 0 });
  });

  it('3.2 a reserve above its cap (after the cap was lowered) takes nothing and is not cut back', () => {
    const rules = changeSettings(RULES, { momReserveCap: 200_000 });
    expect(splitPaycheck(400_000, 250_000, rules)).toMatchObject({ momReserve: 0, detail: { overflowToSavings: 150_000 } });
  });

  it('3.2 a reserve setting of zero takes nothing', () => {
    const rules = changeSettings(RULES, { momReservePerPaycheck: 0 });
    expect(splitPaycheck(400_000, 0, rules)).toMatchObject({ momReserve: 0, savings: 200_000, needs: 120_000, wants: 80_000 });
  });

  it('3.2 in the book, the reserve and savings grow by the right amounts', () => {
    const book = openTestBook({ pots: { momReserve: 200_000, savings: 10 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(book.pots()).toMatchObject({ momReserve: 300_000, savings: 10 + 50_000 + 125_000, needs: 75_000, wants: 50_000 });
  });
});

describe('3.3 the rest is split by the percentages, leftover cents go to savings', () => {
  it('3.3 an even split', () => {
    expect(splitPaycheck(400_000, 0, RULES)).toEqual({
      momReserve: 150_000,
      savings: 125_000,
      needs: 75_000,
      wants: 50_000,
      detail: { reserveTaken: 150_000, overflowToSavings: 0, rest: 250_000, savingsShare: 125_000, roundingToSavings: 0 },
    });
  });

  it('3.3 leftover cents from rounding go to savings', () => {
    // Rest of 99 cents: needs 29.7 -> 29, wants 19.8 -> 19, savings 49.5 -> 49, plus 2 leftover cents.
    expect(splitPaycheck(150_099, 0, RULES)).toEqual({
      momReserve: 150_000,
      savings: 51,
      needs: 29,
      wants: 19,
      detail: { reserveTaken: 150_000, overflowToSavings: 0, rest: 99, savingsShare: 49, roundingToSavings: 2 },
    });
  });

  it('3.3 a one-cent rest goes to savings', () => {
    expect(splitPaycheck(150_001, 0, RULES)).toMatchObject({ savings: 1, needs: 0, wants: 0, detail: { roundingToSavings: 1 } });
  });

  it('3.3 an uneven custom split still adds up to the paycheck exactly', () => {
    const rules = changeSettings(RULES, { split: { savings: 33, needs: 33, wants: 34 }, momReservePerPaycheck: 0 });
    const split = splitPaycheck(1_000, 0, rules);
    expect(split).toMatchObject({ savings: 330, needs: 330, wants: 340 });
    const odd = splitPaycheck(1_001, 0, rules);
    expect(odd).toMatchObject({ savings: 331, needs: 330, wants: 340, detail: { roundingToSavings: 1 } });
    expect(odd.momReserve + odd.savings + odd.needs + odd.wants).toBe(1_001);
  });

  it('3.3 a split of 0/0/100 sends everything after the reserve to wants', () => {
    const rules = changeSettings(RULES, { split: { savings: 0, needs: 0, wants: 100 } });
    expect(splitPaycheck(400_000, 0, rules)).toMatchObject({ savings: 0, needs: 0, wants: 250_000 });
  });

  it('3.3 a very large paycheck splits exactly', () => {
    const big = 9_000_000_000_000_001; // just under the largest exact whole number
    const split = splitPaycheck(big, 0, RULES);
    expect(split.momReserve + split.savings + split.needs + split.wants).toBe(big);
    expect(split.needs).toBe(2_699_999_999_955_000);
    expect(split.wants).toBe(1_799_999_999_970_000);
  });

  it('3.3 refuses a paycheck of zero, a negative paycheck, or part of a cent', () => {
    expect(codeOf(() => splitPaycheck(0, 0, RULES))).toBe('not-positive');
    expect(codeOf(() => splitPaycheck(-1, 0, RULES))).toBe('not-positive');
    expect(codeOf(() => splitPaycheck(0.5, 0, RULES))).toBe('not-cents');
  });

  it('3.3 in the book, the paycheck parts add up to the paycheck exactly', () => {
    const book = openTestBook();
    book.receive(paycheck('p1', '2026-10-09', 234_567));
    const [record] = book.paychecks();
    expect(record).toMatchObject({ id: 'p1', date: '2026-10-09', amount: 234_567 });
    const parts = record?.split;
    expect(parts && parts.momReserve + parts.savings + parts.needs + parts.wants).toBe(234_567);
  });
});

describe('3.4 unspent needs and wants: roll over or move to savings, your choice per bucket', () => {
  it('3.4 at payday you are asked about each bucket with money left, and the money stays put until you answer', () => {
    const book = openTestBook({ pots: { needs: 12_000, wants: 3_456 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(book.reviewItems().filter((i) => i.type === 'leftover')).toEqual([
      { type: 'leftover', id: 'leftover:p1:needs', date: '2026-10-09', bucket: 'needs', amount: 12_000 },
      { type: 'leftover', id: 'leftover:p1:wants', date: '2026-10-09', bucket: 'wants', amount: 3_456 },
    ]);
    expect(book.pots()).toMatchObject({ needs: 12_000 + 75_000, wants: 3_456 + 50_000, savings: 125_000 });
  });

  it('3.4 rolling over keeps the money in the bucket', () => {
    const book = openTestBook({ pots: { needs: 12_000 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    book.answerLeftover('leftover:p1:needs', 'roll-over', '2026-10-09');
    expect(book.pots()).toMatchObject({ needs: 87_000, savings: 125_000 });
    expect(book.reviewItems()).toEqual([]);
  });

  it('3.4 moving to savings moves exactly the unspent amount', () => {
    const book = openTestBook({ pots: { wants: 3_456 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    book.answerLeftover('leftover:p1:wants', 'move-to-savings', '2026-10-10');
    expect(book.pots()).toMatchObject({ wants: 50_000, savings: 125_000 + 3_456 });
  });

  it('3.4 each bucket is answered separately', () => {
    const book = openTestBook({ pots: { needs: 100, wants: 200 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    book.answerLeftover('leftover:p1:needs', 'roll-over', '2026-10-09');
    book.answerLeftover('leftover:p1:wants', 'move-to-savings', '2026-10-09');
    expect(book.pots()).toMatchObject({ needs: 75_100, wants: 50_000, savings: 125_200 });
  });

  it('3.4 one cent left is still asked about', () => {
    const book = openTestBook({ pots: { wants: 1 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(book.reviewItems()).toEqual([{ type: 'leftover', id: 'leftover:p1:wants', date: '2026-10-09', bucket: 'wants', amount: 1 }]);
  });

  it('3.4 nothing is asked when a bucket is exactly empty', () => {
    const book = openTestBook();
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(book.reviewItems()).toEqual([]);
  });

  it('3.4 setting "always roll over" asks nothing and moves nothing', () => {
    const book = openTestBook({ pots: { needs: 500, wants: 700 }, settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(book.reviewItems()).toEqual([]);
    expect(book.pots()).toMatchObject({ needs: 75_500, wants: 50_700, savings: 125_000 });
  });

  it('3.4 setting "always move to savings" moves the unspent money at payday without asking', () => {
    const book = openTestBook({ pots: { needs: 500, wants: 700 }, settings: { leftoverAtPayday: { needs: 'move-to-savings', wants: 'ask' } } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(book.reviewItems().map((i) => i.id)).toEqual(['leftover:p1:wants']);
    expect(book.pots()).toMatchObject({ needs: 75_000, wants: 50_700, savings: 125_500 });
  });

  it('3.4 a second payday before you answer replaces the old question, so nothing moves twice', () => {
    const book = openTestBook({ pots: { wants: 1_000 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    book.receive(paycheck('p2', '2026-10-23', 400_000));
    // Before the second paycheck, wants held the old $10 plus the first $500
    // share, and needs held the first $750 share.
    expect(book.reviewItems()).toEqual([
      { type: 'leftover', id: 'leftover:p2:needs', date: '2026-10-23', bucket: 'needs', amount: 75_000 },
      { type: 'leftover', id: 'leftover:p2:wants', date: '2026-10-23', bucket: 'wants', amount: 51_000 },
    ]);
    book.answerLeftover('leftover:p2:wants', 'move-to-savings', '2026-10-23');
    expect(book.pots()).toMatchObject({ wants: 50_000, savings: 250_000 + 51_000 });
    expect(codeOf(() => book.answerLeftover('leftover:p1:wants', 'move-to-savings', '2026-10-23'))).toBe('unknown-item');
  });

  it('3.4 a question can be answered only once, and only with one of the two choices', () => {
    const book = openTestBook({ pots: { wants: 1_000 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(codeOf(() => book.answerLeftover('leftover:p1:wants', 'ask' as never, '2026-10-09'))).toBe('bad-choice');
    book.answerLeftover('leftover:p1:wants', 'move-to-savings', '2026-10-09');
    expect(codeOf(() => book.answerLeftover('leftover:p1:wants', 'roll-over', '2026-10-09'))).toBe('unknown-item');
    expect(codeOf(() => book.answerLeftover('nope', 'roll-over', '2026-10-09'))).toBe('unknown-item');
    expect(book.pots()).toMatchObject({ wants: 50_000, savings: 126_000 });
  });
});

describe('3.5 an overspent bucket carries over as a negative', () => {
  it('3.5 the next period starts smaller, and there is no leftover question', () => {
    const book = openTestBook({ pots: { needs: -5_000, wants: -1 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(book.pots()).toMatchObject({ needs: 70_000, wants: 49_999, savings: 125_000 });
    expect(book.reviewItems()).toEqual([]);
  });

  it('3.5 an overspend bigger than the new share stays negative', () => {
    const book = openTestBook({ pots: { wants: -60_000 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(book.pots().wants).toBe(-10_000);
  });

  it('3.5 "always move to savings" never moves a negative', () => {
    const book = openTestBook({ pots: { needs: -5_000 }, settings: { leftoverAtPayday: { needs: 'move-to-savings', wants: 'move-to-savings' } } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(book.pots()).toMatchObject({ needs: 70_000, savings: 125_000 });
  });
});

describe('3.6 a third paycheck in a month is handled like any other', () => {
  it('3.6 three paychecks in October each split the same way, with the cap still applied', () => {
    const fresh = openTestBook({ lastPaycheckDate: '2026-09-17' });
    fresh.receive(paycheck('p1', '2026-10-01', 400_000));
    fresh.receive(paycheck('p2', '2026-10-15', 400_000));
    fresh.receive(paycheck('p3', '2026-10-29', 400_000));
    for (const record of fresh.paychecks()) {
      expect(record.split.needs).toBe(75_000);
      expect(record.split.wants).toBe(50_000);
    }
    expect(fresh.paychecks().map((p) => p.split.momReserve)).toEqual([150_000, 150_000, 0]);
    expect(fresh.paychecks()[2]?.split.savings).toBe(150_000 + 125_000);
    expect(fresh.period()).toEqual({ number: 3, startDate: '2026-10-29' });
  });
});

describe('3.7 a paycheck less than 10 days after the last one goes to review', () => {
  it('3.7 nine days after the last paycheck: review, no split, no new period', () => {
    const book = openTestBook({ lastPaycheckDate: '2026-10-01' });
    expect(book.receive(paycheck('p1', '2026-10-10', 400_000))).toEqual({ id: 'p1', outcome: 'review' });
    expect(book.period().number).toBe(0);
    expect(book.lastPaycheckDate()).toBe('2026-10-01');
    expect(book.pots()).toMatchObject({ savings: 0, needs: 0, wants: 0, momReserve: 0, unsortedIn: 400_000 });
    expect(book.reviewItems()).toEqual([
      { type: 'money-in', id: 'p1', date: '2026-10-10', amount: 400_000, description: `${'ACME PAYROLL'} DIRECT DEP`, reason: 'early-paycheck' },
    ]);
  });

  it('3.7 exactly 10 days after the last paycheck splits normally', () => {
    const book = openTestBook({ lastPaycheckDate: '2026-10-01' });
    expect(book.receive(paycheck('p1', '2026-10-11', 400_000)).outcome).toBe('paycheck');
  });

  it('3.7 the same day as the last paycheck, or dated before it, goes to review', () => {
    const book = openTestBook({ lastPaycheckDate: '2026-10-01' });
    expect(book.receive(paycheck('p1', '2026-10-01', 400_000)).outcome).toBe('review');
    expect(book.receive(paycheck('p2', '2026-09-20', 400_000)).outcome).toBe('review');
  });

  it('3.7 counts from the last paycheck the app split, not from one sent to review', () => {
    const book = openTestBook({ lastPaycheckDate: '2026-10-01' });
    book.receive(paycheck('early', '2026-10-05', 400_000));
    expect(book.receive(paycheck('p1', '2026-10-11', 400_000)).outcome).toBe('paycheck');
  });

  it('3.7 the number of days is a setting', () => {
    const book = openTestBook({ lastPaycheckDate: '2026-10-01', settings: { earlyPaycheckDays: 5 } });
    expect(book.receive(paycheck('p1', '2026-10-05', 400_000)).outcome).toBe('review');
    expect(book.receive(paycheck('p2', '2026-10-06', 400_000)).outcome).toBe('paycheck');
  });

  it('3.7 deposits that do not look like a paycheck are not affected by the 10 days', () => {
    expect(LAST_PAYCHECK).toBe('2026-09-25');
    const book = openTestBook();
    expect(book.receive(deposit('d1', '2026-09-26', 5_000)).outcome).toBe('review');
    expect(book.reviewItems()).toMatchObject([{ id: 'd1', reason: 'deposit' }]);
  });
});

describe('3.8 on payday: how much should be in the savings account, and how much to move', () => {
  it('3.8 should be in savings = savings bucket + mom reserve; still to move = that minus the account balance', () => {
    const book = openTestBook({ pots: { savings: 1_000_000, momReserve: 150_000 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(book.savingsTransfer(1_150_000)).toEqual({
      shouldBeInSavings: 1_000_000 + 125_000 + 150_000 + 150_000,
      savingsAccountBalance: 1_150_000,
      stillToMove: 275_000,
    });
  });

  it('3.8 nothing left to move when the account already holds exactly the right amount', () => {
    const book = openTestBook({ pots: { savings: 500_000, momReserve: 100_000 } });
    expect(book.savingsTransfer(600_000).stillToMove).toBe(0);
  });

  it('3.8 when the account holds more than it should, nothing is left to move and the extra is shown separately', () => {
    const book = openTestBook({ pots: { savings: 500_000, momReserve: 100_000 } });
    expect(book.savingsTransfer(600_001)).toEqual({ shouldBeInSavings: 600_000, savingsAccountBalance: 600_001, stillToMove: 0, extraInSavings: 1 });
    expect(book.savingsTransfer(1_000_000)).toMatchObject({ stillToMove: 0, extraInSavings: 400_000 });
  });

  it('3.8 no extra is shown when the account holds exactly enough, or less', () => {
    const book = openTestBook({ pots: { savings: 500_000, momReserve: 100_000 } });
    expect(book.savingsTransfer(600_000)).toEqual({ shouldBeInSavings: 600_000, savingsAccountBalance: 600_000, stillToMove: 0 });
    expect(book.savingsTransfer(599_999)).toEqual({ shouldBeInSavings: 600_000, savingsAccountBalance: 599_999, stillToMove: 1 });
  });

  it('3.8 money on its way that would overfill the account shows as extra (B46)', () => {
    const book = openTestBook({ pots: { savings: 500_000, momReserve: 100_000 } });
    book.receive(sent('t1', '2026-10-02', 50_000, 'checking', 'savings'));
    // 580,000 in the account + 50,000 on its way = 630,000, 30,000 more than 600,000.
    expect(book.savingsTransfer(580_000)).toMatchObject({ stillToMove: 0, extraInSavings: 30_000 });
  });

  it('3.8 refuses a balance that is not whole cents', () => {
    const book = openTestBook();
    expect(codeOf(() => book.savingsTransfer(10.5))).toBe('not-cents');
  });
});
