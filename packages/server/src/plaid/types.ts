// The parts of Plaid's responses the app reads, with Plaid's own field names
// (API version 2020-09-14). Plaid sends more; the rest is kept as it came,
// but not relied on. Dollar amounts are JSON numbers; positive means money
// left the account, negative means money came in, on every kind of account.

export interface PlaidBalances {
  // Posted: what the account holds, or for a card what is owed.
  readonly current: number | null;
  // Posted, less pending money out, plus pending money in.
  readonly available: number | null;
  readonly limit: number | null;
  readonly iso_currency_code: string | null;
  readonly unofficial_currency_code: string | null;
}

export interface PlaidAccount {
  readonly account_id: string;
  readonly balances: PlaidBalances;
  readonly mask: string | null;
  readonly name: string;
  readonly official_name: string | null;
  readonly type: string;
  readonly subtype: string | null;
}

export interface PlaidTransaction {
  readonly transaction_id: string;
  readonly account_id: string;
  readonly amount: number;
  readonly iso_currency_code: string | null;
  readonly unofficial_currency_code: string | null;
  // For a pending transaction, the day it happened; once posted, the day it posted.
  readonly date: string;
  // The day it was authorized, when the bank says.
  readonly authorized_date: string | null;
  readonly name: string;
  readonly merchant_name?: string | null;
  // The bank's own description, unchanged (asked for with include_original_description).
  readonly original_description?: string | null;
  readonly pending: boolean;
  // On a posted transaction: the pending one it replaces, when Plaid matched them.
  readonly pending_transaction_id: string | null;
  readonly personal_finance_category?: { readonly primary: string; readonly detailed: string } | null;
}

export interface PlaidRemovedTransaction {
  readonly transaction_id: string;
  readonly account_id?: string;
}

export interface TransactionsSyncResponse {
  readonly added: readonly PlaidTransaction[];
  readonly modified: readonly PlaidTransaction[];
  readonly removed: readonly PlaidRemovedTransaction[];
  readonly next_cursor: string;
  readonly has_more: boolean;
  readonly transactions_update_status?: string;
  readonly accounts?: readonly PlaidAccount[];
  readonly request_id: string;
}

export interface PlaidErrorBody {
  readonly error_type: string;
  readonly error_code: string;
  readonly error_message?: string;
  readonly request_id?: string;
}

export interface PlaidItem {
  readonly item_id: string;
  readonly institution_id?: string | null;
  readonly error: PlaidErrorBody | null;
  // 10.13: when the bank stops letting the app read the accounts (an instant), for banks that set one.
  readonly consent_expiration_time?: string | null;
}

export interface AccountsGetResponse {
  readonly accounts: readonly PlaidAccount[];
  readonly item: PlaidItem;
  readonly request_id: string;
}

export interface PlaidCreditCard {
  readonly account_id: string | null;
  readonly is_overdue: boolean | null;
  readonly last_payment_amount: number | null;
  readonly last_payment_date: string | null;
  readonly last_statement_issue_date: string | null;
  readonly last_statement_balance: number | null;
  readonly minimum_payment_amount: number | null;
  readonly next_payment_due_date: string | null;
}

export interface LiabilitiesGetResponse {
  readonly accounts: readonly PlaidAccount[];
  readonly item: PlaidItem;
  readonly liabilities: { readonly credit: readonly PlaidCreditCard[] | null };
  readonly request_id: string;
}

export interface ItemGetResponse {
  readonly item: PlaidItem;
  readonly request_id: string;
}

// A transaction added to the test bank by /sandbox/transactions/create.
// Both dates must be today or earlier, so these always arrive posted.
export interface SandboxTransaction {
  readonly account_id?: string;
  readonly date_transacted: string;
  readonly date_posted: string;
  readonly amount: number;
  readonly description: string;
  readonly iso_currency_code?: string;
}

// Section 2 (A47): /webhook_verification_key/get.
export interface WebhookKeyResponse {
  readonly key: {
    readonly alg: string;
    readonly crv: string;
    readonly kid: string;
    readonly kty: string;
    readonly use?: string;
    readonly x: string;
    readonly y: string;
    readonly created_at: number;
    readonly expired_at: number | null;
  };
  readonly request_id?: string;
}
