import { describe, expect, it } from 'vitest';
import { postingExamples, usuallyPostsWithin, type PostingExample } from '../src/bank/posting-times.js';
import type { StoredAccount } from '../src/bank/stored-account.js';
import type { StoredItem } from '../src/sync/plan.js';
import { ACCOUNT_IDS } from './fake-plaid.js';

// Rule 11.4 (QUESTIONS.md A57): how long money pending in usually takes to
// post, learned from his own history: the time from when the app first saw
// each earlier one pending to when it first saw it posted. With at least 3
// of the same kind on the same account: the time within which at least three
// in four of the last 10 posted, rounded up to the hour, or to the day from 2
// days. Never a promise. Every name and number is made up.

const HOUR = 3_600_000;
const example = (hours: number, postedAt: string, extra: Partial<PostingExample> = {}): PostingExample => ({ account: 'checking', description: 'MADE UP PAYROLL', ms: hours * HOUR, postedAt, ...extra });
const days = (n: number): string => `2026-10-${String(n).padStart(2, '0')}T12:00:00.000Z`;

describe('11.4 usually posts within', () => {
  it('11.4 fewer than 3 earlier ones: no figure, only pending since', () => {
    expect(usuallyPostsWithin([])).toBeNull();
    expect(usuallyPostsWithin([example(5, days(1)), example(6, days(2))])).toBeNull();
  });

  it('11.4 three earlier ones: within which all three posted (three in four of three is all of them)', () => {
    expect(usuallyPostsWithin([example(5, days(1)), example(9, days(2)), example(7, days(3))])).toEqual({ within: 9, unit: 'hours' });
  });

  it('11.4 four: the third quickest; ten: the eighth', () => {
    expect(usuallyPostsWithin([example(5, days(1)), example(9, days(2)), example(7, days(3)), example(30, days(4))])).toEqual({ within: 9, unit: 'hours' });
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((h, i) => example(h, days(i + 1)));
    expect(usuallyPostsWithin(ten)).toEqual({ within: 8, unit: 'hours' });
  });

  it('11.4 only the last 10: older ones do not count', () => {
    // Ten quick ones lately, after four slow ones long ago.
    const slowFirst = [example(40, days(1)), example(40, days(2)), example(40, days(3)), example(40, days(4)), ...[1, 1, 1, 1, 1, 1, 1, 1, 1, 1].map((h, i) => example(h, days(i + 5)))];
    expect(usuallyPostsWithin(slowFirst)).toEqual({ within: 1, unit: 'hours' });
    // In whatever order they are handed over.
    expect(usuallyPostsWithin([...slowFirst].reverse())).toEqual({ within: 1, unit: 'hours' });
  });

  it('11.4 rounded up to the hour; from 2 days, to the day', () => {
    const three = (ms: number): ReturnType<typeof usuallyPostsWithin> => usuallyPostsWithin([0, 1, 2].map((i) => ({ ...example(0, days(i + 1)), ms })));
    expect(three(0)).toEqual({ within: 1, unit: 'hours' });
    expect(three(1)).toEqual({ within: 1, unit: 'hours' });
    expect(three(HOUR)).toEqual({ within: 1, unit: 'hours' });
    expect(three(HOUR + 1)).toEqual({ within: 2, unit: 'hours' });
    expect(three(47 * HOUR)).toEqual({ within: 47, unit: 'hours' });
    expect(three(47 * HOUR + 1)).toEqual({ within: 2, unit: 'days' });
    expect(three(48 * HOUR)).toEqual({ within: 2, unit: 'days' });
    expect(three(48 * HOUR + 1)).toEqual({ within: 3, unit: 'days' });
    expect(three(400 * 24 * HOUR)).toEqual({ within: 400, unit: 'days' });
  });
});

const accounts: StoredAccount[] = [
  { plaidAccountId: ACCOUNT_IDS.checking, role: 'checking', raw: {} as StoredAccount['raw'], rawText: '{}' },
  { plaidAccountId: ACCOUNT_IDS.savings, role: 'savings', raw: {} as StoredAccount['raw'], rawText: '{}' },
  { plaidAccountId: ACCOUNT_IDS.everyday, role: 'everyday-card', raw: {} as StoredAccount['raw'], rawText: '{}' },
];

function item(id: string, extra: Partial<StoredItem> & { readonly description?: string; readonly link?: string }): StoredItem {
  const amount = extra.amountCents ?? -90_000;
  return {
    transactionId: id,
    accountId: extra.accountId ?? ACCOUNT_IDS.checking,
    raw: { transaction_id: id, account_id: extra.accountId ?? ACCOUNT_IDS.checking, amount: amount / 100, iso_currency_code: 'USD', unofficial_currency_code: null, date: '2026-10-02', authorized_date: null, name: extra.description ?? 'MADE UP PAYROLL', original_description: extra.description ?? 'MADE UP PAYROLL', pending: extra.pending ?? false, pending_transaction_id: extra.link ?? null },
    pending: extra.pending ?? false,
    amountCents: amount,
    removed: extra.removed ?? false,
    status: 'sent',
    kind: extra.kind ?? 'deposit',
    bookId: null,
    replacedBy: null,
    firstSync: extra.firstSync ?? 1,
    lastSync: extra.lastSync ?? extra.firstSync ?? 1,
  };
}

const times = new Map([
  [1, '2026-10-02T10:00:00.000Z'],
  [2, '2026-10-02T19:00:00.000Z'],
  [3, '2026-10-03T10:00:00.000Z'],
]);

describe('11.4 the earlier ones, from his own history', () => {
  it('11.4 a posted deposit linked to its pending one: from when the app first saw it pending to when it first saw it posted', () => {
    const items = new Map([
      ['p', item('p', { pending: true, removed: true, firstSync: 1, lastSync: 2 })],
      ['x', item('x', { firstSync: 2, link: 'p' })],
    ]);
    expect(postingExamples(accounts, items, times)).toEqual([{ account: 'checking', description: 'MADE UP PAYROLL', ms: 9 * HOUR, postedAt: '2026-10-02T19:00:00.000Z' }]);
  });

  it('11.4 not linked by the bank: the pending one it dropped in the same read, on the same account, for the same amount', () => {
    const items = new Map([
      // Another amount, or another account, or dropped in another read: not it.
      ['s', item('s', { pending: true, removed: true, firstSync: 2, lastSync: 2 })],
      ['q', item('q', { pending: true, removed: true, amountCents: -1_000, firstSync: 1, lastSync: 3 })],
      ['r', item('r', { pending: true, removed: true, accountId: ACCOUNT_IDS.savings, firstSync: 1, lastSync: 3 })],
      ['p', item('p', { pending: true, removed: true, firstSync: 1, lastSync: 3 })],
      ['x', item('x', { firstSync: 3 })],
    ]);
    expect(postingExamples(accounts, items, times)).toEqual([{ account: 'checking', description: 'MADE UP PAYROLL', ms: 24 * HOUR, postedAt: '2026-10-03T10:00:00.000Z' }]);
  });

  it('11.4 only money in to checking or savings; none whose times are not both known; each pending one once', () => {
    const items = new Map([
      // A purchase, and money in on the card: not money on its way in.
      ['p1', item('p1', { pending: true, removed: true, amountCents: 4_000, kind: 'purchase', firstSync: 1, lastSync: 2 })],
      ['x1', item('x1', { amountCents: 4_000, kind: 'purchase', firstSync: 2, link: 'p1' })],
      ['p2', item('p2', { pending: true, removed: true, accountId: ACCOUNT_IDS.everyday, kind: 'refund', firstSync: 1, lastSync: 2 })],
      ['x2', item('x2', { accountId: ACCOUNT_IDS.everyday, kind: 'refund', firstSync: 2, link: 'p2' })],
      // Seen pending in a sync whose time is not known.
      ['p3', item('p3', { pending: true, removed: true, firstSync: 9, lastSync: 2 })],
      ['x3', item('x3', { firstSync: 2, link: 'p3' })],
      // A transfer arriving from his own account: not a deposit.
      ['p6', item('p6', { pending: true, removed: true, amountCents: -3_000, kind: 'transfer-arrived', firstSync: 1, lastSync: 2 })],
      ['x6', item('x6', { amountCents: -3_000, kind: 'transfer-arrived', firstSync: 2, link: 'p6' })],
      // Seen posted before it was seen pending (a clock put back): no time to learn from.
      ['p7', item('p7', { pending: true, removed: true, amountCents: -4_000, firstSync: 3, lastSync: 3 })],
      ['x7', item('x7', { amountCents: -4_000, firstSync: 2, link: 'p7' })],
      // Two posted ones for the same amount in one read, and two pending ones it dropped: each its own.
      ['p4', item('p4', { pending: true, removed: true, amountCents: -7_000, firstSync: 1, lastSync: 3 })],
      ['p5', item('p5', { pending: true, removed: true, amountCents: -7_000, firstSync: 2, lastSync: 3 })],
      ['x4', item('x4', { amountCents: -7_000, firstSync: 3 })],
      ['x5', item('x5', { amountCents: -7_000, firstSync: 3 })],
      // A third posted one: no pending one left for it.
      ['x8', item('x8', { amountCents: -7_000, firstSync: 3 })],
      // Two posted ones the bank linked to the same pending one: the first only.
      ['p9', item('p9', { pending: true, removed: true, amountCents: -6_000, firstSync: 2, lastSync: 3 })],
      ['x9', item('x9', { amountCents: -6_000, firstSync: 3, link: 'p9' })],
      ['y9', item('y9', { amountCents: -6_000, firstSync: 3, link: 'p9' })],
    ]);
    expect(postingExamples(accounts, items, times).map((e) => e.ms)).toEqual([24 * HOUR, 15 * HOUR, 15 * HOUR]);
  });
});
