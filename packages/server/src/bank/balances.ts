import { addCents, withPendingCharges, type AccountId, type BankBalances, type Cents, type PendingCharge } from '@budget-app/money';
import type { StoredAccount } from '../db/store.js';
import type { StoredItem } from '../sync/plan.js';
import { BankDataError } from '../errors.js';
import { centsFromPlaid } from './amounts.js';

// Rule 12.1, the bank side of the self-check: checking + savings - everyday
// card balance, including pending charges.
//
// Plaid's "current" balance is the posted one: what a bank account holds, or
// what a card owes, before anything pending (B36; checked against the test
// bank by the live tests). Pending charges are added from the bank's own list
// of pending transactions, at the bank's latest amounts. Only pending
// purchases count, savings ones included (4.9): they are the only pending
// items the book counts (4.6).
// Pending money in, and pending transfers and payments, count once they post.
export interface BankView {
  // The posted balances of checking, savings and the everyday card.
  readonly posted: BankBalances;
  readonly pendingCharges: readonly PendingCharge[];
  // Posted plus pending charges: what the self-check compares.
  readonly withPending: BankBalances;
  // What the old card owes, posted and with its pending charges. Not part
  // of the self-check (12.4); the book tracks it as debt.
  readonly oldCardPosted: Cents;
  readonly oldCardWithPending: Cents;
}

export type BankViewResult = { readonly ok: true; readonly view: BankView } | { readonly ok: false; readonly why: string };

export function bankView(accounts: readonly StoredAccount[], items: ReadonlyMap<string, StoredItem>): BankViewResult {
  try {
    const roles = new Map<string, AccountId>();
    const posted = (role: AccountId): Cents => {
      const account = accounts.find((a) => a.role === role);
      if (account === undefined) throw new BankDataError(`no account is set as the ${role} account`);
      const currency = account.raw.balances.iso_currency_code;
      if (currency !== 'USD' && currency !== null) throw new BankDataError(`the ${role} balance is not in dollars`);
      if (account.raw.balances.current === null) throw new BankDataError(`the bank did not give the ${role} balance`);
      return centsFromPlaid(account.raw.balances.current, `the ${role} balance`);
    };
    for (const a of accounts) if (a.role !== null) roles.set(a.plaidAccountId, a.role);
    const pendingCharges: PendingCharge[] = [];
    for (const item of items.values()) {
      const role = roles.get(item.accountId);
      if (!item.pending || item.removed || item.replacedBy !== null || item.kind !== 'purchase' || role === undefined) continue;
      if (item.amountCents === null || item.amountCents <= 0) continue;
      pendingCharges.push({ account: role, amount: item.amountCents });
    }
    const balances: BankBalances = { checking: posted('checking'), savings: posted('savings'), everydayCard: posted('everyday-card') };
    const oldCardPosted = posted('old-card');
    const oldCardPending = pendingCharges.filter((c) => c.account === 'old-card').map((c) => c.amount);
    return {
      ok: true,
      view: {
        posted: balances,
        pendingCharges,
        withPending: withPendingCharges(balances, pendingCharges),
        oldCardPosted,
        oldCardWithPending: addCents(oldCardPosted, ...oldCardPending),
      },
    };
  } catch (error) {
    if (error instanceof BankDataError) return { ok: false, why: error.message };
    throw error;
  }
}
