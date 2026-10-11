import { formatDollars, type Cents, type IsoDate } from '@budget-app/money';

// Phase 5, part one: the alerts and card reminders of rulebook sections 9
// and 10, as the real server works them out, keeps them, and sends them.
// This is what one alert is: the facts it is about, the key that makes it
// come only as often as its rule says, and its words. Nothing here uses Node:
// the list on the phone (views/alerts.ts) shares these types.

export type Card = 'everyday-card' | 'old-card';

export type AlertFacts =
  // 10.1: once per bucket per pay period. What is left, and what the bucket
  // started the pay period with (the level is a percent of it).
  | { readonly kind: 'low-bucket'; readonly bucket: 'needs' | 'wants'; readonly period: number; readonly amount: Cents; readonly startedWith: Cents }
  // 10.2: once per bucket per pay period.
  | { readonly kind: 'empty-bucket'; readonly bucket: 'needs' | 'wants'; readonly period: number; readonly amount: Cents }
  // 10.3: at the review time, only if something waits; once a day.
  | { readonly kind: 'daily-review'; readonly date: IsoDate; readonly waiting: number }
  // 9.1 to 9.3: on each reminder day while not enough is paid. The everyday
  // card shows its statement balance; the old card does not (null).
  | { readonly kind: 'card-reminder'; readonly card: Card; readonly dueDate: IsoDate; readonly daysBefore: number; readonly minimumPayment: Cents; readonly statementBalance: Cents | null }
  // 9.4: every day after the due date until the minimum is paid (B30).
  | { readonly kind: 'card-overdue'; readonly card: Card; readonly dueDate: IsoDate; readonly minimumPayment: Cents; readonly date: IsoDate }
  // 10.4 and 10.5: when it starts (the time-th time), and again only after it
  // stopped being true (QUESTIONS.md A37 asks how often).
  | { readonly kind: 'totals-mismatch'; readonly time: number; readonly difference: Cents }
  | { readonly kind: 'bank-login'; readonly time: number }
  // 10.6: once, when it happens.
  | { readonly kind: 'bank-took-back'; readonly id: string; readonly date: IsoDate; readonly description: string; readonly amount: Cents };

export type AlertKind = AlertFacts['kind'];

// The alerts that stay true for a while (10.4, 10.5).
export type LastingKind = 'totals-mismatch' | 'bank-login';
export const LASTING_KINDS: readonly LastingKind[] = ['totals-mismatch', 'bank-login'];

// One alert as it was worked out: kept in the book's history (an "alerts"
// event) and in the outbox, in the same step.
export interface AlertRecord {
  // The same alert always has the same key, so it is kept and sent once.
  readonly key: string;
  readonly facts: AlertFacts;
  // When it came due, as an instant (ISO, UTC): the moment of the sync or
  // answer that made it true, or the evening it is for.
  readonly dueAt: string;
  readonly title: string;
  readonly body: string;
}

// What makes an alert the same alert: its rule's "once".
export function alertKey(f: AlertFacts): string {
  switch (f.kind) {
    case 'low-bucket':
    case 'empty-bucket':
      return `${f.kind} ${f.bucket} pay period ${f.period}`;
    case 'daily-review':
      return `daily-review ${f.date}`;
    case 'card-reminder':
      return `card-reminder ${f.card} due ${f.dueDate} ${f.daysBefore} days before`;
    case 'card-overdue':
      return `card-overdue ${f.card} due ${f.dueDate} on ${f.date}`;
    case 'totals-mismatch':
    case 'bank-login':
      return `${f.kind} ${f.time}`;
    case 'bank-took-back':
      return `bank-took-back ${f.id}`;
  }
}

export function alertRecord(facts: AlertFacts, dueAt: string): AlertRecord {
  return { key: alertKey(facts), facts, dueAt, ...alertWords(facts) };
}

const BUCKETS = { needs: 'Needs', wants: 'Wants' } as const;
const CARDS: Readonly<Record<Card, string>> = { 'everyday-card': 'Everyday card', 'old-card': 'Old card' };

// "Fri, Oct 23".
export function dayWords(date: IsoDate): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// What the phone shows: a title and a line. The amounts are in it, as the
// rules say (9.1, 9.2, 10.4; QUESTIONS.md A39 asks about the lock screen).
export function alertWords(f: AlertFacts): { readonly title: string; readonly body: string } {
  switch (f.kind) {
    case 'low-bucket':
      return { title: `${BUCKETS[f.bucket]} is low`, body: `${formatDollars(f.amount)} left of ${formatDollars(f.startedWith)} this pay period.` };
    case 'empty-bucket':
      return {
        title: `${BUCKETS[f.bucket]} is empty`,
        body: f.amount < 0 ? `It is ${formatDollars(-f.amount)} over for this pay period.` : 'Nothing is left in it for this pay period.',
      };
    case 'daily-review':
      return { title: 'Time to review', body: f.waiting === 1 ? '1 thing is waiting for you to sort.' : `${f.waiting} things are waiting for you to sort.` };
    case 'card-reminder': {
      const when = f.daysBefore === 0 ? 'today' : f.daysBefore === 1 ? 'tomorrow' : `in ${f.daysBefore} days`;
      const amounts = f.statementBalance === null ? `Minimum ${formatDollars(f.minimumPayment)}.` : `Statement balance ${formatDollars(f.statementBalance)}, minimum ${formatDollars(f.minimumPayment)}.`;
      return { title: `${CARDS[f.card]} payment due ${when}`, body: `${amounts} Due ${dayWords(f.dueDate)}.` };
    }
    case 'card-overdue':
      return { title: `${CARDS[f.card]} payment is overdue`, body: `The minimum, ${formatDollars(f.minimumPayment)}, was due ${dayWords(f.dueDate)}, and less than that has been paid since the statement.` };
    case 'totals-mismatch':
      return {
        title: 'Your totals do not match the bank',
        body: `Off by ${formatDollars(Math.abs(f.difference))}: the bank shows ${f.difference < 0 ? 'less' : 'more'} than your buckets add up to. Safe to spend is hidden until they match.`,
      };
    case 'bank-login':
      return { title: 'Log in to your bank again', body: 'The bank wants you to log in again before the app can read it.' };
    case 'bank-took-back':
      return { title: 'The bank took something back', body: `${f.description}, ${formatDollars(f.amount)}, taken back ${dayWords(f.date)}. It is undone in your buckets too.` };
  }
}
