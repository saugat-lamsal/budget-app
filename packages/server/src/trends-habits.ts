import { addCents, addDays, assertCents, daysBetween, dayOfWeek, type Book, type Cents, type IsoDate } from '@budget-app/money';
import type { PaydayEffect, RepeatCharge, SpendDays, TrendsHabits, TrendsItem, TrendsPeriod, Weekdays, WeekdaySpend, WantsStreak } from './views/trends.js';

// Trends, Habits (rulebook 40.10, 40.14 to 40.17, QUESTIONS.md A59): what his
// spending tends to do, from the books and the history kept from before
// setup day. Old card payments are planned (9.5), so they are left out. It
// only reads.

// 40.14: payday and the 2 days after; at least 3 full pay periods.
export const PAYDAY_DAYS = 3;
export const HABIT_PERIODS_AT_LEAST = 3;
// 40.16: at least 3 charges, the gaps of each kind, and the amounts within 10% of the newest.
export const REPEAT_AT_LEAST = 3;
export const REPEAT_KINDS = Object.freeze([
  { every: 'week', shortest: 6, longest: 8, perYear: 52 },
  { every: 'two-weeks', shortest: 13, longest: 15, perYear: 26 },
  { every: 'month', shortest: 27, longest: 33, perYear: 12 },
] as const);
export const REPEAT_WITHIN_PERCENT = 10;
// 40.15: Monday first.
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;

export interface HabitsInput {
  readonly book: Book;
  readonly today: IsoDate;
  // The first of the last 90 days (40.6).
  readonly from: IsoDate;
  // Every pay period Trends has (40.3), oldest first, and the ones in the last 90 days (40.4).
  readonly periods: readonly TrendsPeriod[];
  readonly shown: readonly TrendsPeriod[];
  // 40.6's place for an item, or null.
  readonly nameOf: (item: TrendsItem) => string | null;
}

function newest(a: TrendsItem, b: TrendsItem): number {
  return daysBetween(a.date, b.date) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

// Rounded down to the cent, negative too, without going past what a number holds.
function perDay(total: Cents, days: number): Cents {
  if (days <= 0) return 0;
  const t = BigInt(total);
  const d = BigInt(days);
  const q = t / d;
  return Number(t % d !== 0n && t < 0n ? q - 1n : q);
}

const spending = (i: TrendsItem): boolean => i.part !== 'old-card';
const sum = (items: readonly TrendsItem[]): Cents => addCents(0, ...items.map((i) => i.amount));

export function habitsOf(input: HabitsInput): TrendsHabits {
  return { paydayEffect: paydayEffectOf(input), weekdays: weekdaysOf(input), repeats: repeatsOf(input), streak: streakOf(input.book) };
}

// ----- 40.14 -----

function paydayEffectOf({ periods, shown }: HabitsInput): PaydayEffect {
  const full = shown.filter((p) => p.full);
  if (full.length < HABIT_PERIODS_AT_LEAST) return { state: 'not-enough', fullPeriods: full.length };
  const items = periods.flatMap((p) => p.items).filter(spending);
  const first: TrendsItem[] = [];
  const rest: TrendsItem[] = [];
  let firstDays = 0;
  let restDays = 0;
  for (const p of full) {
    const length = daysBetween(p.startDate, p.lastDay) + 1;
    firstDays += Math.min(PAYDAY_DAYS, length);
    restDays += Math.max(0, length - PAYDAY_DAYS);
    // By the day each item is dated, not the pay period the books counted it in.
    for (const item of items) {
      const day = daysBetween(p.startDate, item.date) + 1;
      if (day < 1 || day > length) continue;
      (day <= PAYDAY_DAYS ? first : rest).push(item);
    }
  }
  const days = (list: TrendsItem[], count: number): SpendDays => {
    const total = sum(list);
    return { days: count, total, perDay: perDay(total, count), items: Object.freeze(list.sort(newest)) };
  };
  return { state: 'known', periods: full.length, first: days(first, firstDays), rest: days(rest, restDays) };
}

// ----- 40.15 -----

function weekdaysOf({ periods, from, today }: HabitsInput): Weekdays {
  const items = periods.flatMap((p) => p.items).filter((i) => spending(i) && daysBetween(from, i.date) >= 0 && daysBetween(i.date, today) >= 0);
  const count = new Map<number, number>();
  for (let d = from; daysBetween(d, today) >= 0; d = addDays(d, 1)) count.set(dayOfWeek(d), (count.get(dayOfWeek(d)) ?? 0) + 1);
  const days: WeekdaySpend[] = WEEK.map((weekday) => {
    const own = items.filter((i) => dayOfWeek(i.date) === weekday).sort(newest);
    const total = sum(own);
    const n = count.get(weekday) ?? 0;
    return { weekday, days: n, total, average: perDay(total, n), items: Object.freeze(own) };
  });
  let most: number | null = null;
  let best = 0;
  for (const d of days) {
    if (d.average > best) {
      best = d.average;
      most = d.weekday;
    }
  }
  return { from, to: today, total: sum(items), days: Object.freeze(days.map((d) => Object.freeze(d))), most };
}

// ----- 40.16 -----

function repeatsOf({ periods, today, nameOf }: HabitsInput): readonly RepeatCharge[] {
  // One item can be in more than one pay period (a refund counted later) and
  // in more than one part (a split): what it charged is all of it added up.
  const byId = new Map<string, TrendsItem>();
  for (const item of periods.flatMap((p) => p.items).filter(spending)) {
    const seen = byId.get(item.id);
    byId.set(item.id, seen === undefined ? item : { ...seen, amount: addCents(seen.amount, item.amount) });
  }
  const places = new Map<string, TrendsItem[]>();
  for (const item of byId.values()) {
    if (item.amount <= 0) continue;
    const name = nameOf(item);
    if (name === null) continue;
    const key = name.toLowerCase();
    places.set(key, [...(places.get(key) ?? []), item]);
  }
  const found: RepeatCharge[] = [];
  for (const charges of places.values()) {
    if (charges.length < REPEAT_AT_LEAST) continue;
    const oldestFirst = [...charges].sort((a, b) => -newest(a, b));
    const gaps = oldestFirst.slice(1).map((c, k) => daysBetween((oldestFirst[k] as TrendsItem).date, c.date));
    const kind = REPEAT_KINDS.find((k) => gaps.every((g) => g >= k.shortest && g <= k.longest));
    if (kind === undefined) continue;
    const latest = oldestFirst[oldestFirst.length - 1] as TrendsItem;
    // Each within 10% of the newest.
    if (!oldestFirst.every((c) => BigInt(Math.abs(c.amount - latest.amount)) * 100n <= BigInt(latest.amount) * BigInt(REPEAT_WITHIN_PERCENT))) continue;
    // Still going.
    if (daysBetween(latest.date, today) > kind.longest) continue;
    const perYear = latest.amount * kind.perYear;
    assertCents(perYear, 'a year of it');
    found.push({
      name: nameOf(latest) as string,
      every: kind.every,
      newestDate: latest.date,
      newestAmount: latest.amount,
      next: addDays(latest.date, gaps[gaps.length - 1] as number),
      perYear,
      items: Object.freeze([...charges].sort(newest)),
    });
  }
  found.sort((a, b) => b.perYear - a.perYear || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return Object.freeze(found.map((r) => Object.freeze(r)));
}

// ----- 40.17 -----

function streakOf(book: Book): WantsStreak {
  const ended = book.period().number;
  let current = 0;
  let run = 0;
  let best = 0;
  for (let n = 0; n < ended; n += 1) {
    run = book.periodSummary(n).closing.wants >= 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  current = run;
  const lastOver = ended > 0 && book.periodSummary(ended - 1).closing.wants < 0;
  return { ended, current, best, lastOver };
}
