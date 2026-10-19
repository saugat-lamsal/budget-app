import { addCents, subtractCents, type BankBalances, type Book, type Cents, type IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { appSide, openTestBook, paycheck, purchase, transfer, type TestBookOptions } from '../../money/test/helpers.js';
import { checkBankRules } from '../src/bank/reading.js';
import { middleOf, readBeforeSetup, trendsView, type BeforeSetup, type HistoryLine, type TrendsInput } from '../src/trends.js';
import type { TrendsPeriod, TrendsView } from '../src/views/trends.js';
import { everything } from './keeper-harness.js';

// The Trends tab (rulebook section 40, QUESTIONS.md A58), worked out on the
// server from the books and the bank history kept from before setup day.
// Every number here is worked out by hand in the comments. Every name and
// number is made up. The books open on Oct 1, 2026 (setup day), the last
// paycheck Sep 25, paid every 14 days, so the next payday is Oct 9.

const START = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 50_000, heldForOthers: 0 } as const;
const RULES = [
  { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
  { id: 'roommate', for: 'person', contains: 'MADE UP ROOMMATE', choice: { to: 'wants' } },
] as const;

const BANK_RULES = checkBankRules([
  { id: 'chk-old', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
  { id: 'sav-old', account: 'savings', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
  { id: 'chk-sav', account: 'checking', contains: 'transfer to SAV 2222', means: 'transfer', other: 'savings' },
  { id: 'zelle', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' },
  { id: 'zelle-sav', account: 'savings', contains: 'Zelle payment to', means: 'payment-to-person' },
  { id: 'interest', account: 'everyday-card', contains: 'INTEREST CHARGE', means: 'card-interest' },
]);

function book(options: TestBookOptions = {}): Book {
  return openTestBook({ pots: START, rules: RULES, ...options });
}

function matchingBank(b: Book): BankBalances {
  return { checking: appSide(b.pots()) - b.inTransit().total, savings: 0, everydayCard: 0 };
}

function view(b: Book | null, today: IsoDate, over: Partial<TrendsInput> = {}): Extract<TrendsView, { state: 'tracking' }> {
  const v = trendsView({ today, book: b, bank: b === null ? null : matchingBank(b), madeUpData: false, before: null, ...over });
  if (v.state !== 'tracking') throw new Error(`expected tracking, got ${v.state}`);
  return v;
}

// Plaid's sign: positive is money out of the account.
const line = (id: string, account: HistoryLine['account'], date: IsoDate, amount: Cents, description: string): HistoryLine => ({ id, account, date, amount, description });

function before(lines: readonly HistoryLine[], over: Partial<BeforeSetup> = {}): BeforeSetup {
  return { setupDay: '2026-10-01', lastPaycheckDate: '2026-09-25', historyFrom: '2026-07-05', lines, bankRules: BANK_RULES, ...over };
}

const sum = (amounts: readonly Cents[]): Cents => addCents(0, ...amounts);

// What the bars must always be: each part is its items added up, and the total is the parts.
function partsAddUp(p: TrendsPeriod): void {
  for (const part of ['needs', 'wants', 'old-card', 'unsorted'] as const) expect(sum(p.items.filter((i) => i.part === part).map((i) => i.amount))).toBe(p.spent[part]);
  expect(p.total).toBe(sum(Object.values(p.spent)));
}

// Scenario A: the books only. A grocery 32.50 (needs), a cafe 10.00 (wants),
// a shop 5.00 waiting in review, 200.00 to the old card from checking (needs),
// and 5.00 moved from wants to needs by hand (not spending).
function scenarioA(): Book {
  const b = book();
  b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
  b.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP CAFE'));
  b.receive(purchase('u1', '2026-10-04', 500, 'MADE UP SHOP'));
  b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card'));
  b.moveMoney({ from: 'wants', to: 'needs', amount: 500 }, '2026-10-05');
  return b;
}

describe('40.1 Trends starts with tracking', () => {
  it('40.1 before setup day there is nothing to show, and it says so', () => {
    expect(trendsView({ today: '2026-10-01', book: null, bank: null, madeUpData: true, before: null })).toEqual({ state: 'not-set-up', madeUpData: true });
  });
});

describe('40.2 40.4 spending per pay period, from the books', () => {
  it('40.2 40.4 needs, wants, the old card payment and unsorted, each its items added up; a hand move is not spending', () => {
    const v = view(scenarioA(), '2026-10-06');
    expect(v.periods).toHaveLength(1);
    const p = v.periods[0] as TrendsPeriod;
    // Pay period 0, from setup day to the day before the next payday (Oct 9).
    expect(p).toMatchObject({ startDate: '2026-10-01', lastDay: '2026-10-08', current: true, beforeSetup: 'none' });
    // Needs: 32.50; the old card's 200.00 is its own part of needs. Wants 10.00. Unsorted 5.00. In all 247.50.
    expect(p.spent).toEqual({ needs: 3_250, wants: 1_000, 'old-card': 20_000, unsorted: 500 });
    expect(p.total).toBe(24_750);
    // Newest first.
    expect(p.items.map((i) => [i.id, i.part, i.amount])).toEqual([
      ['t1', 'old-card', 20_000],
      ['u1', 'unsorted', 500],
      ['c1', 'wants', 1_000],
      ['g1', 'needs', 3_250],
    ]);
    expect(p.items.every((i) => !i.beforeSetup)).toBe(true);
    partsAddUp(p);
  });

  it('40.2 40.3 a paycheck ends the pay period; spending dated before it but counted after is in the new one, as the bucket lists have it', () => {
    const b = scenarioA();
    b.receive(paycheck('pay', '2026-10-09', 400_000));
    b.receive(purchase('late', '2026-10-08', 900, 'MADE UP CAFE'));
    const v = view(b, '2026-10-10');
    expect(v.periods.map((p) => [p.startDate, p.lastDay, p.current, p.full])).toEqual([
      // With no bank history kept from before setup day, the first pay period
      // began on setup day, not a payday: cut off (40.3).
      ['2026-10-01', '2026-10-08', false, false],
      ['2026-10-09', '2026-10-22', true, false],
    ]);
    expect(v.periods[0]?.cutOff).toBe(true);
    // u1 still waits: unsorted shows in the current pay period until it is sorted.
    expect(v.periods[0]?.spent).toEqual({ needs: 3_250, wants: 1_000, 'old-card': 20_000, unsorted: 0 });
    expect(v.periods[1]?.spent).toEqual({ needs: 0, wants: 900, 'old-card': 0, unsorted: 500 });
    for (const p of v.periods) partsAddUp(p);
  });

  it('40.2 one cent, and a very large amount, to the cent', () => {
    const b = book({ pots: { ...START, needs: 9_000_000_000_000 } });
    b.receive(purchase('cent', '2026-10-02', 1, 'MADE UP CAFE'));
    b.receive(purchase('big', '2026-10-02', 8_999_999_999_999, 'MADE UP GROCERY'));
    const p = view(b, '2026-10-02').periods[0] as TrendsPeriod;
    expect(p.spent).toEqual({ needs: 8_999_999_999_999, wants: 1, 'old-card': 0, unsorted: 0 });
    expect(p.total).toBe(9_000_000_000_000);
  });
});

// Scenario B: the bank history from before setup day, with scenario A's books.
// The pay periods before setup day go back from the last paycheck (Sep 25) 14
// days at a time: Sep 11, Aug 28, Aug 14, Jul 31, Jul 17, and Jul 3, which
// began before the history (Jul 5): cut off.
const HISTORY: readonly HistoryLine[] = [
  // The pay period setup day fell in (Sep 25 on).
  line('h1', 'checking', '2026-09-28', 4_000, 'PURCHASE 09/28 GREEN GROCERY'), // needs (GROCERY)
  line('h0', 'checking', '2026-10-01', 600, 'PURCHASE 10/01 GREEN GROCERY'), // needs: on setup day, in the starting money
  line('h2', 'everyday-card', '2026-09-29', 1_500, 'BLUE CAFE'), // wants (CAFE)
  line('p1', 'everyday-card', '2026-09-30', 800, 'BLUE CAFE'), // wants: pending on setup day, at that amount
  line('h3', 'everyday-card', '2026-09-30', 2_000, 'CITY BOOKSHOP'), // unsorted: no rule
  line('h4', 'checking', '2026-09-26', 30_000, 'ONLINE payment to CRD 4444'), // old card, from checking
  line('h5', 'checking', '2026-09-27', 50_000, 'Zelle payment to Made Up Mom'), // the mom rule: not spending
  line('h7', 'checking', '2026-09-25', -400_000, 'ACME PAYROLL DIRECT DEP'), // money in: not spending
  // Sep 11 to Sep 24.
  line('h6', 'checking', '2026-09-20', 10_000, 'ONLINE transfer to SAV 2222'), // a transfer between his accounts: not spending
  line('h8', 'everyday-card', '2026-09-22', -500, 'BLUE CAFE REFUND'), // money back, sorted by CAFE: wants -5.00
  line('h9', 'old-card', '2026-09-15', 900, 'OLD STORE'), // a purchase on the old card: debt, not spending (5.4)
  line('h10', 'savings', '2026-09-16', 6_000, 'BILL PAY WATER'), // money leaving savings: waits (4.9), unsorted
  line('h11', 'everyday-card', '2026-09-17', 1_200, 'INTEREST CHARGE'), // interest on the everyday card: waits (4.8), unsorted
  line('h13', 'checking', '2026-09-12', 2_500, 'Zelle payment to MADE UP FRIEND'), // a payment to a person, no rule: unsorted
  line('h14', 'savings', '2026-09-13', 3_000, 'Zelle payment to MADE UP ROOMMATE'), // the roommate rule: wants
  line('h15', 'everyday-card', '2026-09-14', -300, 'SOME STORE CREDIT'), // money back no rule sorts: waits as money in, not spending
  // Aug 28 to Sep 10.
  line('h16', 'checking', '2026-09-01', -2_000, 'MADE UP REFUND'), // money in to checking: not spending
  line('h17', 'savings', '2026-09-02', 4_000, 'payment to CRD 4444'), // to the old card from savings: waits (5.2), unsorted
  // Jul 3 to Jul 16, cut off.
  line('h12', 'everyday-card', '2026-07-06', 700, 'BLUE CAFE'), // wants
];

describe('40.1 40.3 before setup day, read by today’s rules', () => {
  it('40.1 40.2 each item read the way new activity would be, and sorted by the sorting rules as they are now', () => {
    const settings = book().settings();
    const read = (l: HistoryLine) => readBeforeSetup(l, { rules: RULES, momRule: settings.momRule, bankRules: BANK_RULES });
    expect(HISTORY.map((l) => [l.id, read(l)?.part ?? null, read(l)?.amount ?? null])).toEqual([
      ['h1', 'needs', 4_000],
      ['h0', 'needs', 600],
      ['h2', 'wants', 1_500],
      ['p1', 'wants', 800],
      ['h3', 'unsorted', 2_000],
      ['h4', 'old-card', 30_000],
      ['h5', null, null],
      ['h7', null, null],
      ['h6', null, null],
      ['h8', 'wants', -500],
      ['h9', null, null],
      ['h10', 'unsorted', 6_000],
      ['h11', 'unsorted', 1_200],
      ['h13', 'unsorted', 2_500],
      ['h14', 'wants', 3_000],
      ['h15', null, null],
      ['h16', null, null],
      ['h17', 'unsorted', 4_000],
      ['h12', 'wants', 700],
    ]);
  });

  it('40.3 40.4 pay periods going back by the pay schedule; the one setup day fell in is one pay period, both parts; the oldest is cut off', () => {
    const v = view(scenarioA(), '2026-10-06', { before: before(HISTORY) });
    expect(v.historyFrom).toBe('2026-07-05');
    expect(v.setupDay).toBe('2026-10-01');
    expect(v.periods.map((p) => [p.startDate, p.lastDay, p.beforeSetup, p.cutOff, p.full, p.current])).toEqual([
      ['2026-07-03', '2026-07-16', 'all', true, false, false],
      ['2026-07-17', '2026-07-30', 'all', false, true, false],
      ['2026-07-31', '2026-08-13', 'all', false, true, false],
      ['2026-08-14', '2026-08-27', 'all', false, true, false],
      ['2026-08-28', '2026-09-10', 'all', false, true, false],
      ['2026-09-11', '2026-09-24', 'all', false, true, false],
      ['2026-09-25', '2026-10-08', 'part', false, false, true],
    ]);
    const spent = v.periods.map((p) => [p.startDate, p.spent.needs, p.spent.wants, p.spent['old-card'], p.spent.unsorted, p.total]);
    expect(spent).toEqual([
      ['2026-07-03', 0, 700, 0, 0, 700],
      ['2026-07-17', 0, 0, 0, 0, 0],
      ['2026-07-31', 0, 0, 0, 0, 0],
      ['2026-08-14', 0, 0, 0, 0, 0],
      ['2026-08-28', 0, 0, 0, 4_000, 4_000],
      // Wants: 30.00 - 5.00 = 25.00. Unsorted: 60.00 + 12.00 + 25.00 = 97.00.
      ['2026-09-11', 0, 2_500, 0, 9_700, 12_200],
      // Before setup day: needs 46.00, wants 23.00, old card 300.00, unsorted 20.00.
      // From setup day (scenario A): needs 32.50, wants 10.00, old card 200.00, unsorted 5.00.
      ['2026-09-25', 7_850, 3_300, 50_000, 2_500, 63_650],
    ]);
    for (const p of v.periods) partsAddUp(p);
    const setupPeriod = v.periods[6] as TrendsPeriod;
    expect(setupPeriod.items.filter((i) => i.beforeSetup).map((i) => i.id).sort()).toEqual(['h0', 'h1', 'h2', 'h3', 'h4', 'p1']);
    expect(setupPeriod.items.filter((i) => !i.beforeSetup).map((i) => i.id).sort()).toEqual(['c1', 'g1', 't1', 'u1']);
  });

  it('40.3 a pay period that began exactly on the first day of the history is full, and the oldest', () => {
    const v = view(scenarioA(), '2026-10-06', { before: before(HISTORY, { historyFrom: '2026-07-03' }) });
    expect(v.periods[0]).toMatchObject({ startDate: '2026-07-03', cutOff: false, full: true });
    // History from Jul 17, a payday: the pay period from Jul 3 is not there at all,
    // though Jul 16 is within the last 90 days.
    const late = view(scenarioA(), '2026-10-06', { before: before(HISTORY.filter((l) => l.date >= '2026-07-17'), { historyFrom: '2026-07-17' }) });
    expect(late.periods[0]).toMatchObject({ startDate: '2026-07-17', cutOff: false, full: true });
  });

  it('40.4 only the pay periods in the last 90 days, and the current one, are shown', () => {
    // Today Oct 20: 90 days back is Jul 23. The pay period Jul 3 to Jul 16 ended before it; Jul 17 to Jul 30 did not.
    const v = view(scenarioA(), '2026-10-20', { before: before(HISTORY) });
    expect(v.periods[0]?.startDate).toBe('2026-07-17');
    expect(v.periods.at(-1)?.current).toBe(true);
  });

  it('40.1 a rule changed later changes how the history reads, never the books', () => {
    const b = scenarioA();
    const withCafe = view(b, '2026-10-06', { before: before(HISTORY) });
    b.removeRule('cafe', '2026-10-06');
    const without = view(b, '2026-10-06', { before: before(HISTORY) });
    // Before setup day, Sep 11 to Sep 24: with CAFE, wants 30.00 - 5.00. Without it the
    // cafe refund is money in waiting, not spending; the roommate's 30.00 stays in wants.
    expect(withCafe.periods[5]?.spent.wants).toBe(2_500);
    expect(without.periods[5]?.spent).toMatchObject({ wants: 3_000, unsorted: 9_700 });
    // And Sep 25 on: BLUE CAFE 15.00 and 8.00 are now unsorted (20.00 + 23.00), the books' 5.00 too.
    expect(without.periods[6]?.spent).toMatchObject({ wants: 1_000, unsorted: 4_800 });
    // The books' own part did not move: c1 stays in wants.
    expect(without.periods[6]?.items.find((i) => i.id === 'c1')?.part).toBe('wants');
  });
});

describe('40.5 savings over time', () => {
  it('40.5 the savings bucket and the mom reserve when tracking started, at the end of each pay period, and now, each its own amount', () => {
    const b = book();
    b.receive(paycheck('pay', '2026-10-09', 400_000));
    // The paycheck: the mom reserve first, 1,500.00; the rest 2,500.00: savings 50% 1,250.00, needs 750.00, wants 500.00.
    expect(view(b, '2026-10-10').savings).toEqual([
      { date: '2026-10-01', at: 'start', savings: 100_000, momReserve: 50_000 },
      { date: '2026-10-08', at: 'end', savings: 100_000, momReserve: 50_000 },
      { date: '2026-10-10', at: 'now', savings: 225_000, momReserve: 200_000 },
    ]);
  });

  it('40.5 nothing before setup day, even with the bank history', () => {
    expect(view(book(), '2026-10-02', { before: before(HISTORY) }).savings.map((p) => p.at)).toEqual(['start', 'now']);
  });
});

describe('40.6 where it went, the last 90 days', () => {
  // Purchases with different names on the everyday card (so no word is on
  // most of them), three on checking (PURCHASE is on all three, so it is no
  // name), and the old card payment.
  function placesBook(): Book {
    const b = book({ rules: [] });
    const everyday: [string, Cents, string][] = [
      ['a1', 5_000, 'GREEN LEAF MARKET'],
      ['a2', 4_000, 'GREEN LEAF MARKET'],
      ['b1', 3_000, 'BLUE DOOR CAFE'],
      ['c1', 2_500, 'CITY BOOKS'],
      ['d1', 2_000, 'TACO TOWN'],
      ['e1', 1_500, 'RIVER GYM'],
      ['f1', 1_000, 'SUNNY NAILS'],
      ['n1', 700, '4417 #99'],
    ];
    for (const [id, amount, description] of everyday) b.receive(purchase(id, '2026-10-02', amount, description));
    // The same place written another way on another account is one place.
    b.receive(purchase('k1', '2026-10-03', 600, 'PURCHASE 10/03 Green Leaf Market', { account: 'checking' }));
    b.receive(purchase('k2', '2026-10-02', 400, 'PURCHASE 10/02 CORNER DELI', { account: 'checking' }));
    b.receive(purchase('k3', '2026-10-03', 300, 'PURCHASE 10/03 HARBOR FISH', { account: 'checking' }));
    b.receive(transfer('t1', '2026-10-05', 20_000, 'checking', 'old-card'));
    return b;
  }

  // Before setup day, on the everyday card: Jul 8 is 90 days before Oct 6 (out); Jul 9 is 89 (in).
  const OLD: readonly HistoryLine[] = [
    line('x1', 'everyday-card', '2026-07-08', 10_000, 'BLUE DOOR CAFE'),
    line('x2', 'everyday-card', '2026-07-09', 100, 'BLUE DOOR CAFE'),
    line('x3', 'everyday-card', '2026-07-09', 50, 'RIVER GYM'),
    line('x4', 'everyday-card', '2026-07-09', 25, 'SUNNY NAILS'),
  ];

  it('40.6 grouped by place, one place across accounts, the old card payments one group, the five biggest, then everything else; they add up to the 90 days', () => {
    const v = view(placesBook(), '2026-10-06', { before: before(OLD, { historyFrom: '2026-07-08' }) });
    expect(v.places.from).toBe('2026-07-09');
    expect(v.places.to).toBe('2026-10-06');
    expect(v.places.groups.map((g) => [g.kind, g.name, g.amount])).toEqual([
      ['old-card', '', 20_000],
      // 50.00 + 40.00 on the card, 6.00 on checking, named as the newest has it.
      ['place', 'Green Leaf Market', 9_600],
      // 30.00, and 1.00 before setup day (Jul 9); Jul 8's 100.00 is 90 days ago.
      ['place', 'BLUE DOOR CAFE', 3_100],
      ['place', 'CITY BOOKS', 2_500],
      ['place', 'TACO TOWN', 2_000],
      // RIVER GYM 15.50, SUNNY NAILS 10.25, CORNER DELI 4.00, HARBOR FISH 3.00, and 7.00 with no name.
      ['everything-else', '', 3_975],
    ]);
    // Every cent spent in the 90 days, and nothing else.
    expect(v.places.total).toBe(41_175);
    expect(sum(v.places.groups.map((g) => g.amount))).toBe(41_175);
    for (const g of v.places.groups) expect(sum(g.items.map((i) => i.amount))).toBe(g.amount);
    expect(v.places.groups.flatMap((g) => g.items.map((i) => i.id))).not.toContain('x1');
  });

  it('40.6 with fewer than five places there is no "everything else" unless something has no name', () => {
    const b = book({ rules: [] });
    b.receive(purchase('a1', '2026-10-02', 5_000, 'GREEN LEAF MARKET'));
    b.receive(purchase('b1', '2026-10-02', 3_000, 'BLUE DOOR CAFE'));
    b.receive(purchase('c1', '2026-10-02', 2_000, 'CITY BOOKS'));
    expect(view(b, '2026-10-02').places.groups.map((g) => g.kind)).toEqual(['place', 'place', 'place']);
    expect(view(book(), '2026-10-02').places).toMatchObject({ total: 0, groups: [] });
  });
});

describe('40.7 this pay period against your usual', () => {
  // Before setup day, paid every 14 days back from Sep 25: pay periods Jul 3,
  // Jul 17, Jul 31, Aug 14, Aug 28 and Sep 11, each 14 days. Today Oct 6 is
  // day 12 of the pay period from Sep 25 (payday is day 1).
  const cafe = (id: string, date: IsoDate, amount: Cents) => line(id, 'everyday-card', date, amount, 'BLUE CAFE');
  const USUAL: readonly HistoryLine[] = [
    cafe('j3', '2026-07-03', 99_999), // the sixth back: not one of the last 5
    cafe('j17a', '2026-07-17', 1_000), // by day 12: 10.00
    cafe('j17b', '2026-07-30', 5_000), // day 14; whole: 60.00
    cafe('j31a', '2026-07-31', 2_000),
    cafe('j31b', '2026-08-11', 500), // day 12: by day 12 25.00; whole 25.00
    cafe('a14a', '2026-08-14', 3_000),
    cafe('a14c', '2026-08-25', 1_500), // day 12: by day 12 45.00
    cafe('a14b', '2026-08-26', 9_000), // day 13; whole 135.00
    cafe('a28', '2026-08-28', 4_001), // 40.01 both
    line('a28old', 'checking', '2026-08-29', 30_000, 'ONLINE payment to CRD 4444'), // old card: left out
    cafe('s11', '2026-09-11', 10_000), // 100.00 both
  ];

  it('40.7 the middle one of the last 5 full pay periods by the same day, and of their whole totals; old card payments left out', () => {
    const v = view(scenarioA(), '2026-10-06', { before: before(USUAL, { historyFrom: '2026-07-03' }) });
    expect(v.now.startDate).toBe('2026-09-25');
    expect(v.now.day).toBe(12);
    // So far: scenario A's 247.50 less its 200.00 to the old card. Nothing before setup day in this pay period.
    expect(v.now.spentSoFar).toBe(4_750);
    // By day 12: 10.00, 25.00, 40.01, 45.00, 100.00: the middle is 40.01.
    // Whole: 25.00, 40.01, 60.00, 100.00, 135.00: the middle is 60.00.
    expect(v.now.usual).toEqual({ state: 'known', periods: 5, byToday: 4_001, whole: 6_000 });
  });

  it('40.7 with 4 full pay periods, the average of the middle two, rounded down to the cent', () => {
    // History from Jul 31: the pay periods Jul 31, Aug 14, Aug 28, Sep 11.
    const v = view(scenarioA(), '2026-10-06', { before: before(USUAL.filter((l) => l.date >= '2026-07-31'), { historyFrom: '2026-07-31' }) });
    // By day 12: 25.00, 40.01, 45.00, 100.00: (40.01 + 45.00) / 2 = 42.505, so 42.50.
    // Whole: 25.00, 40.01, 100.00, 135.00: (40.01 + 100.00) / 2 = 70.005, so 70.00.
    expect(v.now.usual).toEqual({ state: 'known', periods: 4, byToday: 4_250, whole: 7_000 });
  });

  it('40.7 with exactly 3 full pay periods it is known; with 2, not yet', () => {
    expect(view(scenarioA(), '2026-10-06', { before: before(USUAL.filter((l) => l.date >= '2026-08-14'), { historyFrom: '2026-08-14' }) }).now.usual).toEqual({ state: 'known', periods: 3, byToday: 4_500, whole: 10_000 });
    expect(view(scenarioA(), '2026-10-06', { before: before(USUAL.filter((l) => l.date >= '2026-08-28'), { historyFrom: '2026-08-28' }) }).now.usual).toEqual({ state: 'not-enough', fullPeriods: 2 });
    expect(view(scenarioA(), '2026-10-06').now.usual).toEqual({ state: 'not-enough', fullPeriods: 0 });
  });

  it('40.7 the middle of an even number rounds down, below zero too', () => {
    expect(middleOf([3, 1, 2])).toBe(2);
    expect(middleOf([1, 2])).toBe(1);
    expect(middleOf([-1, 0])).toBe(-1);
    expect(middleOf([-3, -2, -1, 0])).toBe(-2);
    expect(middleOf([0])).toBe(0);
  });

  it('40.7 this pay period counts spending before setup day too, on its own days', () => {
    const v = view(scenarioA(), '2026-10-06', { before: before(HISTORY) });
    // 636.50 in all, less 500.00 to the old card.
    expect(v.now.spentSoFar).toBe(13_650);
  });
});

describe('40.8 Wants left against an even pace', () => {
  it('40.8 the line by the day each thing happened, ending at what Wants holds now; the even pace in whole cents, rounded down', () => {
    const v = view(scenarioA(), '2026-10-06');
    const w = v.now.wants;
    // Pay period 0 from Oct 1; the next payday Oct 9: D = 8 days. Today Oct 6 is day 6.
    expect(w).toMatchObject({ startDate: '2026-10-01', nextPayday: '2026-10-09', day: 6, days: 8, startedWith: 30_000, left: 28_500 });
    // The cafe 10.00 on day 3, the hand move 5.00 on day 5. The shop waiting in review is not in Wants.
    expect(w.line.map((p) => [p.day, p.date, p.left])).toEqual([
      [1, '2026-10-01', 30_000],
      [2, '2026-10-02', 30_000],
      [3, '2026-10-03', 29_000],
      [4, '2026-10-04', 29_000],
      [5, '2026-10-05', 28_500],
      [6, '2026-10-06', 28_500],
    ]);
    // 300.00 x (8 - n) / 8.
    expect(w.pace).toEqual({
      state: 'pace',
      points: [26_250, 22_500, 18_750, 15_000, 11_250, 7_500, 3_750, 0].map((left, i) => ({ day: i + 1, date: `2026-10-0${i + 1}`, left })),
      today: 7_500,
      // 285.00 - 75.00: more left than an even pace.
      difference: 21_000,
    });
  });

  it('40.8 a purchase dated before the pay period counts on its first day; the even pace rounds down to the cent', () => {
    const b = book({ pots: { ...START, wants: 0 } });
    b.receive(paycheck('pay', '2026-10-09', 400_000));
    b.receive(purchase('late', '2026-10-08', 900, 'MADE UP CAFE'));
    const w = view(b, '2026-10-10').now.wants;
    // Wants started with its share, 500.00. Next payday Oct 23: D = 14.
    expect(w).toMatchObject({ startDate: '2026-10-09', day: 2, days: 14, startedWith: 50_000, left: 49_100 });
    expect(w.line.map((p) => p.left)).toEqual([49_100, 49_100]);
    // 500.00 x 12 / 14 = 428.5714..., so 428.57. Less left: 491.00 - 428.57 = 62.43 more.
    expect(w.pace.state === 'pace' && [w.pace.today, w.pace.difference]).toEqual([42_857, 6_243]);
  });

  it('40.8 one cent started: the even pace is 0 by the end of day 1', () => {
    const b = book({ pots: { ...START, wants: 1 } });
    const w = view(b, '2026-10-01').now.wants;
    expect(w.pace.state === 'pace' && w.pace.points[0]).toEqual({ day: 1, date: '2026-10-01', left: 0 });
    expect(w.pace.state === 'pace' && w.pace.difference).toBe(1);
  });

  it('40.8 Wants started at zero or below: no even pace, and why', () => {
    expect(view(book({ pots: { ...START, wants: 0 } }), '2026-10-03').now.wants.pace).toEqual({ state: 'none', why: 'started-at-or-below-zero' });
    expect(view(book({ pots: { ...START, wants: -1 } }), '2026-10-03').now.wants.pace).toEqual({ state: 'none', why: 'started-at-or-below-zero' });
  });

  it('40.8 the next payday passed with no paycheck: the even pace stays at $0.00', () => {
    const w = view(scenarioA(), '2026-10-12').now.wants;
    expect(w).toMatchObject({ day: 12, days: 8 });
    expect(w.pace.state === 'pace' && w.pace.points.map((p) => p.left)).toEqual([26_250, 22_500, 18_750, 15_000, 11_250, 7_500, 3_750, 0, 0, 0, 0, 0]);
    expect(w.pace.state === 'pace' && [w.pace.today, w.pace.difference]).toEqual([0, 28_500]);
  });

  it('40.8 less left than an even pace is a negative difference', () => {
    const b = book();
    b.receive(purchase('c1', '2026-10-02', 20_000, 'MADE UP CAFE'));
    const w = view(b, '2026-10-02').now.wants;
    // 300.00 x 6 / 8 = 225.00; Wants holds 100.00.
    expect(w.pace.state === 'pace' && w.pace.difference).toBe(subtractCents(10_000, 22_500));
  });
});

describe('40.9 when the totals do not match the bank', () => {
  it('40.9 the same check as Buckets; the numbers still come from the books', () => {
    const b = scenarioA();
    const off = { ...matchingBank(b), checking: matchingBank(b).checking + 1_234 };
    const v = view(b, '2026-10-06', { bank: off, catchingUp: true, why: null });
    expect(v.check).toEqual({ state: 'does-not-match', difference: 1_234, catchingUp: true, why: null });
    expect(v.periods[0]?.total).toBe(24_750);
    expect(view(b, '2026-10-06', { bank: null }).check).toEqual({ state: 'bank-not-read' });
    expect(view(b, '2026-10-06').check).toEqual({ state: 'matches' });
  });
});

describe('40.1 Trends only reads', () => {
  it('40.1 working Trends out changes nothing in the book, and gives the same answer twice', () => {
    const b = scenarioA();
    const was = everything(b);
    const first = view(b, '2026-10-06', { before: before(HISTORY) });
    expect(everything(b)).toEqual(was);
    expect(view(b, '2026-10-06', { before: before(HISTORY) })).toEqual(first);
  });
});
