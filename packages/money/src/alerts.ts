import type { Book } from './book.js';
import type { Cents } from './cents.js';

// Rulebook section 10: which alerts are due right now. Sending each one to
// the phone, at the right time and only once, is Phase 5.
//
// 10.1 (low bucket) is not built: what "20% left" is measured against is an
// open question (QUESTIONS.md A8).

export type Alert =
  | { readonly kind: 'empty-bucket'; readonly bucket: 'needs' | 'wants'; readonly amount: Cents }
  | { readonly kind: 'daily-review'; readonly at: string; readonly waiting: number }
  | { readonly kind: 'bank-login' };

export interface AlertInput {
  // Whether the bank connection needs you to log in again (10.5).
  readonly bankConnection: 'ok' | 'needs-login';
}

export function alertsNow(book: Book, input: AlertInput): Alert[] {
  const alerts: Alert[] = [];
  const pots = book.pots();
  // 10.2: needs or wants at zero or below.
  for (const bucket of ['needs', 'wants'] as const) {
    if (pots[bucket] <= 0) alerts.push({ kind: 'empty-bucket', bucket, amount: pots[bucket] });
  }
  // 10.3: at the review time, only if something is waiting.
  const waiting = book.reviewItems().length;
  if (waiting > 0) alerts.push({ kind: 'daily-review', at: book.settings().dailyReviewTime, waiting });
  // 10.5
  if (input.bankConnection === 'needs-login') alerts.push({ kind: 'bank-login' });
  return alerts;
}
