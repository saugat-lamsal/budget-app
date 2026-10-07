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
