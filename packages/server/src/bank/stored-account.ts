import type { AccountId } from '@budget-app/money';
import type { PlaidAccount } from '../plaid/types.js';

// One of the connection's accounts as the bank connection keeps it: Plaid's
// account, and which of his four accounts it is (null until he says).
export interface StoredAccount {
  readonly plaidAccountId: string;
  readonly role: AccountId | null;
  readonly raw: PlaidAccount;
  readonly rawText: string;
}

export function rolesOf(accounts: readonly StoredAccount[]): Map<string, AccountId> {
  return new Map(accounts.flatMap((a) => (a.role === null ? [] : [[a.plaidAccountId, a.role] as const])));
}
