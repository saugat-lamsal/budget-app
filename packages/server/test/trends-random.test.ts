import { addCents, daysBetween, subtractCents, type BankBalances, type Book, type IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { liveALife } from '../../money/test/sim/life.js';
import { evenPace, trendsView } from '../src/trends.js';

// The Trends tab (section 40) against the simulator's own books, on random
// made-up lives: every few evenings, every number Trends gives must be the
// books' own, to the cent, and working it out must change nothing.
// TRENDS_LIVES and TRENDS_FIRST_SEED run more; a failure names its seed and day.

const LIVES = Number(process.env['TRENDS_LIVES'] ?? 2);
const FIRST = Number(process.env['TRENDS_FIRST_SEED'] ?? 4100);
const EVERY = 4;

function check(book: Book, today: IsoDate, bank: BankBalances): void {
  const pots = JSON.stringify([book.pots(), book.oldCardDebt(), book.reviewItems().length, book.changeLog().length]);
  const v = trendsView({ today, book, bank, madeUpData: false, before: null });
  if (v.state !== 'tracking') throw new Error('not tracking');
  // 40.1: working it out changed nothing.
  expect(JSON.stringify([book.pots(), book.oldCardDebt(), book.reviewItems().length, book.changeLog().length])).toBe(pots);

  // 40.2, 40.4: each pay period shown is the books' pay period of that start, its parts the ledger's spending.
  const current = book.period().number;
  const firstShown = current - v.periods.length + 1;
  v.periods.forEach((p, i) => {
    const n = firstShown + i;
    const summary = book.periodSummary(n);
    expect(p.startDate).toBe(summary.startDate);
    expect(addCents(p.spent.needs, p.spent['old-card'])).toBe(subtractCents(0, summary.byKind.needs.spending));
    expect(p.spent.wants).toBe(subtractCents(0, summary.byKind.wants.spending));
    // 12.2: unsorted spending is what waits in review, shown in the current pay period.
    expect(p.spent.unsorted).toBe(n === current ? book.pots().unsortedOut : 0);
    for (const part of ['needs', 'wants', 'old-card', 'unsorted'] as const) expect(addCents(0, ...p.items.filter((x) => x.part === part).map((x) => x.amount))).toBe(p.spent[part]);
    expect(p.total).toBe(addCents(p.spent.needs, p.spent.wants, p.spent['old-card'], p.spent.unsorted));
    // 40.4: in the last 90 days, or the current one.
    expect(p.current || daysBetween(today, p.lastDay) >= -89).toBe(true);
  });

  // 40.5: the savings bucket and the mom reserve as the books hold them.
  const now = v.savings.at(-1);
  expect(now).toEqual({ date: today, at: 'now', savings: book.pots().savings, momReserve: book.pots().momReserve });
  expect(v.savings[0]).toMatchObject({ at: 'start', savings: book.periodSummary(0).opening.savings, momReserve: book.periodSummary(0).opening.momReserve });
  // One at the end of each pay period that ended, in order (two can end on the same day).
  const ends = v.savings.filter((s) => s.at === 'end');
  expect(ends).toHaveLength(current);
  ends.forEach((point, k) => {
    const s = book.periodSummary(k);
    expect(daysBetween(point.date, s.endDate as string)).toBe(1);
    expect([point.savings, point.momReserve]).toEqual([s.closing.savings, s.closing.momReserve]);
  });

  // 40.6: every cent dated in the 90 days, grouped, and nothing else.
  // Added up straight from the books, every pay period (one that ended can
  // hold items dated after its last day: "this is my paycheck" starts the new
  // one on the deposit's day, B53), and what waits in review.
  const inWindow = (date: IsoDate): boolean => daysBetween(v.places.from, date) >= 0 && daysBetween(date, today) >= 0;
  const fromBooks = [
    ...Array.from({ length: current + 1 }, (_, n) => book.spentIn(n)).flat().filter((s) => inWindow(s.date)).map((s) => s.amount),
    ...book.reviewItems().flatMap((r) => (r.type === 'spending' && inWindow(r.date) ? [r.amount] : [])),
  ];
  expect(v.places.total).toBe(addCents(0, ...fromBooks));
  expect(addCents(0, ...v.places.groups.map((g) => g.amount))).toBe(v.places.total);
  expect(v.places.groups.flatMap((g) => g.items)).toHaveLength(fromBooks.length);
  expect(v.places.groups.filter((g) => g.kind !== 'everything-else').length).toBeLessThanOrEqual(5);

  // 40.8: the line ends at what Wants holds now; the even pace is the rule's.
  const w = v.now.wants;
  expect(w.line.at(-1)?.left).toBe(book.pots().wants);
  expect(w.line).toHaveLength(w.day);
  expect(w.startedWith).toBe(book.startedPeriodWith().wants);
  if (w.pace.state === 'pace') {
    expect(w.startedWith).toBeGreaterThan(0);
    for (const point of w.pace.points) expect(point.left).toBe(evenPace(w.startedWith, w.days, point.day));
    expect(w.pace.difference).toBe(subtractCents(book.pots().wants, w.pace.today));
  } else expect(w.startedWith).toBeLessThanOrEqual(0);

  // 40.7: this pay period so far, without old card payments.
  const here = v.periods.at(-1);
  expect(v.now.spentSoFar).toBe(subtractCents(here?.total ?? 0, here?.spent['old-card'] ?? 0));
  // 40.9: the same check the books make.
  expect(v.check.state === 'matches').toBe(book.selfCheck(bank).ok);
}

describe('40.1 to 40.9 Trends on random made-up lives, against the books', () => {
  for (let seed = FIRST; seed < FIRST + LIVES; seed += 1) {
    it(`40.1 40.2 40.5 40.6 40.8 seed ${seed}: every number is the books' own, every few evenings for a year, and working it out changes nothing`, () => {
      let day = 0;
      let checked = 0;
      const result = liveALife({
        seed,
        years: 1,
        record: {
          setupDay: () => {},
          day: () => {},
          endOfDay: ({ date, book, balances }) => {
            day += 1;
            if (day % EVERY !== 0) return;
            try {
              check(book, date, balances);
            } catch (error) {
              const where = error instanceof Error ? ((error.stack ?? '').split('\n').find((l) => l.includes('trends-random')) ?? '') : '';
              throw new Error(`seed ${seed}, ${date}: ${error instanceof Error ? error.message : String(error)} ${where.trim()}`);
            }
            checked += 1;
          },
        },
      });
      expect(result.ok, JSON.stringify(result).slice(0, 2_000)).toBe(true);
      expect(checked).toBeGreaterThan(80);
    }, 300_000);
  }
});
