import type { IsoDate } from '@budget-app/money';
import type { AlertKind } from '../alerts/alerts.js';

// Phase 5, part one: the list of alerts the app worked out and sent, newest
// first, with when each came due and when it went out (the real server only:
// the demo has no outbox). The times are his home time zone's, as the clock
// there shows them, with their offset ("2026-10-09T20:00:00-04:00").

export interface AlertLine {
  readonly key: string;
  readonly kind: AlertKind;
  readonly title: string;
  readonly body: string;
  readonly dueAt: string;
  // Null until it is sent.
  readonly sentAt: string | null;
  readonly tries: number;
  // While it is not sent: why the last try failed, and when it is tried again.
  readonly lastError: string | null;
  readonly nextTryAt: string | null;
  // Not sent yet because it is quiet hours (10.8): when they end.
  readonly quietUntil: string | null;
  // 10.9 (A40), for one the phone could not be given: never sent, as a newer
  // one of its kind went ('newer') or it was no longer true ('not-true'); or
  // not sent yet, waiting behind a newer one of its kind ('held'). Null otherwise.
  readonly notSent: 'newer' | 'not-true' | 'held' | null;
}

export type AlertsView =
  | { readonly state: 'not-set-up' }
  | {
      readonly state: 'tracking';
      readonly today: IsoDate;
      readonly timeZone: string;
      readonly alerts: readonly AlertLine[];
      // How many there are in all; the list has the newest of them.
      readonly total: number;
    };

// How many the list shows at most.
export const ALERTS_SHOWN = 100;
