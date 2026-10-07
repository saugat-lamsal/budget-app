import type { Cents } from './cents.js';
import type { IsoDate } from './dates.js';
import type { BankBalances } from './self-check.js';

// Rulebook section 10: the alerts due right now (Book.takeAlerts). Sending
// each one to the phone at the right time is Phase 5.

export type Alert =
  // 10.1: amount is what is left; startedWith is what the bucket started
  // the pay period with, which the alert level is a percent of.
  | { readonly kind: 'low-bucket'; readonly bucket: 'needs' | 'wants'; readonly amount: Cents; readonly startedWith: Cents }
  | { readonly kind: 'empty-bucket'; readonly bucket: 'needs' | 'wants'; readonly amount: Cents }
  | { readonly kind: 'daily-review'; readonly at: string; readonly waiting: number }
  | { readonly kind: 'totals-mismatch'; readonly difference: Cents }
  | { readonly kind: 'bank-login' }
  // 10.6: the bank took back a transaction the app had counted (4.10).
  // Once, when it happens.
  | { readonly kind: 'bank-took-back'; readonly id: string; readonly date: IsoDate; readonly description: string; readonly amount: Cents };

export interface AlertInput {
  // Whether the bank connection needs you to log in again (10.5).
  readonly bankConnection: 'ok' | 'needs-login';
  // Today's bank balances, including pending charges, for the self-check
  // (10.4).
  readonly bankBalances: BankBalances;
}
