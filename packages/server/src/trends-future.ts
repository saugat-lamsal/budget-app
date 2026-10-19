import { addCents, addDays, assertCents, daysBetween, paydaysAfter, payoffCountdown, subtractCents, type Book, type Cents, type IsoDate } from '@budget-app/money';
import type { DebtPoint, Landing, LandingByPayday, OldCardPlan, SavingsRangePoint, SavingsYearOut, TrendsFuture, TrendsPeriod } from './views/trends.js';

// Trends, Future (rulebook 40.10 to 40.13, QUESTIONS.md A59): where the books
// are heading, worked out from what they hold. Every amount here is an
// estimate, never a promise, and the screen says so. It only reads.

// 40.11: no estimate before day 3.
export const LANDING_FROM_DAY = 3;
// 40.12: a year out, from the last 5 pay periods, and at least 3 of them.
export const YEAR_DAYS = 365;
export const SAVINGS_PERIODS = 5;
export const SAVINGS_AT_LEAST = 3;

// A whole number times a fraction, rounded up to the cent, without going past
// what a number holds.
function timesUp(amount: Cents, times: number, over: number): Cents {
  const top = BigInt(amount) * BigInt(times);
  const down = top / BigInt(over);
  const result = Number(top % BigInt(over) > 0n ? down + 1n : down);
  assertCents(result, 'estimate');
  return result;
}

function times(amount: Cents, n: number): Cents {
  const result = Number(BigInt(amount) * BigInt(n));
  assertCents(result, 'estimate');
  return result;
}

export interface FutureInput {
  readonly book: Book;
  readonly today: IsoDate;
  // The next payday (11.2).
  readonly next: IsoDate;
  // The pay periods as Trends has them (40.3), oldest first; the last is the current one.
  readonly periods: readonly TrendsPeriod[];
  // 40.3: when each of the books' pay periods began, the books' first included (before setup day when it began then).
  readonly bookStarts: readonly IsoDate[];
  readonly setupDay: IsoDate;
}

export function futureOf(input: FutureInput): TrendsFuture {
  return { landing: landingOf(input), savings: savingsYearOut(input), oldCard: oldCardOf(input) };
}

// ----- 40.11 -----

function landingOf({ book, today, next, periods }: FutureInput): LandingByPayday {
  const current = periods[periods.length - 1] as TrendsPeriod;
  // The books' items only: the buckets did not exist before setup day.
  const own = current.items.filter((i) => !i.beforeSetup);
  // Payday is day 1; in the books' first pay period, setup day is.
  const start = book.periodSummary(book.period().number).startDate;
  const daysSoFar = daysBetween(start, today) + 1;
  const toPayday = daysBetween(today, next);
  const pots = book.pots();
  const one = (bucket: 'needs' | 'wants'): Landing => {
    const holds = pots[bucket];
    if (toPayday < 0) return { state: 'payday-passed', holds };
    if (daysSoFar < LANDING_FROM_DAY) return { state: 'too-early', holds, daysSoFar };
    const spentSoFar = addCents(0, ...own.filter((i) => i.part === bucket).map((i) => i.amount));
    const daysLeft = Math.max(0, toPayday - 1);
    const pace = timesUp(spentSoFar, daysLeft, daysSoFar);
    return { state: 'estimate', holds, spentSoFar, daysSoFar, daysLeft, pace, lands: subtractCents(holds, pace) };
  };
  return {
    nextPayday: next,
    needs: one('needs'),
    wants: one('wants'),
    waitingInReview: addCents(0, ...own.filter((i) => i.part === 'unsorted').map((i) => i.amount)),
  };
}

// ----- 40.12 -----

function savingsYearOut({ book, today, bookStarts, setupDay }: FutureInput): SavingsYearOut {
  const now = book.pots().savings;
  const gains: Cents[] = [];
  for (let n = 0; n < book.period().number; n += 1) {
    // Only pay periods that began on or after setup day.
    if (daysBetween(setupDay, bookStarts[n] as IsoDate) < 0) continue;
    const before = n === 0 ? book.periodSummary(0).opening.savings : book.periodSummary(n - 1).closing.savings;
    gains.push(subtractCents(book.periodSummary(n).closing.savings, before));
  }
  const last = gains.slice(-SAVINGS_PERIODS);
  if (last.length < SAVINGS_AT_LEAST) return { state: 'not-enough', now, periods: last.length };
  const least = Math.min(...last);
  const most = Math.max(...last);
  const to = addDays(today, YEAR_DAYS);
  const points: SavingsRangePoint[] = [];
  let guard = 0;
  for (const payday of paydaysAfter(book.lastPaycheckDate(), book.settings())) {
    if (daysBetween(payday, to) < 0 || (guard += 1) > 10_000) break;
    if (daysBetween(today, payday) <= 0) continue;
    const k = points.length + 1;
    points.push({ date: payday, low: addCents(now, times(least, k)), high: addCents(now, times(most, k)) });
  }
  const end = points[points.length - 1];
  return {
    state: 'estimate',
    now,
    to,
    paydays: points.length,
    periods: last.length,
    least,
    most,
    low: end?.low ?? now,
    high: end?.high ?? now,
    points: Object.freeze(points.map((p) => Object.freeze(p))),
  };
}

// ----- 40.13 -----

function oldCardOf({ book, today }: FutureInput): TrendsFuture['oldCard'] {
  const owed: DebtPoint[] = [{ date: book.periodSummary(0).startDate, at: 'start', owed: book.oldCardDebtIn(0).opening }];
  for (let n = 0; n < book.period().number; n += 1) {
    const end = book.periodSummary(n).endDate;
    if (end !== null) owed.push({ date: addDays(end, -1), at: 'end', owed: book.oldCardDebtIn(n).closing });
  }
  owed.push({ date: today, at: 'now', owed: book.oldCardDebt() });
  return { owed: Object.freeze(owed.map((p) => Object.freeze(p))), plan: planOf(book, today) };
}

function planOf(book: Book, today: IsoDate): OldCardPlan {
  const debt = book.oldCardDebt();
  if (debt <= 0) return { state: 'paid-off' };
  const countdown = payoffCountdown(book, today);
  if (!countdown.on) return { state: 'no-promo-end-date' };
  const { promoEndDate, perPayday, paydaysLeft } = countdown;
  if (paydaysLeft === 0) return { state: 'due-now', promoEndDate, owed: debt };
  // 9.5's paydays: after today and before the promo end date, not on it.
  const points: { date: IsoDate; owed: Cents }[] = [{ date: today, owed: debt }];
  let left = debt;
  let guard = 0;
  for (const payday of paydaysAfter(book.lastPaycheckDate(), book.settings())) {
    if (daysBetween(payday, promoEndDate) <= 0 || left <= 0 || (guard += 1) > 10_000) break;
    if (daysBetween(today, payday) <= 0) continue;
    left = Math.max(0, subtractCents(left, perPayday));
    points.push({ date: payday, owed: left });
  }
  const last = points[points.length - 1] as { date: IsoDate; owed: Cents };
  return { state: 'plan', promoEndDate, perPayday, paydaysLeft, paidOffBy: last.date, points: Object.freeze(points.map((p) => Object.freeze(p))) };
}
