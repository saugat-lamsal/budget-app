import { describe, expect, it } from 'vitest';
import { type Book, type StartingPots } from '../src/index.js';
import { PAYROLL, START_DATE, codeOf, deposit, openTestBook, paycheck, posted, purchase, takenBack } from './helpers.js';

// What the Payday screen shows (QUESTIONS.md B104 to B106), all worked out by
// the money math: what the last paycheck did (the mom reserve first, then the
// split, rules 3.2 and 3.3), what happened to each bucket's leftover (3.4,
// 3.5), and how the pay period that just ended went.

const RULES = [
  { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
] as const;
const START: StartingPots = { savings: 100_000, needs: 50_000, wants: 20_000, momReserve: 120_000, heldForOthers: 0 };

function openBook(settings = {}, pots: Partial<StartingPots> = {}): Book {
  return openTestBook({ pots: { ...START, ...pots }, rules: RULES, settings });
}

describe('B104 the Payday report says what the last paycheck did', () => {
  it('B104 before the first paycheck there is no paycheck, no leftover, and no pay period that ended', () => {
    const b = openBook();
    expect(b.paydayReport()).toEqual({ period: { number: 0, startDate: START_DATE }, paycheck: null, leftovers: [], ended: null });
  });

  it('3.2 3.3 B104 the mom reserve comes off first, then the rest is split by the percentages', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const r = b.paydayReport();
    expect(r.period).toEqual({ number: 1, startDate: '2026-10-09' });
    expect(r.paycheck).toEqual({
      id: 'p1',
      date: '2026-10-09',
      amount: 400_000,
      description: `${PAYROLL} DIRECT DEP`,
      split: {
        momReserve: 150_000,
        savings: 125_000,
        needs: 75_000,
        wants: 50_000,
        detail: { reserveTaken: 150_000, overflowToSavings: 0, rest: 250_000, savingsShare: 125_000, roundingToSavings: 0 },
      },
      percent: { savings: 50, needs: 30, wants: 20 },
      reservePerPaycheck: 150_000,
      reserveCap: 300_000,
      reserveBefore: 120_000,
      takenBack: false,
    });
    // The same split the book made.
    expect(r.paycheck?.split).toEqual(b.paychecks()[0]?.split);
  });

  it('3.3 B104 the cents left over from rounding go to savings, and the report says how many', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 234_567));
    const split = b.paydayReport().paycheck?.split;
    expect(split).toMatchObject({ momReserve: 150_000, savings: 42_284, needs: 25_370, wants: 16_913, detail: { rest: 84_567, savingsShare: 42_283, roundingToSavings: 1 } });
    expect((split?.momReserve ?? 0) + (split?.savings ?? 0) + (split?.needs ?? 0) + (split?.wants ?? 0)).toBe(234_567);
  });

  it('3.2 B104 what does not fit under the mom reserve cap goes to savings, and the report says how much', () => {
    const b = openBook({}, { momReserve: 290_000 });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.paydayReport().paycheck).toMatchObject({
      reserveBefore: 290_000,
      split: { momReserve: 10_000, savings: 125_000 + 140_000, detail: { reserveTaken: 150_000, overflowToSavings: 140_000 } },
    });
  });

  it('3.2 B1 B104 a paycheck smaller than the reserve all goes to the reserve, and nothing is left to split', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 100_000));
    expect(b.paydayReport().paycheck).toMatchObject({ amount: 100_000, split: { momReserve: 100_000, savings: 0, needs: 0, wants: 0, detail: { reserveTaken: 100_000, rest: 0 } } });
  });

  it('13.1 B104 a change to the split waits for the next paycheck: the report shows what the paycheck used, not what the settings say now', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.changeSettings({ split: { savings: 40, needs: 40, wants: 20 }, momReservePerPaycheck: 100_000 }, '2026-10-10');
    expect(b.paydayReport().paycheck).toMatchObject({ percent: { savings: 50, needs: 30, wants: 20 }, reservePerPaycheck: 150_000, split: { needs: 75_000 } });
    b.receive(paycheck('p2', '2026-10-23', 400_000));
    // The reserve held $2,700.00, so only $300.00 of the $1,000.00 fits under the cap (3.2).
    expect(b.paydayReport().paycheck).toMatchObject({ id: 'p2', percent: { savings: 40, needs: 40, wants: 20 }, reservePerPaycheck: 100_000, reserveBefore: 270_000, split: { momReserve: 30_000, needs: 120_000, detail: { reserveTaken: 100_000, overflowToSavings: 70_000 } } });
  });

  it('6.1 B53 B104 a deposit you call your paycheck is reported on the day it arrived, not the day you said so', () => {
    const b = openBook();
    b.receive(deposit('d1', '2026-10-05', 400_000, 'MADE UP NEW EMPLOYER'));
    b.sort('d1', { to: 'paycheck' }, '2026-10-08');
    expect(b.paydayReport()).toMatchObject({ period: { number: 1, startDate: '2026-10-05' }, paycheck: { id: 'd1', date: '2026-10-05', description: 'MADE UP NEW EMPLOYER' } });
  });

  it('4.10 B71 B104 a paycheck the bank took back is still reported, saying so, and its pay period stays', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(takenBack('t1', 'p1', '2026-10-10'));
    expect(b.paydayReport()).toMatchObject({ period: { number: 1 }, paycheck: { id: 'p1', takenBack: true } });
  });

  it('B104 the report is a picture: it cannot be used to change the book, and asking changes nothing', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const r = b.paydayReport();
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.paycheck)).toBe(true);
    expect(Object.isFrozen(r.leftovers)).toBe(true);
    const before = JSON.stringify([b.pots(), b.reviewItems(), b.changeLog(), b.paychecks()]);
    b.paydayReport();
    expect(JSON.stringify([b.pots(), b.reviewItems(), b.changeLog(), b.paychecks()])).toBe(before);
  });
});

describe('B106 the Payday report says what happened to each bucket\'s leftover', () => {
  it('3.4 B106 asked: the leftover waits for an answer, and the report names the question', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.paydayReport().leftovers).toEqual([
      { bucket: 'needs', leftAtPayday: 50_000, setting: 'ask', outcome: 'waiting', amount: 50_000, question: 'leftover:p1:needs' },
      { bucket: 'wants', leftAtPayday: 20_000, setting: 'ask', outcome: 'waiting', amount: 20_000, question: 'leftover:p1:wants' },
    ]);
  });

  it('3.4 B106 rolled over by your answer: kept, with the amount', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.answerLeftover('leftover:p1:needs', 'roll-over', '2026-10-10');
    expect(b.paydayReport().leftovers[0]).toEqual({ bucket: 'needs', leftAtPayday: 50_000, setting: 'ask', outcome: 'kept', amount: 50_000, question: null });
    expect(b.paydayReport().leftovers[1]).toMatchObject({ bucket: 'wants', outcome: 'waiting' });
  });

  it('3.4 B106 moved to savings by your answer: moved, with the amount', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.answerLeftover('leftover:p1:wants', 'move-to-savings', '2026-10-10');
    expect(b.paydayReport().leftovers[1]).toEqual({ bucket: 'wants', leftAtPayday: 20_000, setting: 'ask', outcome: 'moved-to-savings', amount: 20_000, question: null });
  });

  it('3.4 B106 the setting says always move to savings: moved at payday, no question', () => {
    const b = openBook({ leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.paydayReport().leftovers).toEqual([
      { bucket: 'needs', leftAtPayday: 50_000, setting: 'move-to-savings', outcome: 'moved-to-savings', amount: 50_000, question: null },
      { bucket: 'wants', leftAtPayday: 20_000, setting: 'roll-over', outcome: 'kept', amount: 20_000, question: null },
    ]);
    expect(b.reviewItems()).toEqual([]);
  });

  it('3.5 B106 a bucket with nothing left, or overspent, asks nothing and moves nothing: it carries over', () => {
    const b = openBook({}, { needs: 0, wants: -2_500 });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.paydayReport().leftovers).toEqual([
      { bucket: 'needs', leftAtPayday: 0, setting: 'ask', outcome: 'nothing-to-ask', amount: 0, question: null },
      { bucket: 'wants', leftAtPayday: -2_500, setting: 'ask', outcome: 'nothing-to-ask', amount: 0, question: null },
    ]);
  });

  it('3.4 one cent left is a leftover too', () => {
    const b = openBook({}, { needs: 1 });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.paydayReport().leftovers[0]).toMatchObject({ leftAtPayday: 1, outcome: 'waiting', amount: 1 });
  });

  it('3.4 B4 B106 spending from before payday that shows up after it lowers the question, never below zero', () => {
    const b = openBook();
    b.receive(purchase('c1', '2026-10-08', 1_000, 'MADE UP CAFE', { pending: true }));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.paydayReport().leftovers[1]).toMatchObject({ leftAtPayday: 19_000, outcome: 'waiting', amount: 19_000 });
    b.receive(posted('c1-posted', 'c1', '2026-10-10', 1_250, 'MADE UP CAFE'));
    // What the bucket held when the paycheck was counted is a fact of that day; what is asked now is less.
    expect(b.paydayReport().leftovers[1]).toMatchObject({ leftAtPayday: 19_000, outcome: 'waiting', amount: 18_750 });
    b.receive(purchase('c2', '2026-10-07', 30_000, 'MADE UP CAFE'));
    expect(b.paydayReport().leftovers[1]).toMatchObject({ leftAtPayday: 19_000, outcome: 'waiting', amount: 0 });
  });

  it('3.4 B4 B106 after late spending lowered the question, moving the leftover moves what the question asked, and the report says that amount', () => {
    const b = openBook();
    b.receive(purchase('c1', '2026-10-08', 1_000, 'MADE UP CAFE', { pending: true }));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(posted('c1-posted', 'c1', '2026-10-10', 1_250, 'MADE UP CAFE'));
    b.answerLeftover('leftover:p1:wants', 'move-to-savings', '2026-10-11');
    // 190.00 at payday, 2.50 more spent from before payday: 187.50 moves.
    expect(b.paydayReport().leftovers[1]).toEqual({ bucket: 'wants', leftAtPayday: 19_000, setting: 'ask', outcome: 'moved-to-savings', amount: 18_750, question: null });
    expect(b.pots().savings).toBe(100_000 + 125_000 + 18_750);
  });

  it('3.4 B3 B106 a second payday replaces an unanswered question: only the latest payday is reported', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(paycheck('p2', '2026-10-23', 400_000));
    const r = b.paydayReport();
    expect(r.period.number).toBe(2);
    expect(r.leftovers).toMatchObject([
      { bucket: 'needs', leftAtPayday: 125_000, outcome: 'waiting', question: 'leftover:p2:needs' },
      { bucket: 'wants', leftAtPayday: 70_000, outcome: 'waiting', question: 'leftover:p2:wants' },
    ]);
  });

  it('3.4 B106 the setting at the time is what is reported, even if it changed since', () => {
    const b = openBook({ leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.changeSettings({ leftoverAtPayday: { needs: 'roll-over', wants: 'ask' } }, '2026-10-10');
    expect(b.paydayReport().leftovers.map((l) => [l.setting, l.outcome])).toEqual([
      ['move-to-savings', 'moved-to-savings'],
      ['roll-over', 'kept'],
    ]);
  });
});

describe('B105 the Payday report sums up the pay period that just ended', () => {
  it('B105 it is the pay period before the current one, added up, ending where the leftover question starts', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP CAFE'));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const { ended, leftovers } = b.paydayReport();
    expect(ended).toEqual(b.periodSummary(0));
    expect(ended).toMatchObject({ number: 0, startDate: START_DATE, endDate: '2026-10-09' });
    expect(ended?.byKind.needs.spending).toBe(-3_250);
    expect(ended?.byKind.wants.spending).toBe(-1_000);
    // What it ended with is what the leftover question is about.
    expect(ended?.closing.needs).toBe(leftovers[0]?.leftAtPayday);
    expect(ended?.closing.wants).toBe(leftovers[1]?.leftAtPayday);
  });

  it('B105 after the next payday it is the pay period that ran from the first paycheck to the second', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(purchase('g1', '2026-10-12', 3_250, 'MADE UP GROCERY'));
    b.receive(paycheck('p2', '2026-10-23', 400_000));
    expect(b.paydayReport().ended).toMatchObject({ number: 1, startDate: '2026-10-09', endDate: '2026-10-23' });
    expect(b.paydayReport().ended?.byKind.needs).toMatchObject({ paycheck: 75_000, spending: -3_250 });
  });
});

describe('0.1 a refused change leaves the report as it was', () => {
  it('0.1 B104 a payday refused after moving a leftover to savings changes nothing the report says', () => {
    const MAX = Number.MAX_SAFE_INTEGER;
    const b = openTestBook({ pots: { savings: MAX - 100_000, needs: 3_000 }, settings: { leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } } });
    const before = JSON.stringify(b.paydayReport());
    expect(codeOf(() => b.receive(paycheck('p1', '2026-10-09', 400_000)))).toBe('not-cents');
    expect(JSON.stringify(b.paydayReport())).toBe(before);
  });
});
