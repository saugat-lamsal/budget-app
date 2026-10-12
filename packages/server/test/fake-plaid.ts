import type { Cents } from '@budget-app/money';
import type { Fetch } from '../src/plaid/client.js';
import type { PlaidAccount, PlaidCreditCard, PlaidTransaction } from '../src/plaid/types.js';

// A made-up Plaid test bank for the offline tests. It answers the same calls
// with the same shapes as Plaid (API version 2020-09-14), and it behaves like
// a bank: posted balances move when transactions post, pending ones only
// change the available balance, and /transactions/sync hands out the changes
// page by page with a cursor. A pending charge that posts is removed and its
// posted version added with pending_transaction_id, the way Plaid shows it.
// Every name, number and id is made up.

export interface FakeAccountInput {
  readonly id: string;
  readonly name: string;
  readonly mask: string;
  readonly kind: 'checking' | 'savings' | 'credit card';
  // Posted: what a bank account holds, or what a card owes.
  readonly posted: Cents;
  readonly limit?: Cents;
}

export interface FakeTransactionInput {
  readonly id: string;
  readonly account: string;
  // Plaid's sign: positive is money out of the account.
  readonly amount: Cents;
  readonly date: string;
  readonly description: string;
  readonly authorizedDate?: string;
  readonly currency?: string;
}

type Change = { readonly type: 'added' | 'modified'; readonly tx: PlaidTransaction } | { readonly type: 'removed'; readonly id: string; readonly account: string };

interface FakeError {
  readonly status: number;
  readonly body: { readonly error_type: string; readonly error_code: string; readonly error_message: string };
}

export const dollars = (cents: Cents): number => Number((cents / 100).toFixed(2));

export class FakePlaid {
  readonly clientId = 'client-made-up-123';
  readonly secret = 'secret-made-up-456';
  readonly accessToken = 'access-sandbox-11111111-2222-4333-8444-555555555555';
  readonly publicToken = 'public-sandbox-11111111-2222-4333-8444-666666666666';
  readonly itemId = 'item-made-up-1';
  readonly accounts = new Map<string, { input: FakeAccountInput; posted: Cents }>();
  // What the bank shows now, removed transactions left out.
  readonly transactions = new Map<string, PlaidTransaction>();
  readonly cards = new Map<string, PlaidCreditCard>();
  readonly changes: Change[] = [];
  // Every call, in order: the endpoint and what was sent.
  readonly calls: { endpoint: string; body: Record<string, unknown> }[] = [];
  historyComplete = true;
  needsLogin = false;
  // Runs before each call is answered; can change the bank or make the call fail.
  beforeCall: ((endpoint: string, body: Record<string, unknown>, callNumber: number) => FakeError | 'network' | undefined) | undefined;
  // Cursors handed out with has_more, and how many changes there were then.
  readonly #midPage = new Map<string, number>();
  #requestCount = 0;

  constructor(accounts: readonly FakeAccountInput[]) {
    for (const input of accounts) this.accounts.set(input.id, { input, posted: input.posted });
  }

  // ----- The bank -----

  addPosted(input: FakeTransactionInput): PlaidTransaction {
    const tx = this.#transaction(input, false, null);
    this.#post(tx);
    this.#change({ type: 'added', tx });
    return tx;
  }

  addPending(input: FakeTransactionInput): PlaidTransaction {
    const tx = this.#transaction(input, true, null);
    this.transactions.set(tx.transaction_id, tx);
    this.#change({ type: 'added', tx });
    return tx;
  }

  // The pending charge is removed and its posted version added, linked to it
  // (or not, as some banks do).
  postPending(pendingId: string, posted: Partial<FakeTransactionInput> & { readonly id: string; readonly date: string }, options: { link?: boolean } = {}): PlaidTransaction {
    const pending = this.#existing(pendingId);
    if (!pending.pending) throw new Error(`${pendingId} is not pending`);
    const tx = this.#transaction(
      {
        id: posted.id,
        account: pending.account_id,
        amount: posted.amount ?? Math.round(pending.amount * 100),
        date: posted.date,
        description: posted.description ?? pending.original_description ?? pending.name,
        authorizedDate: posted.authorizedDate ?? pending.date,
      },
      false,
      options.link === false ? null : pendingId,
    );
    this.transactions.delete(pendingId);
    this.#change({ type: 'removed', id: pendingId, account: pending.account_id });
    this.#post(tx);
    this.#change({ type: 'added', tx });
    return tx;
  }

  // A pending charge that changes to posted under the same id.
  postInPlace(pendingId: string, changes: { readonly date: string; readonly amount?: Cents }): PlaidTransaction {
    const pending = this.#existing(pendingId);
    const tx: PlaidTransaction = {
      ...pending,
      pending: false,
      date: changes.date,
      authorized_date: pending.date,
      amount: changes.amount === undefined ? pending.amount : dollars(changes.amount),
    };
    this.#post(tx);
    this.#change({ type: 'modified', tx });
    return tx;
  }

  // A pending charge that falls off without posting, such as a gas hold.
  dropPending(pendingId: string): void {
    const pending = this.#existing(pendingId);
    if (!pending.pending) throw new Error(`${pendingId} is not pending`);
    this.transactions.delete(pendingId);
    this.#change({ type: 'removed', id: pendingId, account: pending.account_id });
  }

  // Plaid changes a transaction. Money fields change the balance as a bank would.
  modify(id: string, patch: { readonly amount?: Cents; readonly description?: string; readonly date?: string }): PlaidTransaction {
    const old = this.#existing(id);
    if (!old.pending) this.#unpost(old);
    const tx: PlaidTransaction = {
      ...old,
      ...(patch.amount === undefined ? {} : { amount: dollars(patch.amount) }),
      ...(patch.description === undefined ? {} : { name: patch.description, original_description: patch.description }),
      ...(patch.date === undefined ? {} : { date: patch.date }),
    };
    if (tx.pending) this.transactions.set(id, tx);
    else this.#post(tx);
    this.#change({ type: 'modified', tx });
    return tx;
  }

  // Plaid takes a posted transaction back out. keepBalance: the bank's
  // balance never had it (a copy shown twice, say).
  removePosted(id: string, options: { keepBalance: boolean }): void {
    const old = this.#existing(id);
    if (old.pending) throw new Error(`${id} is pending; use dropPending`);
    if (!options.keepBalance) this.#unpost(old);
    this.transactions.delete(id);
    this.#change({ type: 'removed', id, account: old.account_id });
  }

  // The account's balance moves by this much with no transaction to show
  // for it (a mistake at the bank, or something the app cannot see), until
  // it is moved back: the totals no longer match the bank (10.4).
  drift(accountId: string, cents: Cents): void {
    const account = this.accounts.get(accountId);
    if (account === undefined) throw new Error(`no account ${accountId}`);
    account.posted += cents;
  }

  setStatement(accountId: string, statement: Omit<PlaidCreditCard, 'account_id'>): void {
    this.cards.set(accountId, { ...statement, account_id: accountId });
  }

  posted(accountId: string): Cents {
    const account = this.accounts.get(accountId);
    if (account === undefined) throw new Error(`no account ${accountId}`);
    return account.posted;
  }

  // ----- Plaid's answers -----

  readonly fetch: Fetch = async (url, init) => {
    const endpoint = url.replace('https://sandbox.plaid.com', '');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    this.calls.push({ endpoint, body });
    this.#requestCount += 1;
    const forced = this.beforeCall?.(endpoint, body, this.#requestCount);
    if (forced === 'network') throw new TypeError('fetch failed');
    const answer = forced ?? this.#answer(url, endpoint, init.headers, body);
    return { ok: answer.status === 200, status: answer.status, text: async () => JSON.stringify(answer.body) };
  };

  #answer(url: string, endpoint: string, headers: Record<string, string>, body: Record<string, unknown>): { status: number; body: unknown } {
    const requestId = `req-${this.#requestCount}`;
    const error = (status: number, type: string, code: string): { status: number; body: unknown } => ({
      status,
      body: { error_type: type, error_code: code, error_message: `made-up ${code}`, display_message: null, request_id: requestId },
    });
    if (!url.startsWith('https://sandbox.plaid.com/')) return error(400, 'INVALID_REQUEST', 'NOT_THE_TEST_BANK');
    if (headers['PLAID-CLIENT-ID'] !== this.clientId || headers['PLAID-SECRET'] !== this.secret) return error(400, 'INVALID_INPUT', 'INVALID_API_KEYS');
    if (endpoint === '/sandbox/public_token/create') return { status: 200, body: { public_token: this.publicToken, request_id: requestId } };
    // 1.1 and 1.3: a link key for Plaid Link; with the bank key, to log in
    // again on that connection (a key that is not this connection's is refused).
    if (endpoint === '/link/token/create') {
      if (body['access_token'] !== undefined && body['access_token'] !== this.accessToken) return error(400, 'INVALID_INPUT', 'INVALID_ACCESS_TOKEN');
      return { status: 200, body: { link_token: `link-sandbox-made-up-${this.#requestCount}`, expiration: '2026-10-13T01:00:00Z', request_id: requestId } };
    }
    if (endpoint === '/item/public_token/exchange') {
      if (body['public_token'] !== this.publicToken) return error(400, 'INVALID_INPUT', 'INVALID_PUBLIC_TOKEN');
      return { status: 200, body: { access_token: this.accessToken, item_id: this.itemId, request_id: requestId } };
    }
    if (body['access_token'] !== this.accessToken) return error(400, 'INVALID_INPUT', 'INVALID_ACCESS_TOKEN');
    if (this.needsLogin) return error(400, 'ITEM_ERROR', 'ITEM_LOGIN_REQUIRED');
    const item = { item_id: this.itemId, institution_id: 'ins_109508', error: null, products: ['transactions', 'liabilities'] };
    switch (endpoint) {
      case '/transactions/sync':
        return this.#sync(body, requestId, error);
      case '/accounts/get':
        return { status: 200, body: { accounts: this.#accountList(), item, request_id: requestId } };
      case '/liabilities/get':
        return {
          status: 200,
          body: { accounts: this.#accountList(), item, liabilities: { credit: [...this.cards.values()], mortgage: null, student: null }, request_id: requestId },
        };
      case '/item/get':
        return { status: 200, body: { item, request_id: requestId } };
      default:
        return error(400, 'INVALID_REQUEST', 'UNKNOWN_FIELDS');
    }
  }

  #sync(body: Record<string, unknown>, requestId: string, error: (s: number, t: string, c: string) => { status: number; body: unknown }): { status: number; body: unknown } {
    const cursor = typeof body['cursor'] === 'string' ? body['cursor'] : null;
    const count = typeof body['count'] === 'number' ? body['count'] : 100;
    const start = cursor === null ? 0 : Number(cursor.replace('cursor-', ''));
    if (!Number.isInteger(start) || start < 0 || start > this.changes.length) return error(400, 'INVALID_INPUT', 'INVALID_CURSOR');
    // A cursor handed out in the middle of paging is only good while nothing changes.
    const seen = cursor === null ? undefined : this.#midPage.get(cursor);
    if (seen !== undefined && seen !== this.changes.length) return error(400, 'TRANSACTIONS_ERROR', 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION');
    const page = this.changes.slice(start, start + count);
    const end = start + page.length;
    const hasMore = end < this.changes.length;
    const next = `cursor-${end}`;
    if (hasMore) this.#midPage.set(next, this.changes.length);
    return {
      status: 200,
      body: {
        accounts: this.#accountList(),
        added: page.flatMap((c) => (c.type === 'added' ? [c.tx] : [])),
        modified: page.flatMap((c) => (c.type === 'modified' ? [c.tx] : [])),
        removed: page.flatMap((c) => (c.type === 'removed' ? [{ account_id: c.account, transaction_id: c.id }] : [])),
        next_cursor: next,
        has_more: hasMore,
        request_id: requestId,
        transactions_update_status: this.historyComplete ? 'HISTORICAL_UPDATE_COMPLETE' : 'INITIAL_UPDATE_COMPLETE',
      },
    };
  }

  #accountList(): PlaidAccount[] {
    return [...this.accounts.values()].map(({ input, posted }) => {
      const pendingOut = [...this.transactions.values()].filter((t) => t.account_id === input.id && t.pending).reduce((sum, t) => sum + Math.round(t.amount * 100), 0);
      const credit = input.kind === 'credit card';
      const available = credit ? (input.limit === undefined ? null : input.limit - posted - pendingOut) : posted - pendingOut;
      return {
        account_id: input.id,
        balances: {
          available: available === null ? null : dollars(available),
          current: dollars(posted),
          iso_currency_code: 'USD',
          limit: input.limit === undefined ? null : dollars(input.limit),
          unofficial_currency_code: null,
        },
        mask: input.mask,
        name: input.name,
        official_name: null,
        subtype: input.kind,
        type: credit ? 'credit' : 'depository',
      };
    });
  }

  #transaction(input: FakeTransactionInput, pending: boolean, pendingId: string | null): PlaidTransaction {
    if (!this.accounts.has(input.account)) throw new Error(`no account ${input.account}`);
    return {
      account_id: input.account,
      amount: dollars(input.amount),
      iso_currency_code: input.currency ?? 'USD',
      unofficial_currency_code: null,
      date: input.date,
      authorized_date: input.authorizedDate ?? input.date,
      name: input.description,
      merchant_name: null,
      original_description: input.description,
      pending,
      pending_transaction_id: pendingId,
      personal_finance_category: null,
      transaction_id: input.id,
    };
  }

  // Posting moves the balance: money out lowers what a bank account holds and
  // raises what a card owes.
  #post(tx: PlaidTransaction): void {
    const account = this.accounts.get(tx.account_id);
    if (account === undefined) throw new Error(`no account ${tx.account_id}`);
    const cents = Math.round(tx.amount * 100);
    account.posted += account.input.kind === 'credit card' ? cents : -cents;
    this.transactions.set(tx.transaction_id, tx);
  }

  #unpost(tx: PlaidTransaction): void {
    const account = this.accounts.get(tx.account_id);
    if (account === undefined) throw new Error(`no account ${tx.account_id}`);
    const cents = Math.round(tx.amount * 100);
    account.posted -= account.input.kind === 'credit card' ? cents : -cents;
  }

  #existing(id: string): PlaidTransaction {
    const tx = this.transactions.get(id);
    if (tx === undefined) throw new Error(`no transaction ${id}`);
    return tx;
  }

  #change(change: Change): void {
    this.changes.push(change);
  }
}

// His four accounts, as the made-up test bank shows them.
export const ACCOUNT_IDS = { checking: 'acct-checking', savings: 'acct-savings', everyday: 'acct-everyday', old: 'acct-old' } as const;

export function fourAccounts(posted: { checking: Cents; savings: Cents; everyday: Cents; old: Cents }): FakeAccountInput[] {
  return [
    { id: ACCOUNT_IDS.checking, name: 'Made-up Checking', mask: '1111', kind: 'checking', posted: posted.checking },
    { id: ACCOUNT_IDS.savings, name: 'Made-up Savings', mask: '2222', kind: 'savings', posted: posted.savings },
    { id: ACCOUNT_IDS.everyday, name: 'Made-up Everyday Card', mask: '3333', kind: 'credit card', posted: posted.everyday, limit: 500_000 },
    { id: ACCOUNT_IDS.old, name: 'Made-up Old Card', mask: '4444', kind: 'credit card', posted: posted.old, limit: 400_000 },
  ];
}
