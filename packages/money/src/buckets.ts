// The buckets a paycheck is split into, plus the mom reserve.
export type Bucket = 'savings' | 'needs' | 'wants' | 'momReserve';

// The buckets spending can be sorted to (QUESTIONS.md asks whether savings
// and the mom reserve should be allowed too).
export type SplitBucket = 'needs' | 'wants';

export const BUCKETS: readonly Bucket[] = Object.freeze(['savings', 'needs', 'wants', 'momReserve']);
export const SPENDING_BUCKETS: readonly SplitBucket[] = Object.freeze(['needs', 'wants']);

export function isBucket(value: unknown): value is Bucket {
  return (BUCKETS as readonly unknown[]).includes(value);
}

export function isSpendingBucket(value: unknown): value is SplitBucket {
  return (SPENDING_BUCKETS as readonly unknown[]).includes(value);
}
