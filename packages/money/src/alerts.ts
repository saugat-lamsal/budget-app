import type { Cents } from './cents.js';
import type { BankBalances } from './self-check.js';

// Rulebook section 10: the alerts due right now (Book.takeAlerts). Sending
// each one to the phone at the right time is Phase 5.
//
// 10.1 (low bucket) is not built: what "20% left" is measured against is an
// open question (QUESTIONS.md A8).

export type Alert =
  | { readonly kind: 'empty-bucket'; readonly bucket: 'needs' | 'wants'; readonly amount: Cents }
  | { readonly kind: 'daily-review'; readonly at: string; readonly waiting: number }
  | { readonly kind: 'totals-mismatch'; readonly difference: Cents }
  | { readonly kind: 'bank-login' };

export interface AlertInput {
  // Whether the bank connection needs you to log in again (10.5).
  readonly bankConnection: 'ok' | 'needs-login';
  // Today's bank balances, including pending charges, for the self-check
  // (10.4).
  readonly bankBalances: BankBalances;
}
