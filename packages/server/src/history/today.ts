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

// The zone's clock at that moment, written as if it were UTC, in milliseconds.
function wallAt(zone: string, at: number): number {
  const p = partsAt(zone, new Date(at));
  return Date.UTC(Number(p['year']), Number(p['month']) - 1, Number(p['day']), Number(p['hour']), Number(p['minute']), Number(p['second']));
}

// Phase 5: the moment the zone's clock first shows that time ("20:00") on
// that date. A time it shows twice (1:30 AM the day the clocks go back) is
// the first of the two; a time it skips (2:30 AM the day they go forward) is
// the moment it jumps past it.
export function instantIn(zone: string, date: IsoDate, time: string): Date {
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour ?? 0, minute ?? 0);
  // The zone's offset a day either side: on an ordinary day the same, on the
  // day the clocks change the one before and the one after.
  const offsets = [...new Set([wallAt(zone, wall - 86_400_000) - (wall - 86_400_000), wallAt(zone, wall + 86_400_000) - (wall + 86_400_000)])];
  const shows = offsets.map((offset) => wall - offset).filter((at) => wallAt(zone, at) === wall);
  if (shows.length > 0) return new Date(Math.min(...shows));
  // Skipped: the first moment the clock shows a later time.
  let before = Math.min(...offsets.map((offset) => wall - offset));
  let after = Math.max(...offsets.map((offset) => wall - offset));
  while (after - before > 1_000) {
    const middle = before + Math.floor((after - before) / 2_000) * 1_000;
    if (wallAt(zone, middle) >= wall) after = middle;
    else before = middle;
  }
  return new Date(after);
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
