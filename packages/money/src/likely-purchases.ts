import type { AccountId } from './accounts.js';
import type { SpendingSort } from './book.js';
import type { Cents } from './cents.js';
import { daysBetween, type IsoDate } from './dates.js';

// QUESTIONS.md A15, rulebook 20d: a refund the app could not match always
// waits in review, and review lists the purchases it likely belongs to. A
// purchase is likely when it is on the same account, on or before the day of
// the refund, has at least that much left to refund (4.5), and either its
// name or its amount matches. The best come first; at most five are shown.
// This only helps choose; it changes nothing.
//
// A33 (rule 4.5): a word is a name only when it is not on most (more than
// half) of his purchases on that account in the 90 days up to the refund, so
// words every purchase has ("MADE UP", a city, "POS") never make two things
// "the same name".

export interface LikelyPurchase {
  readonly id: string;
  readonly date: IsoDate;
  readonly description: string;
  readonly amount: Cents;
  // What of it has not been refunded.
  readonly left: Cents;
  readonly sortedTo: SpendingSort;
  readonly sameName: boolean;
  // The refund is exactly what is left of the purchase.
  readonly sameAmount: boolean;
}

export interface RefundToMatch {
  readonly account: AccountId;
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
}

export interface PurchaseCandidate {
  readonly id: string;
  readonly account: AccountId;
  readonly date: IsoDate;
  readonly description: string;
  readonly amount: Cents;
  readonly left: Cents;
  readonly sortedTo: SpendingSort;
}

export const MOST_LIKELY_SHOWN = 5;
// A33: the purchases a name word must not be on most of: those on the
// refund's day and in the 90 days before it.
export const COMMON_WORD_DAYS = 90;

// Words that say what the bank item is, not who it was with.
const NOT_A_NAME = new Set(['refund', 'return', 'credit', 'reversal', 'adjustment', 'purchase', 'payment']);

function nameWords(description: string): Set<string> {
  return new Set(
    description
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !NOT_A_NAME.has(word)),
  );
}

// A33: the words on more than half of his purchases on the refund's account,
// from the refund's day back COMMON_WORD_DAYS days. A purchase counts a word
// once, however often it is written.
function commonWords(refund: RefundToMatch, candidates: readonly PurchaseCandidate[]): Set<string> {
  const recent = candidates.filter((c) => {
    const before = daysBetween(c.date, refund.date);
    return c.account === refund.account && before >= 0 && before <= COMMON_WORD_DAYS;
  });
  const count = new Map<string, number>();
  for (const c of recent) for (const word of nameWords(c.description)) count.set(word, (count.get(word) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n * 2 > recent.length).map(([word]) => word));
}

export function likelyPurchases(refund: RefundToMatch, candidates: readonly PurchaseCandidate[]): LikelyPurchase[] {
  const common = commonWords(refund, candidates);
  const refundWords = new Set([...nameWords(refund.description)].filter((word) => !common.has(word)));
  return candidates
    .filter((c) => c.account === refund.account && daysBetween(c.date, refund.date) >= 0 && c.left >= refund.amount)
    .map((c) => ({
      id: c.id,
      date: c.date,
      description: c.description,
      amount: c.amount,
      left: c.left,
      sortedTo: c.sortedTo,
      sameName: [...nameWords(c.description)].some((word) => refundWords.has(word)),
      sameAmount: c.left === refund.amount,
    }))
    .filter((p) => p.sameName || p.sameAmount)
    .sort((a, b) => rank(b) - rank(a) || daysBetween(a.date, b.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, MOST_LIKELY_SHOWN);
}

// Name and amount together beat either alone; a name beats an amount.
function rank(p: LikelyPurchase): number {
  return (p.sameName ? 2 : 0) + (p.sameAmount ? 1 : 0);
}
