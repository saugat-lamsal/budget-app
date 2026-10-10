import type { IsoDate } from '@budget-app/money';

// "Today" for the app (rulebook section 2, the home time zone): the date on
// the calendar in his home time zone at this moment, whatever time zone the
// server's own clock is set to. Dates the bank sends are kept exactly as sent;
// only the app's own today comes from here.

const dateParts = (zone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' });

function partsAt(zone: string, at: Date): Record<string, string> {
  return Object.fromEntries(dateParts(zone).formatToParts(at).map((p) => [p.type, p.value]));
}

// The date in the zone at that moment, as 2026-10-09.
export function todayIn(zone: string, at: Date): IsoDate {
  const p = partsAt(zone, at);
  return `${p['year']}-${p['month']}-${p['day']}`;
}

// The moment as the zone's clock shows it, with its offset: 2026-10-09T21:15:00-04:00.
export function timeIn(zone: string, at: Date): string {
  const p = partsAt(zone, at);
  // "GMT-04:00", or "GMT" when the zone is at UTC.
  const offset = (p['timeZoneName'] ?? 'GMT').replace(/^GMT/, '') || '+00:00';
  return `${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}:${p['second']}${offset}`;
}

// Whether the name is a time zone this computer knows.
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
