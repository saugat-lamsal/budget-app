import { addCents, subtractCents, type Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { paycheck, purchase, refund, transfer } from '../../money/test/helpers.js';
import { before, book, view } from './trends-setup.js';

// Trends, Future (rulebook 40.10 to 40.13, QUESTIONS.md A59, his OK Oct 19,
// 2026), worked out on the server from the books. Every number is worked out
// by hand in the comments, and checked against the books where the books
// hold it. Every name and number is made up.

// Spending from setup day (Oct 1): a grocery 32.50 (needs), a cafe 10.00
// (wants), a shop 5.00 waiting in review, and 200.00 to the old card from
// checking (needs, planned: left out of the pace).
function spending(b: Book = book()): Book {
  b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
  b.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP CAFE'));
  b.receive(purchase('u1', '2026-10-04', 500, 'MADE UP SHOP'));
  b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card'));
  return b;
}

describe('40.11 where Needs and Wants land by payday', () => {
  it('40.11 what each holds now, less this pay period\'s pace for the days left, old card payments left out', () => {
    const b = spending();
    const v = view(b, '2026-10-05');
    // Day 5 of the pay period (Oct 1 is day 1); the days left after today up
    // to the day before the next payday (Oct 9): Oct 6, 7 and 8, so 3.
    // Needs holds 500.00 - 32.50 - 200.00 = 267.50; its pace 32.50 x 3 / 5 = 19.50; lands at 248.00.
    // Wants holds 300.00 - 10.00 = 290.00; its pace 10.00 x 3 / 5 = 6.00; lands at 284.00.
    expect(v.future.landing).toEqual({
      nextPayday: '2026-10-09',
      waitingInReview: 500,
      needs: { state: 'estimate', holds: 26_750, spentSoFar: 3_250, daysSoFar: 5, daysLeft: 3, pace: 1_950, lands: 24_800 },
      wants: { state: 'estimate', holds: 29_000, spentSoFar: 1_000, daysSoFar: 5, daysLeft: 3, pace: 600, lands: 28_400 },
    });
    // What it holds is the books' own.
    expect(v.future.landing.needs.holds).toBe(b.pots().needs);
    expect(v.future.landing.wants.holds).toBe(b.pots().wants);
  });

  it('40.11 the pace is rounded up to the cent, so the estimate leans low', () => {
    const b = spending();
    b.receive(purchase('c2', '2026-10-05', 1, 'MADE UP CAFE'));
    // Wants spent 10.01: 10.01 x 3 / 5 = 6.006, rounded up to 6.01. Holds 289.99; lands at 283.98.
    const w = view(b, '2026-10-05').future.landing.wants;
    expect(w).toMatchObject({ spentSoFar: 1_001, pace: 601, holds: 28_999, lands: 28_398 });
  });

  it('40.11 one cent spent: the pace rounds up to one cent', () => {
    const b = book();
    b.receive(purchase('c1', '2026-10-02', 1, 'MADE UP CAFE'));
    // 0.01 x 3 / 5 = 0.006, up to 0.01.
    expect(view(b, '2026-10-05').future.landing.wants).toMatchObject({ spentSoFar: 1, pace: 1, lands: 29_998 });
  });

  it('40.11 nothing spent: it lands at what it holds', () => {
    expect(view(book(), '2026-10-05').future.landing.needs).toMatchObject({ state: 'estimate', spentSoFar: 0, pace: 0, holds: 50_000, lands: 50_000 });
  });

  it('40.11 a refund bigger than what was spent: a negative pace, still rounded up', () => {
    const b = book();
    b.receive(purchase('c1', '2026-10-02', 1_000, 'MADE UP CAFE'));
    b.receive(purchase('c2', '2026-10-02', 2_000, 'MADE UP CAFE'));
    b.receive(refund('r2', '2026-10-03', 2_000, 'c2', 'everyday-card'));
    // Spent 10.00 net; refunds within the pay period come off. Pace 6.00.
    expect(view(b, '2026-10-05').future.landing.wants).toMatchObject({ spentSoFar: 1_000, pace: 600 });
  });

  it('40.11 before day 3: too early to tell; day 3 is the first with an estimate', () => {
    const b = spending(book());
    expect(view(b, '2026-10-02').future.landing.needs).toEqual({ state: 'too-early', holds: 26_750, daysSoFar: 2 });
    expect(view(b, '2026-10-03').future.landing.needs.state).toBe('estimate');
  });

  it('40.11 on the next payday with no paycheck yet: no days left, so it lands at what it holds; the day after, no estimate', () => {
    const b = spending();
    expect(view(b, '2026-10-09').future.landing.wants).toMatchObject({ state: 'estimate', daysLeft: 0, pace: 0, lands: 29_000 });
    expect(view(b, '2026-10-10').future.landing.wants).toEqual({ state: 'payday-passed', holds: 29_000 });
  });

  it('40.11 a new pay period counts from its payday, day 1', () => {
    const b = spending();
    b.receive(paycheck('pay', '2026-10-09', 400_000));
    b.receive(purchase('c3', '2026-10-10', 3_000, 'MADE UP CAFE'));
    // Day 3 on Oct 11; the next payday Oct 23, so 11 days left (Oct 12 to 22). 30.00 x 11 / 3 = 110.00.
    const w = view(b, '2026-10-11').future.landing.wants;
    expect(w).toMatchObject({ state: 'estimate', daysSoFar: 3, daysLeft: 11, spentSoFar: 3_000, pace: 11_000 });
    if (w.state !== 'estimate') throw new Error('estimate');
    expect(w.lands).toBe(subtractCents(b.pots().wants, 11_000));
  });

  it('40.11 in the books\' first pay period with history from before setup day, the days count from setup day', () => {
    const b = spending();
    // The pay period began on Sep 25, but Needs began on setup day: day 5 from Oct 1.
    const v = view(b, '2026-10-05', { before: before([]) });
    expect(v.future.landing.needs).toMatchObject({ daysSoFar: 5, spentSoFar: 3_250 });
  });

  it('40.11 very large amounts stay exact', () => {
    const b = book({ pots: { savings: 0, needs: 9_000_000_000_000, wants: 0, momReserve: 0, heldForOthers: 0 } });
    b.receive(purchase('g1', '2026-10-02', 3_000_000_000_001, 'MADE UP GROCERY'));
    // 30,000,000,000.01 x 3 / 5 = 18,000,000,000.006, up to 18,000,000,000.01.
    expect(view(b, '2026-10-05').future.landing.needs).toMatchObject({ pace: 1_800_000_000_001, lands: 9_000_000_000_000 - 3_000_000_000_001 - 1_800_000_000_001 });
  });
});

// Paychecks of 4,000.00, 3,000.00 and 5,000.00 with the mom reserve at its
// cap (3,000.00): 1,500.00 of each goes to savings (3.2), and the rest is
// split 50/30/20, needs and wants rounded down (3.3). So savings gains
// 1,500.00 + 1,250.00 = 2,750.00, 1,500.00 + 750.00 = 2,250.00, and
// 1,500.00 + 1,750.00 = 3,250.00.
function paid(): Book {
  const b = book({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 300_000, heldForOthers: 0 } });
  b.receive(paycheck('p1', '2026-10-09', 400_000));
  b.receive(paycheck('p2', '2026-10-23', 300_000));
  b.receive(paycheck('p3', '2026-11-06', 500_000));
  b.receive(paycheck('p4', '2026-11-20', 400_000));
  return b;
}

describe('40.12 savings a year out', () => {
  it('40.12 what it holds now, plus the least and the most a pay period gained, for each payday in the next 365 days', () => {
    const b = paid();
    // With no history from before setup day, the first pay period began on
    // setup day: it counts, and gained nothing (no paycheck in it).
    // Ended: Oct 1 (0), Oct 9 (2,750.00), Oct 23 (2,250.00), Nov 6 (3,250.00).
    // Now 1,000.00 + 2,750.00 + 2,250.00 + 3,250.00 + 2,750.00 = 12,000.00.
    // Paydays after Nov 21, 2026 up to Nov 21, 2027, every 14 days from Nov 20: 26.
    const s = view(b, '2026-11-21').future.savings;
    expect(s).toMatchObject({ state: 'estimate', now: 1_200_000, to: '2027-11-21', paydays: 26, periods: 4, least: 0, most: 325_000, low: 1_200_000, high: 1_200_000 + 26 * 325_000 });
    expect(s.now).toBe(b.pots().savings);
    if (s.state !== 'estimate') throw new Error('estimate');
    // One point for each payday, each the one before plus the least and the most.
    expect(s.points).toHaveLength(26);
    expect(s.points[0]).toEqual({ date: '2026-12-04', low: 1_200_000, high: 1_525_000 });
    expect(s.points[25]).toEqual({ date: '2027-11-19', low: s.low, high: s.high });
  });

  it('40.12 the gains are the books\' own: each pay period\'s end less the one before\'s', () => {
    const b = paid();
    const s = view(b, '2026-11-21', { before: before([]) }).future.savings;
    const gains = [1, 2, 3].map((n) => subtractCents(b.periodSummary(n).closing.savings, b.periodSummary(n - 1).closing.savings));
    expect(gains).toEqual([275_000, 225_000, 325_000]);
    // With history from before setup day, the books' first pay period began on
    // Sep 25, before setup day: not one of them.
    expect(s).toMatchObject({ state: 'estimate', periods: 3, least: 225_000, most: 325_000, low: 1_200_000 + 26 * 225_000, high: 1_200_000 + 26 * 325_000 });
  });

  it('40.12 only the last 5', () => {
    const b = paid();
    b.receive(paycheck('p5', '2026-12-04', 100_000));
    b.receive(paycheck('p6', '2026-12-18', 400_000));
    // Ended now: Oct 1 (0), Oct 9 (2,750.00), Oct 23 (2,250.00), Nov 6
    // (3,250.00), Nov 20 (2,750.00) and Dec 4: a paycheck of 1,000.00 with the
    // reserve at its cap goes all to savings (3.2), 1,000.00. The last 5 leave out Oct 1's 0.
    const s = view(b, '2026-12-19').future.savings;
    expect(s).toMatchObject({ state: 'estimate', periods: 5, least: 100_000, most: 325_000 });
  });

  it('40.12 a move out of savings counts, so a gain can be negative', () => {
    const b = book({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 300_000, heldForOthers: 0 } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(paycheck('p2', '2026-10-23', 300_000));
    b.receive(paycheck('p3', '2026-11-06', 500_000));
    b.moveMoney({ from: 'savings', to: 'wants', amount: 400_000, confirmed: true }, '2026-11-10');
    b.receive(paycheck('p4', '2026-11-20', 400_000));
    // Nov 6's pay period: 3,250.00 - 4,000.00 = -750.00. Now 12,000.00 - 4,000.00 = 8,000.00.
    const s = view(b, '2026-11-21').future.savings;
    expect(s).toMatchObject({ state: 'estimate', least: -75_000, most: 275_000 });
    if (s.state !== 'estimate') throw new Error('estimate');
    expect(s.low).toBe(addCents(800_000, -26 * 75_000));
  });

  it('40.12 with fewer than 3 such pay periods: not enough yet', () => {
    const b = book({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 300_000, heldForOthers: 0 } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(paycheck('p2', '2026-10-23', 300_000));
    b.receive(paycheck('p3', '2026-11-06', 500_000));
    // On Nov 7, with history from before setup day: Oct 9 and Oct 23 have ended; Nov 6's is current.
    // Now 1,000.00 + 2,750.00 + 2,250.00 + 3,250.00 = 9,250.00.
    expect(view(b, '2026-11-07', { before: before([]) }).future.savings).toEqual({ state: 'not-enough', now: 925_000, periods: 2 });
  });
});

describe('40.13 the old card', () => {
  function owing(promo: string | null): Book {
    const b = book({ oldCardDebt: 300_000, settings: { oldCardPromoEndDate: promo } });
    b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card'));
    return b;
  }

  it('40.13 what it owed when tracking started, at the end of each pay period, and now, as the books hold it', () => {
    const b = owing(null);
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(transfer('t2', '2026-10-12', 1, 'checking', 'old-card'));
    const o = view(b, '2026-10-12').future.oldCard;
    expect(o.owed).toEqual([
      { date: '2026-10-01', at: 'start', owed: 300_000 },
      { date: '2026-10-08', at: 'end', owed: 280_000 },
      { date: '2026-10-12', at: 'now', owed: 279_999 },
    ]);
    expect(o.owed[2]?.owed).toBe(b.oldCardDebt());
    expect(o.plan).toEqual({ state: 'no-promo-end-date' });
  });

  it('40.13 the plan: at each payday left before the promo end date, what it owes once that payday\'s share is paid, down to $0.00', () => {
    // 2,800.00 owed on Oct 5; paydays after today and before Nov 20 (not on it): Oct 9, Oct 23, Nov 6.
    // 9.5: 2,800.00 / 3 = 933.333..., up to 933.34 a payday.
    const o = view(owing('2026-11-20'), '2026-10-05').future.oldCard;
    expect(o.plan).toEqual({
      state: 'plan',
      promoEndDate: '2026-11-20',
      perPayday: 93_334,
      paydaysLeft: 3,
      paidOffBy: '2026-11-06',
      points: [
        { date: '2026-10-05', owed: 280_000 },
        { date: '2026-10-09', owed: 186_666 },
        { date: '2026-10-23', owed: 93_332 },
        { date: '2026-11-06', owed: 0 },
      ],
    });
  });

  it('40.13 the plan with exactly one payday left: all of it then', () => {
    const o = view(owing('2026-10-10'), '2026-10-05').future.oldCard;
    expect(o.plan).toMatchObject({ state: 'plan', perPayday: 280_000, paydaysLeft: 1, paidOffBy: '2026-10-09', points: [{ date: '2026-10-05', owed: 280_000 }, { date: '2026-10-09', owed: 0 }] });
  });

  it('40.13 no payday left before the promo end date: all of it is due now', () => {
    // The promo ends on the next payday: it does not count (9.5).
    expect(view(owing('2026-10-09'), '2026-10-05').future.oldCard.plan).toEqual({ state: 'due-now', promoEndDate: '2026-10-09', owed: 280_000 });
  });

  it('40.13 nothing owed: paid off, with or without a promo end date', () => {
    const b = book({ oldCardDebt: 20_000, settings: { oldCardPromoEndDate: '2027-03-31' } });
    b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card'));
    expect(view(b, '2026-10-05').future.oldCard.plan).toEqual({ state: 'paid-off' });
    expect(view(book(), '2026-10-05').future.oldCard.plan).toEqual({ state: 'paid-off' });
  });

  it('40.13 one cent owed: a plan of one cent', () => {
    const b = book({ oldCardDebt: 1, settings: { oldCardPromoEndDate: '2026-11-20' } });
    // 9.5: 0.01 / 3, up to 0.01; paid off at the first payday, and the plan ends there.
    expect(view(b, '2026-10-05').future.oldCard.plan).toEqual({ state: 'plan', promoEndDate: '2026-11-20', perPayday: 1, paydaysLeft: 3, paidOffBy: '2026-10-09', points: [{ date: '2026-10-05', owed: 1 }, { date: '2026-10-09', owed: 0 }] });
  });
});

describe('40.10 Future only reads', () => {
  it('40.10 working Future out changes nothing in the books', () => {
    const b = spending();
    const pots = b.pots();
    const debt = b.oldCardDebt();
    view(b, '2026-10-05');
    expect(b.pots()).toEqual(pots);
    expect(b.oldCardDebt()).toBe(debt);
  });
});
