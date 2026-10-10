import { assertIsoDate, type IsoDate } from '@budget-app/money';

// Dates on the screens. They are calendar days, so they are read and written
// in UTC and never shift a day with the phone's time zone.

function utc(date: IsoDate): Date {
  assertIsoDate(date);
  return new Date(`${date}T00:00:00Z`);
}

// "Fri, Oct 16"
export function shortDate(date: IsoDate): string {
  return utc(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// "Wednesday, October 7"
export function longDate(date: IsoDate): string {
  return utc(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// "Wed, Oct 7, 7:15 AM": a moment, such as when safe to spend was last
// checked (0.5, B82), in the phone's own time zone unless one is given.
export function asOfText(at: string, timeZone?: string): string {
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) throw new Error(`not a time: ${at}`);
  return moment
    .toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(timeZone === undefined ? {} : { timeZone }) })
    .replace(/\s/g, ' ');
}

// Step 3: when the bank was last read, in his home time zone: "3:05 PM" on
// the day it is today there, "Fri, Oct 9, 3:05 PM" on any other day.
export function checkedAtText(at: string, today: IsoDate, timeZone: string): string {
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) throw new Error(`not a time: ${at}`);
  const day = moment.toLocaleDateString('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  if (day === today) return moment.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).replace(/\s/g, ' ');
  return asOfText(at, timeZone);
}

// "October": the calendar month named by "2026-10".
export function monthName(month: string): string {
  return utc(`${month}-01`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
}

// "Jun 30, 2027": a day that may be in another year, such as the old card's promo end date.
export function dayWithYear(date: IsoDate): string {
  return utc(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
