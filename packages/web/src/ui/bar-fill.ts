import type { Cents } from '@budget-app/money';

// How full a bucket bar is, from 0 to 1: what is left over what the bucket
// started the pay period with (10.1). Zero or below is an empty bar (10.2);
// more than it started with is a full bar.
export function barFill(left: Cents, startedWith: Cents): number {
  if (left <= 0) return 0;
  if (startedWith <= 0 || left >= startedWith) return 1;
  return left / startedWith;
}
