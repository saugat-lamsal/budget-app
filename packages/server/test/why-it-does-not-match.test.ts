import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { whyItDoesNotMatch, type AccountAtRead, type BankAtRead, type CheckAccount, type PendingItemNow, type PostedItemSince, type WhyInput } from '../src/bank/why.js';
import type { WhyLine } from '../src/views/home.js';

// Rule 12.6 (QUESTIONS.md A57): why the totals do not match, worked out from
// the bank's balances kept with the last read that matched and now, in lines
// that add up to the difference exactly. Amounts in Plaid's sign: money out of
// an account (or onto a card) is above zero. Every name and number is made up.

const account = (posted: number, extra: Partial<AccountAtRead> = {}): AccountAtRead => ({ posted, available: posted, counted: posted, items: 0, ...extra });
const card = (posted: number, extra: Partial<AccountAtRead> = {}): AccountAtRead => ({ posted, available: null, counted: posted, items: 0, ...extra });

function read(accounts: Partial<Record<CheckAccount, AccountAtRead>>, pending: BankAtRead['pending'] = [], syncs = 4): BankAtRead {
  return { accounts: { checking: account(300_000), savings: account(500_000), 'everyday-card': card(40_000), ...accounts }, pending, syncs };
}

const sum = (lines: readonly WhyLine[]): number => lines.reduce((total, line) => total + line.amount, 0);

function why(input: Partial<WhyInput> & Pick<WhyInput, 'difference' | 'now'>): WhyLine[] {
  return whyItDoesNotMatch({ then: read({}), pendingNow: [], postedSince: [], ...input });
}

const coffee: PendingItemNow = { id: 'p-coffee', account: 'everyday-card', amount: 2_500, description: 'COFFEE CART MADE UP', purchase: true };

describe('12.6 why it does not match', () => {
  it('12.6 the case that prompted it: a card charge posted at the bank while Plaid still says pending, and checking up with no transaction, in two lines that add up to the difference', () => {
    // At the last read that matched: the card owed $400.00 posted, plus the
    // $25.00 coffee still pending (counted once, 4.6).
    const then = read({ 'everyday-card': card(40_000, { counted: 42_500, items: 2_500 }) }, [{ id: 'p-coffee', account: 'everyday-card', amount: 2_500 }]);
    // Now the bank has posted it, and Plaid still lists it as pending: the
    // check counts it twice. And checking's available balance is $27.50 up.
    const now = read({ checking: account(302_750), 'everyday-card': card(42_500, { counted: 45_000, items: 2_500 }) }, [{ id: 'p-coffee', account: 'everyday-card', amount: 2_500 }]);
    const lines = whyItDoesNotMatch({ difference: 250, then, now, pendingNow: [coffee], postedSince: [] });
    expect(lines).toEqual([
      { kind: 'balance-moved', account: 'checking', balance: 'available', went: 'up', by: 2_750, amount: 2_750 },
      { kind: 'posted-still-pending', account: 'everyday-card', description: 'COFFEE CART MADE UP', charge: true, amount: -2_500 },
    ]);
    expect(sum(lines)).toBe(250);
  });

  it('12.6 no earlier read that matched is kept: one line, with the whole difference', () => {
    expect(whyItDoesNotMatch({ difference: -4_210, then: null, now: read({}), pendingNow: [], postedSince: [] })).toEqual([{ kind: 'no-match-kept', amount: -4_210 }]);
  });

  it('12.6 totals that match need no lines', () => {
    expect(why({ difference: 0, now: read({}) })).toEqual([]);
    // Even when balances moved both ways by as much.
    expect(why({ difference: 0, now: read({ checking: account(300_500), savings: account(499_500) }) })).toEqual([]);
    expect(whyItDoesNotMatch({ difference: 0, then: null, now: read({}), pendingNow: [], postedSince: [] })).toEqual([]);
  });

  it('12.6 a pending deposit that posted while Plaid still lists the pending one too', () => {
    // Pending $900.00 in, already in the available balance (A54), so taken out of what the check counts.
    const then = read({ checking: account(300_000, { available: 390_000, counted: 300_000 }) }, [{ id: 'p-pay', account: 'checking', amount: -90_000 }]);
    // It posted: the books count it, but Plaid still lists the pending one, which is still taken out.
    const now = read({ checking: account(390_000, { available: 390_000, counted: 300_000, items: -90_000 }) }, [{ id: 'p-pay', account: 'checking', amount: -90_000 }]);
    const pendingNow: PendingItemNow[] = [{ id: 'p-pay', account: 'checking', amount: -90_000, description: 'MADE UP PAYROLL', purchase: false }];
    const postedSince: PostedItemSince[] = [{ id: 'pay', account: 'checking', amount: -90_000, description: 'MADE UP PAYROLL' }];
    // The books went up $900.00; the bank side did not move.
    const lines = whyItDoesNotMatch({ difference: -90_000, then, now, pendingNow, postedSince });
    expect(lines).toEqual([{ kind: 'posted-and-pending', account: 'checking', description: 'MADE UP PAYROLL', amount: -90_000 }]);
    // A pending item of another amount is not its twin.
    const other: PendingItemNow[] = [{ id: 'p-pay', account: 'checking', amount: -5_000, description: 'MADE UP GIFT', purchase: false }];
    const thenOther = read({ checking: account(300_000, { available: 305_000, counted: 300_000 }) }, [{ id: 'p-pay', account: 'checking', amount: -5_000 }]);
    const nowOther = read({ checking: account(390_000, { available: 305_000, counted: 300_000, items: -90_000 }) }, [{ id: 'p-pay', account: 'checking', amount: -5_000 }]);
    expect(whyItDoesNotMatch({ difference: -90_000, then: thenOther, now: nowOther, pendingNow: other, postedSince })).toEqual([
      { kind: 'balance-moved', account: 'checking', balance: 'available', went: 'down', by: 90_000, amount: -90_000 },
    ]);
  });

  it('12.6 a pending item whose amount Plaid changed while the available balance still has the old one', () => {
    // A $40.00 dinner pending; Plaid now says $48.00 (the tip), the bank's available still has $40.00 off.
    const then = read({ checking: account(300_000, { available: 296_000, counted: 296_000, items: 4_000 }) }, [{ id: 'p-dinner', account: 'checking', amount: 4_000 }]);
    const now = read({ checking: account(300_000, { available: 296_000, counted: 296_000, items: 4_800 }) }, [{ id: 'p-dinner', account: 'checking', amount: 4_800 }]);
    const pendingNow: PendingItemNow[] = [{ id: 'p-dinner', account: 'checking', amount: 4_800, description: 'MADE UP BISTRO', purchase: true }];
    // The books took $8.00 more; the bank side did not move.
    const lines = whyItDoesNotMatch({ difference: 800, then, now, pendingNow, postedSince: [] });
    expect(lines).toEqual([{ kind: 'amount-changed', account: 'checking', description: 'MADE UP BISTRO', was: 4_000, now: 4_800, amount: 800 }]);
  });

  it('12.6 a pending item Plaid lists that the available balance does not show yet', () => {
    const now = read({ checking: account(300_000, { items: 1_999 }) }, [{ id: 'p-lunch', account: 'checking', amount: 1_999 }]);
    const pendingNow: PendingItemNow[] = [{ id: 'p-lunch', account: 'checking', amount: 1_999, description: 'MADE UP DELI', purchase: true }];
    expect(why({ difference: 1_999, now, pendingNow })).toEqual([{ kind: 'not-in-available-yet', account: 'checking', description: 'MADE UP DELI', amount: 1_999 }]);
    // Money in pending that the available balance does not show yet: taken out all the same.
    const inNow = read({ savings: account(500_000, { counted: 495_000 }) }, [{ id: 'p-gift', account: 'savings', amount: -5_000 }]);
    expect(why({ difference: -5_000, now: inNow, pendingNow: [{ id: 'p-gift', account: 'savings', amount: -5_000, description: 'MADE UP GIFT', purchase: false }] })).toEqual([
      { kind: 'not-in-available-yet', account: 'savings', description: 'MADE UP GIFT', amount: -5_000 },
    ]);
  });

  it('12.6 money in still pending on the card that the balance already took (a refund): counted once Plaid says it posted', () => {
    const then = read({}, [{ id: 'p-refund', account: 'everyday-card', amount: -3_000 }]);
    const now = read({ 'everyday-card': card(37_000) }, [{ id: 'p-refund', account: 'everyday-card', amount: -3_000 }]);
    const pendingNow: PendingItemNow[] = [{ id: 'p-refund', account: 'everyday-card', amount: -3_000, description: 'MADE UP SHOE STORE', purchase: false }];
    expect(whyItDoesNotMatch({ difference: 3_000, then, now, pendingNow, postedSince: [] })).toEqual([
      { kind: 'posted-still-pending', account: 'everyday-card', description: 'MADE UP SHOE STORE', charge: false, amount: 3_000 },
    ]);
  });

  it('12.6 checking with no available balance from the bank reads like the card: a pending charge its posted balance already took', () => {
    const noAvailable = (posted: number, extra: Partial<AccountAtRead> = {}): AccountAtRead => ({ ...account(posted, extra), available: null });
    const then = read({ checking: noAvailable(300_000, { counted: 298_800, items: 1_200 }) }, [{ id: 'p-gas', account: 'checking', amount: 1_200 }]);
    const now = read({ checking: noAvailable(298_800, { counted: 297_600, items: 1_200 }) }, [{ id: 'p-gas', account: 'checking', amount: 1_200 }]);
    const pendingNow: PendingItemNow[] = [{ id: 'p-gas', account: 'checking', amount: 1_200, description: 'MADE UP GAS', purchase: true }];
    expect(whyItDoesNotMatch({ difference: -1_200, then, now, pendingNow, postedSince: [] })).toEqual([
      { kind: 'posted-still-pending', account: 'checking', description: 'MADE UP GAS', charge: true, amount: -1_200 },
    ]);
  });

  it('12.6 named only when it accounts for the move to the cent: one cent off, the whole move is one line', () => {
    const then = read({ 'everyday-card': card(40_000, { counted: 42_500, items: 2_500 }) }, [{ id: 'p-coffee', account: 'everyday-card', amount: 2_500 }]);
    const now = read({ 'everyday-card': card(42_501, { counted: 45_001, items: 2_500 }) }, [{ id: 'p-coffee', account: 'everyday-card', amount: 2_500 }]);
    expect(whyItDoesNotMatch({ difference: -2_501, then, now, pendingNow: [coffee], postedSince: [] })).toEqual([
      { kind: 'balance-moved', account: 'everyday-card', balance: 'posted', went: 'up', by: 2_501, amount: -2_501 },
    ]);
  });

  it('12.6 one cent: a one-cent move is a line of its own', () => {
    expect(why({ difference: 1, now: read({ checking: account(300_001) }) })).toEqual([{ kind: 'balance-moved', account: 'checking', balance: 'available', went: 'up', by: 1, amount: 1 }]);
    expect(why({ difference: -1, now: read({ savings: account(499_999) }) })).toEqual([{ kind: 'balance-moved', account: 'savings', balance: 'available', went: 'down', by: 1, amount: -1 }]);
    // The card owing a cent less: the bank side is a cent higher.
    expect(why({ difference: 1, now: read({ 'everyday-card': card(39_999) }) })).toEqual([{ kind: 'balance-moved', account: 'everyday-card', balance: 'posted', went: 'down', by: 1, amount: 1 }]);
  });

  it('12.6 several charges posted at once: the fewest that account for the move, oldest first', () => {
    const pending = [
      { id: 'a', account: 'everyday-card' as const, amount: 1_000 },
      { id: 'b', account: 'everyday-card' as const, amount: 2_000 },
      { id: 'c', account: 'everyday-card' as const, amount: 3_000 },
    ];
    const pendingNow: PendingItemNow[] = pending.map((p) => ({ ...p, description: `MADE UP ${p.id.toUpperCase()}`, purchase: true }));
    const then = read({ 'everyday-card': card(40_000, { counted: 46_000, items: 6_000 }) }, pending);
    // The bank posted $30.00 of them: c alone, or a and b; one item is fewer.
    const now = read({ 'everyday-card': card(43_000, { counted: 49_000, items: 6_000 }) }, pending);
    expect(whyItDoesNotMatch({ difference: -3_000, then, now, pendingNow, postedSince: [] }).map((l) => (l.kind === 'posted-still-pending' ? l.description : l.kind))).toEqual(['MADE UP C']);
    // $40.00: a and c (b alone cannot do it); all three: $60.00.
    const forty = read({ 'everyday-card': card(44_000, { counted: 50_000, items: 6_000 }) }, pending);
    expect(whyItDoesNotMatch({ difference: -4_000, then, now: forty, pendingNow, postedSince: [] }).map((l) => (l.kind === 'posted-still-pending' ? l.description : l.kind))).toEqual(['MADE UP A', 'MADE UP C']);
    const sixty = read({ 'everyday-card': card(46_000, { counted: 52_000, items: 6_000 }) }, pending);
    expect(sum(whyItDoesNotMatch({ difference: -6_000, then, now: sixty, pendingNow, postedSince: [] }))).toBe(-6_000);
    expect(whyItDoesNotMatch({ difference: -6_000, then, now: sixty, pendingNow, postedSince: [] })).toHaveLength(3);
  });

  it('12.6 what the bank\'s balances and transactions do not account for is the rest, one more line', () => {
    // Nothing moved at the bank, yet the difference is $12.34: the books moved on their own.
    expect(why({ difference: 1_234, now: read({}) })).toEqual([{ kind: 'rest', amount: 1_234 }]);
    // A move named, and the rest beside it.
    const lines = why({ difference: 1_300, now: read({ checking: account(300_066) }) });
    expect(lines).toEqual([
      { kind: 'balance-moved', account: 'checking', balance: 'available', went: 'up', by: 66, amount: 66 },
      { kind: 'rest', amount: 1_234 },
    ]);
  });

  it('12.6 a transaction that moved its balance as it should is no line at all', () => {
    // A $50.00 purchase posted: the available balance went down by it, and it is one of the bank's transactions.
    const now = read({ checking: account(295_000, { items: 5_000 }) });
    expect(why({ difference: 0, now })).toEqual([]);
    expect(why({ difference: 7, now: read({ checking: account(295_007, { items: 5_000 }) }) })).toEqual([{ kind: 'balance-moved', account: 'checking', balance: 'available', went: 'up', by: 7, amount: 7 }]);
  });

  it('12.6 very large amounts add up exactly too', () => {
    const big = 9_000_000_000_000;
    const lines = why({ difference: big - 1, now: read({ checking: account(300_000 + big), 'everyday-card': card(40_001) }) });
    expect(lines).toEqual([
      { kind: 'balance-moved', account: 'checking', balance: 'available', went: 'up', by: big, amount: big },
      { kind: 'balance-moved', account: 'everyday-card', balance: 'posted', went: 'up', by: 1, amount: -1 },
    ]);
    expect(sum(lines)).toBe(big - 1);
  });

  it('12.6 an account that gained or lost its available balance since the read that matched has its whole move as one line', () => {
    const now = read({ checking: { ...account(300_000, { items: 2_000 }), available: null, counted: 298_000 } }, [{ id: 'p-x', account: 'checking', amount: 2_000 }]);
    const pendingNow: PendingItemNow[] = [{ id: 'p-x', account: 'checking', amount: 2_000, description: 'MADE UP X', purchase: true }];
    expect(why({ difference: 0, now, pendingNow })).toEqual([]);
    expect(why({ difference: 5, now: read({ checking: { ...account(300_005), available: null } }) })).toEqual([{ kind: 'balance-moved', account: 'checking', balance: 'posted', went: 'up', by: 5, amount: 5 }]);
  });

  it('12.6 an account read from its available balance then and its posted balance now: no cause is named, even one that would add up', () => {
    // The bank stopped giving checking's available balance. A pending charge
    // first seen since would account for the move if it were read as before.
    // A transfer out pending since: read as before, "Plaid lists it as pending" would account for the $20.00.
    const now = read({ checking: { ...account(302_000), available: null } }, [{ id: 'p-x', account: 'checking', amount: 2_000 }]);
    const pendingNow: PendingItemNow[] = [{ id: 'p-x', account: 'checking', amount: 2_000, description: 'MADE UP X', purchase: false }];
    expect(why({ difference: 2_000, now, pendingNow })).toEqual([{ kind: 'balance-moved', account: 'checking', balance: 'posted', went: 'up', by: 2_000, amount: 2_000 }]);
  });

  it('12.6 for any balances, transactions and difference, the lines add up to the difference, to the cent', () => {
    const cents = fc.integer({ min: -2_000_000_000, max: 2_000_000_000 });
    const anAccount = fc.record({ posted: cents, available: fc.option(cents, { nil: null }), counted: cents, items: cents });
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const accounts = fc.constantFrom<CheckAccount>('checking', 'savings', 'everyday-card');
    const pending = fc.uniqueArray(fc.record({ id: fc.constantFrom(...ids), account: accounts, amount: fc.integer({ min: -500_000, max: 500_000 }) }), { selector: (p) => p.id, maxLength: 5 });
    const atRead = fc.record({ checking: anAccount, savings: anAccount, everyday: anAccount, pending });
    const toRead = (r: { checking: AccountAtRead; savings: AccountAtRead; everyday: AccountAtRead; pending: BankAtRead['pending'] }): BankAtRead => ({
      accounts: { checking: r.checking, savings: r.savings, 'everyday-card': { ...r.everyday, available: null } },
      pending: r.pending,
      syncs: 3,
    });
    fc.assert(
      fc.property(cents, fc.option(atRead, { nil: null }), atRead, fc.array(fc.record({ id: fc.constantFrom('q1', 'q2'), account: accounts, amount: fc.integer({ min: -500_000, max: 500_000 }) }), { maxLength: 3 }), (difference, then, now, posted) => {
        const nowRead = toRead(now);
        const pendingNow = nowRead.pending.map((p, i) => ({ ...p, description: `MADE UP ${i}`, purchase: p.amount > 0 && i % 2 === 0 }));
        const lines = whyItDoesNotMatch({ difference, then: then === null ? null : toRead(then), now: nowRead, pendingNow, postedSince: posted.map((p, i) => ({ ...p, description: `MADE UP POSTED ${i}` })) });
        expect(sum(lines)).toBe(difference);
        for (const line of lines) {
          expect(Number.isSafeInteger(line.amount)).toBe(true);
          expect(line.amount).not.toBe(0);
        }
      }),
      { numRuns: 2_000 },
    );
  });
});
