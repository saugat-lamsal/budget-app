import type { AccountId } from './accounts.js';
import type { SpendingSort } from './book.js';
import type { Cents } from './cents.js';
import type { IsoDate } from './dates.js';
import type { LikelyPurchase } from './likely-purchases.js';
import type { PaycheckSplit } from './payday.js';
import type { ReviewOptions } from './review-options.js';
import type { DepositRuleChoice } from './rules.js';

// Sorting something again (rule 4.7), from the list of what went in and out of
// a bucket. The choices are the ones the rulebook gives for that kind of item,
// the same as in review, less the one it already has (QUESTIONS.md B100).

// Where an item is sorted now.
export type SortedNow = SpendingSort | { readonly to: 'mom' } | { readonly to: DepositRuleChoice['to'] };

export type ResortDetail =
  // It cannot be sorted again from here, and why, in words (B100).
  | { readonly resortable: false; readonly id: string; readonly why: string }
  | {
      readonly resortable: true;
      readonly id: string;
      // Spending, or money in: what it is, for the words around the choices.
      readonly type: 'spending' | 'money-in';
      readonly description: string;
      readonly date: IsoDate;
      // What is counted: for spending what is left of it after refunds (4.5),
      // for money in the deposit.
      readonly amount: Cents;
      readonly account: AccountId;
      readonly pending: boolean;
      // A store refund the app could not match to its purchase (4.5, A18).
      readonly refund: boolean;
      readonly now: SortedNow;
      // Always a 'sort' kind of options: never a leftover or a flag.
      readonly options: Extract<ReviewOptions, { type: 'sort' }>;
      // 20d, A15: for a refund, the purchases it likely belongs to.
      readonly likelyPurchases: readonly LikelyPurchase[];
      // 3.2, 3.3: what "this is my paycheck" would give, when it is offered.
      readonly paycheckPreview: PaycheckSplit | null;
    };
