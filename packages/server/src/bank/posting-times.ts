import type { StoredItem } from '../sync/plan.js';
import type { UsuallyPosts } from '../views/home.js';
import { readPlaidItem } from './plaid-item.js';
import type { StoredAccount } from './stored-account.js';

// Rule 11.4 (QUESTIONS.md A57): when money pending in should post, learned
// from his own history, never promised. Each earlier deposit into checking or
// savings that the app saw go from pending to posted is an example: from when
// the app first saw it pending to when it first saw it posted, the times of
// the reads that brought each (bank_reads, database step 11). The pending one
// is the posted one's own (the bank's link, pending_transaction_id), or, when
// the bank does not link them, the pending one it dropped in the same read,
// on the same account, for the same amount. Nothing here asks the clock.

// At least this many of the same kind on the same account, of the last LAST.
export const FEWEST_EXAMPLES = 3;
export const LAST = 10;
// Three in four of them posted within it.
const SHARE = 3 / 4;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface PostingExample {
  readonly account: 'checking' | 'savings';
  // The bank's words while it was pending (what the paycheck rule reads, 11.4).
  readonly description: string;
  // From first seen pending to first seen posted, in milliseconds.
  readonly ms: number;
  // When it was first seen posted (an instant), to keep the last ones.
  readonly postedAt: string;
}

// The examples in his history; syncTimes: when each sync was saved, by the read that saved it.
export function postingExamples(accounts: readonly StoredAccount[], items: ReadonlyMap<string, StoredItem>, syncTimes: ReadonlyMap<number, string>): PostingExample[] {
  const roles = new Map(accounts.flatMap((a) => (a.role === 'checking' || a.role === 'savings' ? [[a.plaidAccountId, a.role] as const] : [])));
  const moneyIn = (i: StoredItem): boolean => roles.has(i.accountId) && i.kind === 'deposit' && i.amountCents !== null && i.amountCents < 0;
  const pendingOnes = [...items.values()].filter((i) => i.pending && moneyIn(i));
  const used = new Set<string>();
  const examples: PostingExample[] = [];
  for (const posted of items.values()) {
    if (posted.pending || posted.removed || !moneyIn(posted)) continue;
    const read = readPlaidItem(posted.raw);
    const link = read.ok ? read.item.pendingTransactionId : null;
    const linked = link === null ? undefined : pendingOnes.find((p) => p.transactionId === link && p.accountId === posted.accountId);
    const pending =
      linked ?? (link === null ? pendingOnes.find((p) => p.removed && p.accountId === posted.accountId && p.amountCents === posted.amountCents && p.lastSync === posted.firstSync && !used.has(p.transactionId)) : undefined);
    if (pending === undefined || used.has(pending.transactionId)) continue;
    const seen = syncTimes.get(pending.firstSync);
    const postedAt = syncTimes.get(posted.firstSync);
    if (seen === undefined || postedAt === undefined) continue;
    const ms = Date.parse(postedAt) - Date.parse(seen);
    if (!(ms >= 0)) continue;
    used.add(pending.transactionId);
    const words = readPlaidItem(pending.raw);
    examples.push({ account: roles.get(posted.accountId)!, description: words.ok ? words.item.description : '', ms, postedAt });
  }
  return examples;
}

// Of examples of one kind on one account: the time within which at least
// three in four of the last 10 posted, rounded up to the hour, or to the day
// from 2 days; null with fewer than 3.
export function usuallyPostsWithin(examples: readonly PostingExample[]): UsuallyPosts | null {
  const last = [...examples].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt)).slice(0, LAST);
  if (last.length < FEWEST_EXAMPLES) return null;
  const ms = last.map((e) => e.ms).sort((a, b) => a - b);
  const within = ms[Math.ceil(SHARE * ms.length) - 1]!;
  const hours = Math.max(1, Math.ceil(within / HOUR));
  return hours < 48 ? { within: hours, unit: 'hours' } : { within: Math.ceil(within / DAY), unit: 'days' };
}
