import { describe, expect, it } from 'vitest';
import { addCents, paydaysBefore, subtractCents, type Book, type IsoDate } from '../src/index.js';
import { busyBook } from './busy-book.js';
import { codeOf, openTestBook, payPerson, paycheck, posted, purchase, refund, transfer } from './helpers.js';

// Section 40 (QUESTIONS.md A58, his OK Oct 18, 2026): the money math's two
// pieces the Trends tab reads. The pay schedule going back from the last
// paycheck he gave on setup day (40.3), and the place's name in an item, as
// 13.8 finds it (40.6). Every store, person and number is made up.

function first(n: number, from: Generator<IsoDate>): IsoDate[] {
  const out: IsoDate[] = [];
  for (const day of from) {
    out.push(day);
    if (out.length === n) break;
  }
  return out;
}

const TWICE = { paySchedule: 'twice-a-month', payScheduleDays: 14 } as const;
const EVERY_14 = { paySchedule: 'every-n-days', payScheduleDays: 14 } as const;

describe('40.3 the pay schedule going back from the last paycheck', () => {
  it('40.3 every 14 days: the last paycheck less 14 days at a time', () => {
    expect(first(4, paydaysBefore('2026-09-25', EVERY_14))).toEqual(['2026-09-11', '2026-08-28', '2026-08-14', '2026-07-31']);
    expect(first(2, paydaysBefore('2026-09-25', 1))).toEqual(['2026-09-24', '2026-09-23']);
  });

  it('40.3 twice a month, on time: the 15th and the last day before it, a weekend day moved to the Friday before', () => {
    // Oct 15 2026 is a Thursday; Aug 15 a Saturday (so Friday Aug 14).
    expect(first(5, paydaysBefore('2026-10-15', TWICE))).toEqual(['2026-09-30', '2026-09-15', '2026-08-31', '2026-08-14', '2026-07-31']);
  });

  it('40.3 twice a month, a paycheck two days early belongs to the scheduled payday after it: the ones before that are the pay schedule going back', () => {
    expect(first(2, paydaysBefore('2026-10-13', TWICE))).toEqual(['2026-09-30', '2026-09-15']);
  });

  it('40.3 twice a month, a paycheck two days late belongs to the scheduled payday before it, which is not given again', () => {
    expect(first(2, paydaysBefore('2026-10-17', TWICE))).toEqual(['2026-09-30', '2026-09-15']);
  });

  it('40.3 twice a month, exactly halfway between two scheduled paydays counts as the earlier, as going forward does', () => {
    // Jan 30 2026 (Friday, Jan 31 is a Saturday) and Feb 13 (Friday, Feb 15 is a Sunday): Feb 6 is 7 days from each.
    expect(first(3, paydaysBefore('2026-02-06', TWICE))).toEqual(['2026-01-15', '2025-12-31', '2025-12-15']);
    // One day later it belongs to Feb 13.
    expect(first(2, paydaysBefore('2026-02-07', TWICE))).toEqual(['2026-01-30', '2026-01-15']);
  });

  it('40.3 twice a month across a year and through February', () => {
    expect(first(4, paydaysBefore('2027-03-15', TWICE))).toEqual(['2027-02-26', '2027-02-15', '2027-01-29', '2027-01-15']);
  });

  it('40.3 a date that is not one is refused', () => {
    expect(codeOf(() => paydaysBefore('2026-13-01', TWICE).next())).toBe('not-a-date');
  });
});

describe('40.6 the place in an item, as 13.8 finds it', () => {
  function book() {
    const b = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 50_000, heldForOthers: 0 } });
    b.receive(purchase('o1', '2026-10-01', 900, 'PURCHASE 10/01 CORNER BAKERY', { account: 'checking' }));
    b.receive(purchase('o2', '2026-10-01', 1_200, 'PURCHASE 10/01 CITY BOOKS', { account: 'checking' }));
    return b;
  }

  it('40.6 a purchase: the longest run of words with no digits, without the words on most of his purchases on that account', () => {
    const b = book();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'PURCHASE 10/02 GREEN LEAF MARKET', { account: 'checking' }));
    expect(b.placeName('g1')).toBe('GREEN LEAF MARKET');
    expect(b.placeName('o1')).toBe('CORNER BAKERY');
  });

  it('40.6 the description as it first showed up, not as it posted', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-02', 1_000, 'PENDING GREEN LEAF', { account: 'checking', pending: true }));
    b.receive(posted('p1-posted', 'p1', '2026-10-03', 1_100, 'PURCHASE 10/02 GREEN LEAF MARKET', 'checking'));
    expect(b.placeName('p1')).toBe('PENDING GREEN LEAF');
    // Asked for by the posted one's id, it is the same item.
    expect(b.placeName('p1-posted')).toBe('PENDING GREEN LEAF');
  });

  it('40.6 a payment to a person has a name too', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-02', 2_000, 'MADE UP FRIEND 0412'));
    b.receive(payPerson('z2', '2026-10-02', 1_000, 'MADE UP ROOMMATE 0413'));
    b.receive(payPerson('z3', '2026-10-02', 1_500, 'MADE UP COUSIN 0414'));
    // ZELLE TO is on every payment to a person on checking, so it is not the name.
    expect(b.placeName('z1')).toBe('FRIEND');
  });

  it('40.6 no word left: no name', () => {
    const b = book();
    b.receive(purchase('n1', '2026-10-02', 500, '10/02 4417 #99', { account: 'checking' }));
    expect(b.placeName('n1')).toBeNull();
  });

  it('40.6 an item the book does not have is refused', () => {
    expect(codeOf(() => book().placeName('nope'))).toBe('unknown-item');
  });
});

// Every pay period's spent items, bucket by bucket, add up to minus that pay
// period's spending in the ledger (periodSummary), to the cent.
function addsUp(b: Book): void {
  for (let n = 0; n <= b.period().number; n += 1) {
    const summary = b.periodSummary(n);
    const items = b.spentIn(n);
    for (const pot of ['needs', 'wants'] as const) {
      expect(addCents(0, ...items.filter((i) => i.pot === pot).map((i) => i.amount))).toBe(subtractCents(0, summary.byKind[pot].spending));
    }
  }
}

describe('40.2 what each item spent in a pay period, from the ledger', () => {
  const START = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 50_000, heldForOthers: 0 } as const;
  const RULES = [
    { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
    { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
  ] as const;

  it('40.2 purchases in their buckets, a split in both, a refund taken off, an old card payment in needs; a hand move is not spending', () => {
    const b = openTestBook({ pots: START, rules: RULES });
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP CAFE'));
    b.receive(purchase('s1', '2026-10-03', 12_000, 'MADE UP SHOP'));
    b.sort('s1', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 2_000 }] }, '2026-10-04');
    b.receive(refund('r1', '2026-10-05', 250, 'g1'));
    b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card'));
    b.moveMoney({ from: 'wants', to: 'needs', amount: 500 }, '2026-10-05');
    const items = b.spentIn();
    const find = (id: string, pot: string) => items.find((i) => i.id === id && i.pot === pot);
    expect(find('g1', 'needs')).toMatchObject({ amount: 3_000, date: '2026-10-02', description: 'MADE UP GROCERY', account: 'everyday-card', kind: 'purchase' });
    expect(find('c1', 'wants')).toMatchObject({ amount: 1_000, kind: 'purchase' });
    expect(find('s1', 'needs')).toMatchObject({ amount: 10_000 });
    expect(find('s1', 'wants')).toMatchObject({ amount: 2_000 });
    expect(find('t1', 'needs')).toMatchObject({ amount: 20_000, kind: 'debt-payoff', account: 'checking' });
    // Nothing else: the hand move is not spending.
    expect(items).toHaveLength(5);
    addsUp(b);
  });

  it('40.2 a purchase refunded in full spent nothing and is left out; one cent left is one cent', () => {
    const b = openTestBook({ pots: START, rules: RULES });
    b.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP CAFE'));
    b.receive(purchase('c2', '2026-10-03', 1_000, 'MADE UP CAFE'));
    b.receive(refund('r1', '2026-10-05', 1_000, 'c1'));
    b.receive(refund('r2', '2026-10-05', 999, 'c2'));
    expect(b.spentIn().map((i) => [i.id, i.amount])).toEqual([['c2', 1]]);
    addsUp(b);
  });

  it('40.2 spending is counted in the pay period the books counted it in, even when it is dated before', () => {
    const b = openTestBook({ pots: START, rules: RULES });
    b.receive(purchase('before', '2026-10-02', 700, 'MADE UP CAFE'));
    b.receive(paycheck('pay', '2026-10-09', 400_000));
    b.receive(purchase('late', '2026-10-08', 900, 'MADE UP CAFE'));
    expect(b.spentIn(0).map((i) => i.id)).toEqual(['before']);
    expect(b.spentIn(1)).toMatchObject([{ id: 'late', date: '2026-10-08', amount: 900 }]);
    addsUp(b);
  });

  it('40.2 a very large amount and a busy book add up to the ledger exactly', () => {
    const b = openTestBook({ pots: { ...START, needs: 9_000_000_000_000 }, rules: RULES });
    b.receive(purchase('big', '2026-10-02', 8_999_999_999_999, 'MADE UP GROCERY'));
    expect(b.spentIn()).toMatchObject([{ id: 'big', amount: 8_999_999_999_999 }]);
    addsUp(b);
    addsUp(busyBook());
  });

  it('40.2 a pay period that does not exist is refused', () => {
    expect(codeOf(() => openTestBook().spentIn(1))).toBe('unknown-period');
  });
});
