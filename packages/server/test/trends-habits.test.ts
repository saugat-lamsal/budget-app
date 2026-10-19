import { addCents, type Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { paycheck, purchase, transfer } from '../../money/test/helpers.js';
import { before, book, line, view } from './trends-setup.js';

// Trends, Habits (rulebook 40.10, 40.14 to 40.17, QUESTIONS.md A59, his OK
// Oct 19, 2026), worked out on the server from the books and the bank
// history kept from before setup day. Every number is worked out by hand in
// the comments. Every name and number is made up.
//
// The history's pay periods (40.3), every 14 days back from the last
// paycheck (Sep 25): Sep 11 to 24, Aug 28 to Sep 10, Aug 14 to 27, Jul 31 to
// Aug 13, Jul 17 to 30, and Jul 3 to 16, cut off by the history's first day
// (Jul 5). On Oct 6 the last 90 days are Jul 9 to Oct 6, so the full pay
// periods in them are the five from Jul 17 to Sep 24.

// From setup day: a grocery 32.50 (Fri Oct 2, needs), a cafe 10.00 (Sat
// Oct 3, wants), a shop 5.00 waiting in review (Sun Oct 4), and 200.00 to the
// old card (Mon Oct 5, left out of habits).
function spending(b: Book = book()): Book {
  b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
  b.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP CAFE'));
  b.receive(purchase('u1', '2026-10-04', 500, 'MADE UP SHOP'));
  b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card'));
  return b;
}

const HISTORY = [
  line('e1', 'checking', '2026-09-11', 3_000, 'PURCHASE GREEN GROCERY'), // Fri, day 1 of Sep 11 to 24
  line('e2', 'checking', '2026-09-13', 1_500, 'PURCHASE GREEN GROCERY'), // Sun, day 3
  line('e3', 'checking', '2026-09-14', 1_100, 'PURCHASE GREEN GROCERY'), // Mon, day 4
  line('e4', 'checking', '2026-09-24', 99, 'PURCHASE GREEN GROCERY'), // Thu, day 14
  line('e5', 'checking', '2026-09-12', 50_000, 'ONLINE payment to CRD 4444'), // the old card: left out
  line('e6', 'checking', '2026-09-30', 1_200, 'PURCHASE GREEN GROCERY'), // Wed, in the pay period setup day fell in (current)
  line('e7', 'checking', '2026-07-08', 777, 'PURCHASE GREEN GROCERY'), // before the 90 days, in the cut-off pay period
];

describe('40.14 the payday effect', () => {
  it('40.14 per day on payday and the 2 days after, against per day on the rest, over the full pay periods in the last 90 days', () => {
    const h = view(spending(), '2026-10-06', { before: before(HISTORY) }).habits.paydayEffect;
    // Days 1 to 3: 5 pay periods x 3 = 15 days, 30.00 + 15.00 = 45.00, so 3.00 a day.
    // The rest: 5 x 11 = 55 days, 11.00 + 0.99 = 11.99, so 0.218 a day, rounded down to 0.21.
    expect(h).toMatchObject({ state: 'known', periods: 5, first: { days: 15, total: 4_500, perDay: 300 }, rest: { days: 55, total: 1_199, perDay: 21 } });
    if (h.state !== 'known') throw new Error('known');
    // Tapping either lists its items, newest first; the old card payment is not one.
    expect(h.first.items.map((i) => i.id)).toEqual(['e2', 'e1']);
    expect(h.rest.items.map((i) => i.id)).toEqual(['e4', 'e3']);
    expect(addCents(0, ...h.first.items.map((i) => i.amount))).toBe(h.first.total);
    expect(addCents(0, ...h.rest.items.map((i) => i.amount))).toBe(h.rest.total);
  });

  it('40.14 more money back than spent: a negative per day, rounded down (away from zero)', () => {
    // Money back on the card, sorted to wants by its rule (40.2): -10.00 over the 15 days 1 to 3 is -0.666..., down to -0.67.
    const lines = [line('back', 'everyday-card', '2026-09-11', -1_000, 'BLUE CAFE')];
    const h = view(spending(), '2026-10-06', { before: before(lines) }).habits.paydayEffect;
    expect(h).toMatchObject({ state: 'known', first: { days: 15, total: -1_000, perDay: -67 } });
  });

  it('40.14 day 3 and day 4 are the boundary', () => {
    const lines = [line('d3', 'checking', '2026-08-30', 1, 'PURCHASE GREEN GROCERY'), line('d4', 'checking', '2026-08-31', 2, 'PURCHASE GREEN GROCERY')];
    const h = view(spending(), '2026-10-06', { before: before(lines) }).habits.paydayEffect;
    // Aug 28 is day 1 of its pay period: Aug 30 is day 3, Aug 31 day 4.
    expect(h).toMatchObject({ state: 'known', first: { total: 1 }, rest: { total: 2 } });
  });

  it('40.14 an item is placed by the day it is dated, not the pay period the books counted it in', () => {
    const b = spending();
    b.receive(paycheck('pay', '2026-10-09', 400_000));
    b.receive(paycheck('pay2', '2026-10-23', 400_000));
    // Counted in the pay period from Oct 23, but dated Oct 22: day 14 of Oct 9's.
    b.receive(purchase('late', '2026-10-22', 4_000, 'MADE UP CAFE'));
    const h = view(b, '2026-10-24', { before: before([]) }).habits.paydayEffect;
    expect(h.state).toBe('known');
    if (h.state !== 'known') throw new Error('known');
    expect(h.rest.items.map((i) => i.id)).toContain('late');
  });

  it('40.14 with fewer than 3 full pay periods: not enough yet', () => {
    // History from Sep 1: Aug 28 to Sep 10 is cut off; only Sep 11 to 24 is full.
    expect(view(spending(), '2026-10-06', { before: before(HISTORY, { historyFrom: '2026-09-01' }) }).habits.paydayEffect).toEqual({ state: 'not-enough', fullPeriods: 1 });
    expect(view(spending(), '2026-10-06').habits.paydayEffect).toEqual({ state: 'not-enough', fullPeriods: 0 });
    // History from Aug 20: Aug 14 to 27 is cut off; Aug 28 to Sep 10 and Sep 11 to 24 are full. Two are not enough.
    expect(view(spending(), '2026-10-06', { before: before(HISTORY, { historyFrom: '2026-08-20' }) }).habits.paydayEffect).toEqual({ state: 'not-enough', fullPeriods: 2 });
  });
});

describe('40.15 day of the week', () => {
  it('40.15 each weekday\'s total and an average one, the most named, and the totals add up to the 90 days without old card payments', () => {
    const v = view(spending(), '2026-10-06', { before: before(HISTORY) });
    const w = v.habits.weekdays;
    // Jul 9 (Thu) to Oct 6 (Tue): 12 weeks and 6 days, so 13 of every weekday but Wednesday's 12.
    // Fri: 30.00 + 32.50 = 62.50 / 13 = 4.807..., down to 4.80. Sat: 10.00 / 13 = 0.76.
    // Sun: 15.00 + 5.00 = 20.00 / 13 = 1.53. Mon: 11.00 / 13 = 0.84. Thu: 0.99 / 13 = 0.07.
    // Wed: 12.00 / 12 = 1.00 exactly. Tue: nothing. Jul 8 is outside the 90 days.
    expect(w.from).toBe('2026-07-09');
    expect(w.to).toBe('2026-10-06');
    expect(w.days.map((d) => [d.weekday, d.days, d.total, d.average])).toEqual([
      [1, 13, 1_100, 84],
      [2, 13, 0, 0],
      [3, 12, 1_200, 100],
      [4, 13, 99, 7],
      [5, 13, 6_250, 480],
      [6, 13, 1_000, 76],
      [0, 13, 2_000, 153],
    ]);
    expect(w.most).toBe(5);
    expect(w.total).toBe(11_649);
    const oldCard = v.places.groups.find((g) => g.kind === 'old-card')?.amount ?? 0;
    expect(w.total).toBe(v.places.total - oldCard);
    for (const d of w.days) expect(addCents(0, ...d.items.map((i) => i.amount))).toBe(d.total);
    expect(w.days.flatMap((d) => d.items).some((i) => i.part === 'old-card')).toBe(false);
  });

  it('40.15 nothing spent: no weekday is named', () => {
    const w = view(book(), '2026-10-06').habits.weekdays;
    expect(w.most).toBeNull();
    expect(w.total).toBe(0);
  });

  it('40.15 a tie goes to the first weekday from Monday', () => {
    const b = book();
    b.receive(purchase('a', '2026-10-02', 1_300, 'MADE UP CAFE')); // Fri
    b.receive(purchase('b', '2026-10-05', 1_300, 'MADE UP CAFE')); // Mon
    expect(view(b, '2026-10-06').habits.weekdays.most).toBe(1);
  });
});

// Three small places on the everyday card first, so the repeat's name is not
// on most of his purchases there (13.8).
const OTHERS = [
  line('n1', 'everyday-card', '2026-07-06', 900, 'CORNER BAKERY'),
  line('n2', 'everyday-card', '2026-07-07', 1_200, 'CITY BOOKS'),
  line('n3', 'everyday-card', '2026-07-08', 700, 'GREEN LEAF'),
];
const MONTHLY = [
  line('s1', 'everyday-card', '2026-07-20', 1_599, 'STREAMFLIX MONTHLY'),
  line('s2', 'everyday-card', '2026-08-20', 1_599, 'STREAMFLIX MONTHLY'),
  line('s3', 'everyday-card', '2026-09-19', 1_649, 'STREAMFLIX MONTHLY'),
];

describe('40.16 repeat charges', () => {
  it('40.16 three charges a month apart, within 10%: how often, the newest, the next one and a year of it', () => {
    const r = view(spending(), '2026-10-06', { before: before([...OTHERS, ...MONTHLY]) }).habits.repeats;
    // Gaps 31 and 30 days: every month. The newest 16.49 on Sep 19; the next
    // Sep 19 + 30 = Oct 19; a year 16.49 x 12 = 197.88.
    expect(r.map(({ items, ...rest }) => ({ ...rest, ids: items.map((i) => i.id) }))).toEqual([
      { name: 'STREAMFLIX MONTHLY', every: 'month', newestDate: '2026-09-19', newestAmount: 1_649, next: '2026-10-19', perYear: 19_788, ids: ['s3', 's2', 's1'] },
    ]);
  });

  it('40.16 still going up to the newest plus 33 days for a monthly one, and not a day after', () => {
    const at = (today: string) => view(spending(), today, { before: before([...OTHERS, ...MONTHLY]) }).habits.repeats.length;
    expect(at('2026-10-22')).toBe(1);
    expect(at('2026-10-23')).toBe(0);
  });

  it('40.16 exactly 10% off the newest is within; one cent more is not', () => {
    const lines = (oldest: number) => [...OTHERS, line('s1', 'everyday-card', '2026-07-20', oldest, 'STREAMFLIX MONTHLY'), line('s2', 'everyday-card', '2026-08-20', 1_650, 'STREAMFLIX MONTHLY'), line('s3', 'everyday-card', '2026-09-19', 1_650, 'STREAMFLIX MONTHLY')];
    expect(view(spending(), '2026-10-06', { before: before(lines(1_485)) }).habits.repeats).toHaveLength(1);
    expect(view(spending(), '2026-10-06', { before: before(lines(1_484)) }).habits.repeats).toHaveLength(0);
    expect(view(spending(), '2026-10-06', { before: before(lines(1_815)) }).habits.repeats).toHaveLength(1);
    expect(view(spending(), '2026-10-06', { before: before(lines(1_816)) }).habits.repeats).toHaveLength(0);
  });

  it('40.16 two charges are not enough, and gaps of two kinds are not a repeat', () => {
    expect(view(spending(), '2026-10-06', { before: before([...OTHERS, ...MONTHLY.slice(1)]) }).habits.repeats).toHaveLength(0);
    const mixed = [...OTHERS, line('s1', 'everyday-card', '2026-08-13', 1_599, 'STREAMFLIX MONTHLY'), ...MONTHLY.slice(1)];
    // Gaps 7 and 30.
    expect(view(spending(), '2026-10-06', { before: before(mixed) }).habits.repeats).toHaveLength(0);
  });

  it('40.16 the gap bands\' edges: 6 and 8 days are weekly, 5 and 9 are not', () => {
    const weekly = (a: string, b: string, c: string) => [...OTHERS, line('w1', 'everyday-card', a, 500, 'GYM PASS'), line('w2', 'everyday-card', b, 500, 'GYM PASS'), line('w3', 'everyday-card', c, 500, 'GYM PASS')];
    const found = (lines: ReturnType<typeof weekly>) => view(book(), '2026-10-01', { before: before(lines) }).habits.repeats.map((r) => r.every);
    // On setup day, Oct 1.
    expect(found(weekly('2026-09-16', '2026-09-22', '2026-09-30'))).toEqual(['week']);
    expect(found(weekly('2026-09-18', '2026-09-23', '2026-09-30'))).toEqual([]);
    expect(found(weekly('2026-09-14', '2026-09-21', '2026-09-30'))).toEqual([]);
    expect(found(weekly('2026-09-01', '2026-09-15', '2026-09-30'))).toEqual(['two-weeks']);
  });

  it('40.16 found across the history and the books, the year of a weekly one is 52 times, and money back is not a charge', () => {
    const b = book();
    // On the same day as the first in the books, so its name is not on most of them (13.8).
    b.receive(purchase('c1', '2026-10-01', 1_000, 'MADE UP CAFE'));
    b.receive(purchase('g1', '2026-10-01', 3_250, 'MADE UP GROCERY'));
    b.receive(purchase('y2', '2026-10-01', 2_500, 'GYM PASS'));
    b.receive(purchase('y3', '2026-10-08', 2_500, 'GYM PASS'));
    const lines = [...OTHERS, line('y1', 'everyday-card', '2026-09-24', 2_500, 'GYM PASS'), line('y0', 'everyday-card', '2026-09-20', -2_500, 'GYM PASS')];
    const r = view(b, '2026-10-09', { before: before(lines) }).habits.repeats;
    expect(r.map((x) => [x.name, x.every, x.newestDate, x.next, x.perYear, x.items.map((i) => i.id)])).toEqual([['GYM PASS', 'week', '2026-10-08', '2026-10-15', 130_000, ['y3', 'y2', 'y1']]]);
  });

  it('40.16 the biggest year first', () => {
    const lines = [
      ...OTHERS,
      ...MONTHLY,
      line('w1', 'everyday-card', '2026-09-15', 500, 'GYM PASS'),
      line('w2', 'everyday-card', '2026-09-22', 500, 'GYM PASS'),
      line('w3', 'everyday-card', '2026-09-29', 500, 'GYM PASS'),
    ];
    // Weekly 5.00 x 52 = 260.00 a year; monthly 197.88.
    const r = view(book(), '2026-10-01', { before: before(lines) }).habits.repeats;
    expect(r.map((x) => [x.name, x.perYear])).toEqual([
      ['GYM PASS', 26_000],
      ['STREAMFLIX MONTHLY', 19_788],
    ]);
  });
});

describe('40.17 the Wants streak', () => {
  // Wants starts at 300.00. A paycheck of 4,000.00 adds 500.00 to Wants (3.3).
  function periods(spend: readonly number[]): Book {
    const b = book();
    const paydays = ['2026-10-09', '2026-10-23', '2026-11-06'];
    spend.forEach((amount, k) => {
      if (k > 0) b.receive(paycheck(`pay${k}`, paydays[k - 1] as string, 400_000));
      if (amount > 0) b.receive(purchase(`c${k}`, k === 0 ? '2026-10-02' : (paydays[k - 1] as string), amount, 'MADE UP CAFE'));
    });
    return b;
  }

  it('40.17 how many in a row, newest back, ended with Wants at $0.00 or more, and the best run', () => {
    // Oct 1: 300.00 - 400.00 = -100.00 (over). Oct 9: -100.00 + 500.00 - 100.00 = 300.00. Oct 23: 300.00 + 500.00 = 800.00. Nov 6: current.
    const b = periods([40_000, 10_000, 0, 0]);
    expect(view(b, '2026-11-07').habits.streak).toEqual({ ended: 3, current: 2, best: 2, lastOver: false });
    expect(b.periodSummary(0).closing.wants).toBe(-10_000);
  });

  it('40.17 exactly $0.00 at the end counts; one cent below does not', () => {
    expect(view(periods([30_000, 0, 0, 0]), '2026-11-07').habits.streak).toEqual({ ended: 3, current: 3, best: 3, lastOver: false });
    // Oct 23: 800.00 + 500.00 - 1,300.01 = -0.01.
    expect(view(periods([0, 0, 130_001, 0]), '2026-11-07').habits.streak).toEqual({ ended: 3, current: 0, best: 2, lastOver: true });
  });

  it('40.17 none ended yet', () => {
    expect(view(spending(), '2026-10-06').habits.streak).toEqual({ ended: 0, current: 0, best: 0, lastOver: false });
  });

  it('40.17 the current pay period counts only once it ends', () => {
    // Over now, in the current pay period: not counted.
    expect(view(periods([0, 0, 0, 200_000]), '2026-11-07').habits.streak).toEqual({ ended: 3, current: 3, best: 3, lastOver: false });
  });
});

describe('40.10 Habits only read', () => {
  it('40.10 working Habits out changes nothing in the books', () => {
    const b = spending();
    const pots = b.pots();
    view(b, '2026-10-06', { before: before(HISTORY) });
    expect(b.pots()).toEqual(pots);
  });
});
