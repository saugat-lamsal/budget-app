import { describe, expect, it } from 'vitest';
import { MOVABLE_POTS, type Book, type Pot } from '../src/index.js';
import { activityProblems } from './activity-helpers.js';
import { MOM_NAME, PAYROLL, START_DATE, cardCharge, codeOf, deposit, dropped, openTestBook, payPerson, paycheck, posted, purchase, refund, takenBack, transfer } from './helpers.js';

// What went in and out of a bucket this pay period (QUESTIONS.md B97 to
// B99), for the Buckets screen. Every row is what the book itself did to that
// bucket, so the list always explains the number: what the bucket held at the
// start, plus what came in, plus what went out, is what it holds now.

const RULES = [
  { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
] as const;
const START = { savings: 100_000, needs: 50_000, wants: 20_000, momReserve: 120_000, heldForOthers: 0 } as const;

function openBook(settings = {}): Book {
  return openTestBook({ pots: START, rules: RULES, settings });
}

// A row without the choices that come with it (those have their own tests).
function plain(book: Book, pot: Pot, period?: number) {
  const a = period === undefined ? book.activity(pot) : book.activity(pot, period);
  return { ...a, rows: a.rows.map(({ resort: _resort, ...row }) => row) };
}

describe('B97 a bucket\'s activity is what went in and out of it this pay period', () => {
  it('B97 before the first paycheck it is the stretch from setup day, with nothing yet', () => {
    const b = openBook();
    expect(plain(b, 'needs')).toEqual({
      pot: 'needs',
      period: { number: 0, startDate: START_DATE, endDate: null },
      opening: 50_000,
      in: 0,
      out: 0,
      closing: 50_000,
      rows: [],
    });
  });

  it('B97 4.1 a purchase a rule sorted is a row that took money out, on the day it was made', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    expect(plain(b, 'needs')).toMatchObject({
      opening: 50_000,
      in: 0,
      out: -3_250,
      closing: 46_750,
      rows: [{ id: 'g1', what: 'purchase', description: 'MADE UP GROCERY', date: '2026-10-02', account: 'everyday-card', amount: -3_250, other: null, pending: false, refunded: 0, partOfSplit: false }],
    });
    expect(plain(b, 'wants').rows).toEqual([]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B97 4.3 spending nobody has sorted yet is in no bucket, so it is on no list until it is sorted', () => {
    const b = openBook();
    b.receive(purchase('x1', '2026-10-02', 1_150, 'MADE UP CORNER STORE'));
    for (const pot of MOVABLE_POTS) expect(b.activity(pot).rows).toEqual([]);
    b.sort('x1', { to: 'needs' }, '2026-10-04');
    // It is listed on the day of the purchase, not the day it was sorted (4.1).
    expect(plain(b, 'needs').rows).toMatchObject([{ id: 'x1', date: '2026-10-02', amount: -1_150 }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B97 4.6 a pending charge is listed as pending, and its posted version replaces it as one row', () => {
    const b = openBook();
    b.receive(purchase('c1', '2026-10-02', 1_000, 'MADE UP CAFE', { pending: true }));
    expect(plain(b, 'wants').rows).toMatchObject([{ id: 'c1', amount: -1_000, pending: true }]);
    b.receive(posted('c1-posted', 'c1', '2026-10-03', 1_200, 'MADE UP CAFE'));
    // A tip: one row, with what the charge came to in the end.
    expect(plain(b, 'wants').rows).toMatchObject([{ id: 'c1', amount: -1_200, pending: false, date: '2026-10-02' }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B97 3.1 3.2 3.3 a paycheck starts a pay period; its share of each bucket is the first row', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.period()).toEqual({ number: 1, startDate: '2026-10-09' });
    expect(plain(b, 'needs')).toMatchObject({
      period: { number: 1, startDate: '2026-10-09', endDate: null },
      // What it held when the pay period began: the old pay period's leftover (3.4).
      opening: 50_000,
      in: 75_000,
      out: 0,
      closing: 125_000,
      rows: [{ id: 'p1', what: 'paycheck', description: `${PAYROLL} DIRECT DEP`, date: '2026-10-09', account: 'checking', amount: 75_000 }],
    });
    expect(plain(b, 'momReserve').rows).toMatchObject([{ id: 'p1', what: 'paycheck', amount: 150_000 }]);
    expect(plain(b, 'savings').rows).toMatchObject([{ id: 'p1', what: 'paycheck', amount: 125_000 }]);
    expect(plain(b, 'wants').rows).toMatchObject([{ id: 'p1', what: 'paycheck', amount: 50_000 }]);
    expect(plain(b, 'heldForOthers').rows).toEqual([]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B97 the pay period before is still there to read, ending where the next one began', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(plain(b, 'needs', 0)).toMatchObject({
      period: { number: 0, startDate: START_DATE, endDate: '2026-10-09' },
      opening: 50_000,
      out: -3_250,
      closing: 46_750,
      rows: [{ id: 'g1', amount: -3_250 }],
    });
    // The new pay period starts with what the old one ended with.
    expect(plain(b, 'needs', 1).opening).toBe(46_750);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B97 3.4 a leftover the setting moves to savings is a row in both buckets, from the payday', () => {
    const b = openBook({ leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    // Same day, so the one counted last is first: the paycheck is counted after the leftover moves.
    expect(plain(b, 'needs').rows).toMatchObject([
      { id: 'p1', what: 'paycheck', amount: 75_000 },
      { id: 'leftover:p1:needs', what: 'leftover', description: '', date: '2026-10-09', amount: -50_000, other: 'savings' },
    ]);
    expect(plain(b, 'savings').rows).toMatchObject([
      { id: 'p1', what: 'paycheck', amount: 125_000 },
      { id: 'leftover:p1:needs', what: 'leftover', amount: 50_000, other: 'needs' },
    ]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B97 3.4 a leftover you answer days later lands in the pay period you answered in, dated the payday', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(plain(b, 'savings').rows.map((r) => r.id)).toEqual(['p1']);
    b.answerLeftover('leftover:p1:needs', 'move-to-savings', '2026-10-12');
    expect(plain(b, 'needs').rows).toMatchObject([{ id: 'leftover:p1:needs', date: '2026-10-09', amount: -50_000 }, { id: 'p1' }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B97 3.4 rolling a leftover over moves nothing, so it is on no list', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.answerLeftover('leftover:p1:needs', 'roll-over', '2026-10-09');
    expect(plain(b, 'needs').rows.map((r) => r.id)).toEqual(['p1']);
    expect(plain(b, 'savings').rows.map((r) => r.id)).toEqual(['p1']);
  });

  it('B97 B4 a charge made before payday that is posted after it, at a new amount, is a row in the new pay period for the difference', () => {
    const b = openBook();
    b.receive(purchase('c1', '2026-10-08', 1_000, 'MADE UP CAFE', { pending: true }));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(posted('c1-posted', 'c1', '2026-10-10', 1_200, 'MADE UP CAFE'));
    // The old pay period had the $10.00; the new one has the $2.00 it grew by, dated the day of the purchase.
    expect(plain(b, 'wants', 0).rows).toMatchObject([{ id: 'c1', amount: -1_000 }]);
    expect(plain(b, 'wants', 1).rows).toMatchObject([{ id: 'p1', amount: 50_000 }, { id: 'c1', amount: -200, date: '2026-10-08', pending: false }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B97 B4 a charge made before payday that first shows after it counts in the pay period it was counted in', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(purchase('g1', '2026-10-07', 3_250, 'MADE UP GROCERY'));
    expect(plain(b, 'needs', 1).rows).toMatchObject([{ id: 'p1' }, { id: 'g1', date: '2026-10-07', amount: -3_250 }]);
    expect(plain(b, 'needs', 0).rows).toEqual([]);
    expect(activityProblems(b, START)).toEqual([]);
  });
});

describe('B98 each item is one row, with everything it did to the bucket this pay period added up', () => {
  it('4.7 B98 sorting a purchase another way moves its row to the other bucket right away', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.sort('g1', { to: 'wants' }, '2026-10-03');
    expect(plain(b, 'needs').rows).toEqual([]);
    expect(plain(b, 'wants').rows).toMatchObject([{ id: 'g1', amount: -3_250 }]);
    expect(plain(b, 'needs').closing).toBe(50_000);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('4.7 B98 sorting a purchase from an earlier pay period another way puts the money back in this one', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.sort('g1', { to: 'wants' }, '2026-10-10');
    // Needs gets the $32.50 back this pay period; wants pays it.
    expect(plain(b, 'needs', 1).rows).toMatchObject([{ id: 'p1' }, { id: 'g1', what: 'purchase', date: '2026-10-02', amount: 3_250 }]);
    expect(plain(b, 'wants', 1).rows).toMatchObject([{ id: 'p1' }, { id: 'g1', date: '2026-10-02', amount: -3_250 }]);
    // And the old pay period is as it was.
    expect(plain(b, 'needs', 0).rows).toMatchObject([{ id: 'g1', amount: -3_250 }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B98 4.4 a split purchase is a row in each bucket it was split across, with its own part, saying so', () => {
    const b = openBook();
    b.receive(purchase('h1', '2026-10-02', 9_000, 'MADE UP HARDWARE'));
    b.sort('h1', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-03');
    expect(plain(b, 'needs').rows).toMatchObject([{ id: 'h1', amount: -6_000, partOfSplit: true }]);
    expect(plain(b, 'wants').rows).toMatchObject([{ id: 'h1', amount: -3_000, partOfSplit: true }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B98 4.5 a part-refunded purchase shows what is left of it, and how much was refunded', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(refund('r1', '2026-10-04', 1_000, 'g1'));
    expect(plain(b, 'needs').rows).toMatchObject([{ id: 'g1', amount: -2_250, refunded: 1_000 }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B98 4.5 a purchase refunded in full stays on the list at $0.00, saying how much came back, so it can be seen', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(refund('r1', '2026-10-04', 3_250, 'g1'));
    expect(plain(b, 'needs')).toMatchObject({ in: 0, out: 0, closing: 50_000, rows: [{ id: 'g1', amount: 0, refunded: 3_250 }] });
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B98 4.5 a refund in a later pay period is money coming back into the bucket, on the purchase it belongs to', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(refund('r1', '2026-10-10', 3_250, 'g1'));
    expect(plain(b, 'needs', 1).rows).toMatchObject([{ id: 'p1' }, { id: 'g1', amount: 3_250, refunded: 3_250 }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B98 4.6 a pending charge the bank drops is gone from the list, as if it had never been there', () => {
    const b = openBook();
    b.receive(purchase('c1', '2026-10-02', 1_000, 'MADE UP CAFE', { pending: true }));
    b.receive(dropped('c1-dropped', 'c1', '2026-10-03'));
    expect(plain(b, 'wants')).toMatchObject({ in: 0, out: 0, closing: 20_000, rows: [] });
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B98 4.10 a charge the bank takes back is gone from the list too', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(takenBack('t1', 'g1', '2026-10-03'));
    expect(plain(b, 'needs').rows).toEqual([]);
    expect(plain(b, 'needs').closing).toBe(50_000);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B98 4.10 a paycheck the bank takes back keeps its pay period, and its money comes back out, so it is on no list', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(takenBack('t1', 'p1', '2026-10-10'));
    expect(b.period().number).toBe(1);
    expect(plain(b, 'needs', 1)).toMatchObject({ opening: 50_000, closing: 50_000, rows: [] });
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B98 4.10 a charge from an earlier pay period that the bank takes back puts its money back in this one', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(takenBack('t1', 'g1', '2026-10-10'));
    expect(plain(b, 'needs', 1).rows).toMatchObject([{ id: 'p1' }, { id: 'g1', amount: 3_250 }]);
    expect(plain(b, 'needs', 0).rows).toMatchObject([{ id: 'g1', amount: -3_250 }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B98 5.2 a payment to the old card from checking comes out of needs, and says so', () => {
    const b = openBook();
    b.receive(transfer('o1', '2026-10-03', 20_000, 'checking', 'old-card'));
    expect(plain(b, 'needs').rows).toMatchObject([{ id: 'o1', what: 'debt-payoff', amount: -20_000, account: 'checking' }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B98 4.8 a card fee sorted to needs is on its list', () => {
    const b = openBook();
    b.receive(cardCharge('f1', '2026-10-03', 3_500, 'fee'));
    b.sort('f1', { to: 'needs' }, '2026-10-04');
    expect(plain(b, 'needs').rows).toMatchObject([{ id: 'f1', what: 'card-fee', amount: -3_500, date: '2026-10-03' }]);
  });
});

describe('B98 money in, the mom reserve, held for others, and hand moves are rows too', () => {
  it('6.1 B98 a payback sorted into a bucket is money coming in, in that bucket', () => {
    const b = openBook();
    b.receive(deposit('d1', '2026-10-03', 5_000, 'MADE UP FRIEND'));
    b.sort('d1', { to: 'wants' }, '2026-10-03');
    expect(plain(b, 'wants').rows).toMatchObject([{ id: 'd1', what: 'payback', amount: 5_000, account: 'checking' }]);
    expect(plain(b, 'wants').in).toBe(5_000);
  });

  it('6.1 B98 other income is split between savings, needs and wants, a row in each', () => {
    const b = openBook();
    b.receive(deposit('d1', '2026-10-03', 10_000, 'MADE UP SIDE JOB'));
    b.sort('d1', { to: 'other-income' }, '2026-10-03');
    expect(plain(b, 'savings').rows).toMatchObject([{ id: 'd1', what: 'other-income', amount: 5_000 }]);
    expect(plain(b, 'needs').rows).toMatchObject([{ id: 'd1', what: 'other-income', amount: 3_000 }]);
    expect(plain(b, 'wants').rows).toMatchObject([{ id: 'd1', what: 'other-income', amount: 2_000 }]);
    expect(plain(b, 'momReserve').rows).toEqual([]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('7.1 7.2 B98 money marked not mine goes into held for others, and a payment marked not mine comes out of it', () => {
    const b = openBook();
    b.receive(deposit('d1', '2026-10-03', 12_000, 'MADE UP ROOMMATE'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-03');
    b.receive(payPerson('z1', '2026-10-04', 4_000, 'MADE UP LANDLORD'));
    b.sort('z1', { to: 'not-mine' }, '2026-10-04');
    expect(plain(b, 'heldForOthers')).toMatchObject({
      in: 12_000,
      out: -4_000,
      closing: 8_000,
      rows: [
        { id: 'z1', what: 'person-payment', amount: -4_000 },
        { id: 'd1', what: 'not-mine', amount: 12_000 },
      ],
    });
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('8.1 B98 a payment to mom comes out of the mom reserve and says so', () => {
    const b = openBook();
    b.receive(payPerson('m1', '2026-10-03', 50_000, MOM_NAME));
    expect(plain(b, 'momReserve')).toMatchObject({ opening: 120_000, out: -50_000, closing: 70_000, rows: [{ id: 'm1', what: 'mom', amount: -50_000, date: '2026-10-03' }] });
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('8.3 B98 the part of a mom payment the reserve cannot cover comes out of the bucket you pick, as its own row', () => {
    const b = openTestBook({ pots: { ...START, momReserve: 10_000 }, rules: RULES });
    b.receive(payPerson('m1', '2026-10-03', 25_000, MOM_NAME));
    expect(plain(b, 'momReserve').rows).toMatchObject([{ id: 'm1', what: 'mom', amount: -10_000 }]);
    expect(plain(b, 'needs').rows).toEqual([]);
    b.sort('m1:difference', { to: 'needs' }, '2026-10-04');
    expect(plain(b, 'needs').rows).toMatchObject([{ id: 'm1:difference', what: 'mom-difference', amount: -15_000, date: '2026-10-03' }]);
  });

  it('13.3 B98 a hand move is a row in both buckets, saying which way the money went and where to', () => {
    const b = openBook();
    b.moveMoney({ from: 'wants', to: 'needs', amount: 5_000 }, '2026-10-05');
    expect(plain(b, 'needs').rows).toMatchObject([{ id: 'move:1', what: 'move', description: '', date: '2026-10-05', account: null, amount: 5_000, other: 'wants' }]);
    expect(plain(b, 'wants').rows).toMatchObject([{ id: 'move:1', what: 'move', amount: -5_000, other: 'needs' }]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('0.1 13.3 a hand move that is refused does not use up a move number: the next one is still the first', () => {
    const MAX = Number.MAX_SAFE_INTEGER;
    // Needs is 100 cents from the most that can be exact, so 200 more into it is refused.
    const b = openTestBook({ pots: { needs: MAX - 100, wants: -1_000_000 } });
    expect(codeOf(() => b.moveMoney({ from: 'wants', to: 'needs', amount: 200, confirmed: true }, '2026-10-05'))).toBe('not-cents');
    b.moveMoney({ from: 'needs', to: 'wants', amount: 1_000 }, '2026-10-05');
    expect(plain(b, 'wants').rows).toMatchObject([{ id: 'move:1', amount: 1_000 }]);
  });

  it('13.3 13.4 B98 a confirmed move out of savings is a row; one that was only asked about is not', () => {
    const b = openBook();
    expect(b.moveMoney({ from: 'savings', to: 'needs', amount: 7_500 }, '2026-10-05')).toMatchObject({ moved: false });
    expect(plain(b, 'savings').rows).toEqual([]);
    b.moveMoney({ from: 'savings', to: 'needs', amount: 7_500, confirmed: true }, '2026-10-05');
    expect(plain(b, 'savings')).toMatchObject({ out: -7_500, rows: [{ id: 'move:1', amount: -7_500, other: 'needs' }] });
    expect(activityProblems(b, START)).toEqual([]);
  });
});

describe('B99 the newest item is first', () => {
  it('B99 by the day it happened, and on the same day the one counted last first', () => {
    const b = openBook();
    b.receive(purchase('a', '2026-10-02', 100, 'MADE UP GROCERY'));
    b.receive(purchase('b', '2026-10-04', 200, 'MADE UP GROCERY'));
    b.receive(purchase('c', '2026-10-03', 300, 'MADE UP GROCERY'));
    b.receive(purchase('d', '2026-10-04', 400, 'MADE UP GROCERY'));
    expect(plain(b, 'needs').rows.map((r) => r.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('B99 the paycheck is the oldest thing in its pay period', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(purchase('g1', '2026-10-09', 100, 'MADE UP GROCERY'));
    b.receive(purchase('g2', '2026-10-12', 100, 'MADE UP GROCERY'));
    expect(plain(b, 'needs').rows.map((r) => r.id)).toEqual(['g2', 'g1', 'p1']);
  });
});

describe('B97 the activity always adds up to the bucket, whatever has happened to the book', () => {
  it('12.2 B97 after a long mixed history every pay period of every bucket adds up and joins the next', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP CAFE', { pending: true }));
    b.receive(payPerson('m1', '2026-10-04', 50_000, MOM_NAME));
    b.moveMoney({ from: 'wants', to: 'needs', amount: 500 }, '2026-10-05');
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(posted('c1-posted', 'c1', '2026-10-10', 1_250, 'MADE UP CAFE'));
    b.answerLeftover('leftover:p1:needs', 'move-to-savings', '2026-10-10');
    b.answerLeftover('leftover:p1:wants', 'roll-over', '2026-10-10');
    b.receive(deposit('d1', '2026-10-11', 5_000, 'MADE UP FRIEND'));
    b.sort('d1', { to: 'needs' }, '2026-10-11');
    b.sort('g1', { to: 'wants' }, '2026-10-12');
    b.receive(refund('r1', '2026-10-13', 250, 'g1'));
    b.receive(paycheck('p2', '2026-10-23', 410_000));
    b.receive(takenBack('t1', 'c1', '2026-10-24'));
    expect(b.period().number).toBe(2);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('0.1 a refused change leaves no ghost rows: a payday refused after moving a leftover to savings changes no list', () => {
    const MAX = Number.MAX_SAFE_INTEGER;
    const b = openTestBook({ pots: { savings: MAX - 100_000, needs: 3_000 }, settings: { leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } } });
    const lists = () => JSON.stringify(MOVABLE_POTS.map((pot) => b.activity(pot)));
    const before = lists();
    expect(codeOf(() => b.receive(paycheck('p1', '2026-10-09', 400_000)))).toBe('not-cents');
    expect(lists()).toBe(before);
    expect(b.period().number).toBe(0);
    // Tried again, it is refused the same way and still leaves nothing behind.
    expect(codeOf(() => b.receive(paycheck('p1', '2026-10-09', 400_000)))).toBe('not-cents');
    expect(lists()).toBe(before);
    expect(activityProblems(b)).toEqual([]);
  });

  it('0.1 a refused re-sort leaves the lists as they were', () => {
    const HUGE = Number.MAX_SAFE_INTEGER - 1_000;
    const b = openTestBook({ pots: { needs: -HUGE } });
    b.receive(purchase('e1', '2026-10-05', 1_001, 'MADE UP STORE'));
    b.sort('e1', { to: 'wants' }, '2026-10-05');
    const before = JSON.stringify(MOVABLE_POTS.map((pot) => b.activity(pot)));
    expect(codeOf(() => b.sort('e1', { to: 'needs' }, '2026-10-06'))).toBe('not-cents');
    expect(JSON.stringify(MOVABLE_POTS.map((pot) => b.activity(pot)))).toBe(before);
  });

  it('a pay period that does not exist, or a bucket that is not one, is refused', () => {
    const b = openBook();
    expect(codeOf(() => b.activity('needs', 1))).toBe('unknown-period');
    expect(codeOf(() => b.activity('needs', -1))).toBe('unknown-period');
    expect(codeOf(() => b.activity('needs', 0.5))).toBe('unknown-period');
    expect(codeOf(() => b.activity('unsortedIn' as Pot))).toBe('bad-pot');
    expect(codeOf(() => b.activity('' as Pot))).toBe('bad-pot');
  });

  it('what the book gives back cannot be used to change it', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    const a = b.activity('needs');
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.rows)).toBe(true);
    expect(Object.isFrozen(a.rows[0])).toBe(true);
    expect(b.activity('needs').rows[0]?.amount).toBe(-3_250);
  });
});
