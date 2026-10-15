import { MoneyError } from './errors.js';

// Calendar dates as "YYYY-MM-DD" text. The money math has no clock: every
// date comes from the caller. Day counts use UTC so clock changes and time
// zones never shift a day.
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayNumber(date: unknown, what: string): number {
  const match = typeof date === 'string' ? ISO_DATE.exec(date) : null;
  if (match !== null) {
    const [, year = '', month = '', day = ''] = match;
    const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
    if (new Date(ms).toISOString().slice(0, 10) === date) return ms / MS_PER_DAY;
  }
  throw new MoneyError('not-a-date', `${what} must be a real calendar date as YYYY-MM-DD, got ${String(date)}`);
}

export function assertIsoDate(date: unknown, what = 'date'): asserts date is IsoDate {
  dayNumber(date, what);
}

// Whole days from one date to another. Negative when "to" is earlier.
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return dayNumber(to, 'date') - dayNumber(from, 'date');
}

export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new MoneyError('not-a-date', `days must be whole, got ${days}`);
  return new Date((dayNumber(date, 'date') + days) * MS_PER_DAY).toISOString().slice(0, 10);
}

// The day of the week: 0 Sunday, 1 Monday, ... 6 Saturday. Day 0 of the
// count, Jan 1, 1970, was a Thursday.
export function dayOfWeek(date: IsoDate): number {
  return (((dayNumber(date, 'date') + 4) % 7) + 7) % 7;
}

// The last day of a month, as a date ("2027-02" gives "2027-02-28").
export function lastDayOfMonth(month: string): IsoDate {
  const [year = 0, m = 0] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}

// The calendar month of a date, as "YYYY-MM".
export function monthOf(date: IsoDate): string {
  assertIsoDate(date);
  return date.slice(0, 7);
}
