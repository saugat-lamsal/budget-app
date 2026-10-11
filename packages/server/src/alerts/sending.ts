import { addDays } from '@budget-app/money';
import { instantIn, timeIn } from '../history/today.js';
import { alertWords, clockWords, dayWords, type AlertFacts } from './alerts.js';

// Phase 5: what goes to the phone, and when. The alerts are kept at the
// moment they come due (plan.ts); these say whether one may be sent now and
// with which words. Nothing here asks the clock: the moment is handed in.

// 10.8 (QUESTIONS.md A35): quiet hours, on his clock ("HH:MM" from and to, in
// his home time zone). Nothing is sent in them; what comes due then waits
// until they end. The moment they end when `now` is in them; null when it is
// not. The same time twice is no quiet hours at all.
export function quietUntil(zone: string, quiet: { readonly from: string; readonly to: string }, now: Date): Date | null {
  const { from, to } = quiet;
  if (from === to) return null;
  const local = timeIn(zone, now);
  const date = local.slice(0, 10);
  const time = local.slice(11, 16);
  const across = from > to;
  const inThem = across ? time >= from || time < to : time >= from && time < to;
  if (!inThem) return null;
  // Across midnight and already past `from`: they end the next morning.
  return instantIn(zone, across && time >= from ? addDays(date, 1) : date, to);
}

// 10.8, 10.9 (B185): an alert sent later than the minute it came due says when
// it was due, on his clock: "Due 3:10 AM.", with the day when it was another
// day ("Due Fri, Oct 2, 9:55 PM."). Null when it goes in the minute it came due.
export function dueWords(zone: string, dueAt: string, now: Date): string | null {
  const due = timeIn(zone, new Date(dueAt));
  const sent = timeIn(zone, now);
  if (due.slice(0, 16) === sent.slice(0, 16)) return null;
  const day = due.slice(0, 10) === sent.slice(0, 10) ? '' : `${dayWords(due.slice(0, 10))}, `;
  return `Due ${day}${clockWords(due)}.`;
}

// 10.10 (A39): the words the phone gets. Without amounts on the lock screen
// (the setting, off to start), the alert's words without them; an alert kept
// before its facts were kept goes with the words it was kept with.
export function wordsToSend(kept: { readonly title: string; readonly body: string; readonly facts: AlertFacts | null }, amounts: boolean): { readonly title: string; readonly body: string } {
  if (amounts || kept.facts === null) return { title: kept.title, body: kept.body };
  return alertWords(kept.facts, { amounts: false });
}
