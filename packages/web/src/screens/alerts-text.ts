import { assertIsoDate, type IsoDate } from '@budget-app/money';
import { shortDate } from '../ui/dates.js';
import { timeText } from './settings-text.js';

// The words on the list of alerts sent (Phase 5). The server writes each time
// in his home time zone, as the clock there showed it, with its offset
// ("2026-10-12T20:00:00-04:00"), so the screen reads the clock's own date and
// time from it and never moves it to the phone's time zone.

const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// "8:00 PM" on the day it is today there, "Sun, Oct 11, 8:00 PM" on any other day.
export function alertMomentText(at: string, today: IsoDate): string {
  const match = LOCAL.exec(at);
  if (match === null) throw new Error(`not a time: ${at}`);
  const [, date, hour, minute] = match as unknown as [string, string, string, string];
  assertIsoDate(date);
  if (Number(hour) > 23 || Number(minute) > 59) throw new Error(`not a time: ${at}`);
  const time = timeText(`${hour}:${minute}`);
  return date === today ? time : `${shortDate(date)}, ${time}`;
}

// When it came due, and when it went out or why not yet.
export function alertWhenText(line: { readonly dueAt: string; readonly sentAt: string | null; readonly tries: number; readonly nextTryAt: string | null; readonly quietUntil: string | null }, today: IsoDate): string {
  const due = `Due ${alertMomentText(line.dueAt, today)}`;
  if (line.sentAt !== null) return `${due}, sent ${alertMomentText(line.sentAt, today)}`;
  // 10.8: nothing goes in quiet hours.
  if (line.quietUntil !== null) return `${due}. Waits for quiet hours to end at ${alertMomentText(line.quietUntil, today)}.`;
  if (line.tries === 0 || line.nextTryAt === null) return `${due}. Not sent yet.`;
  const tried = line.tries === 1 ? 'tried once' : `tried ${line.tries.toLocaleString('en-US')} times`;
  return `${due}. Not sent yet: ${tried}, trying again at ${alertMomentText(line.nextTryAt, today)}.`;
}

// How many there are: the list shows the newest of them.
export function alertCountText(shown: number, total: number): string {
  if (total === 0) return 'No alerts yet';
  if (shown < total) return `The newest ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} alerts`;
  return total === 1 ? '1 alert' : `${total.toLocaleString('en-US')} alerts`;
}

// The row on Settings that opens the list.
export function alertsRowText(count: { readonly total: number; readonly notSent: number }): string {
  if (count.total === 0) return 'None yet';
  const all = count.total === 1 ? '1 alert' : `${count.total.toLocaleString('en-US')} alerts`;
  return count.notSent === 0 ? `${all}, all sent` : `${all}, ${count.notSent.toLocaleString('en-US')} not sent yet`;
}
