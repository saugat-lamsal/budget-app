import { assertCents, type Cents } from './cents.js';
import type { IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import type { BankBalances } from './self-check.js';

// Rulebook section 10: the alerts due right now (Book.takeAlerts). Sending
// each one to the phone at the right time is Phase 5.

// Where needs or wants stands against rules 10.1 and 10.2, at any moment.
// The screens show it; takeAlerts uses it and adds "once per pay period".
export type BucketLevel = 'ok' | 'low' | 'empty';

// 10.2: zero or below is empty. 10.1: above zero but strictly below a
// percent of what the bucket started the pay period with, compared to the
// exact cent, is low. A bucket that started at zero or below has no level
// above zero to fall under.
export function bucketLevel(amount: Cents, startedWith: Cents, percent: number): BucketLevel {
  assertCents(amount, 'bucket amount');
  assertCents(startedWith, 'what the bucket started with');
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new MoneyError('bad-percent', `percent must be a whole number from 0 to 100, got ${percent}`);
  }
  if (amount <= 0) return 'empty';
  return BigInt(amount) * 100n < BigInt(startedWith) * BigInt(percent) ? 'low' : 'ok';
}

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
