import { hideSecrets, type Log } from '../log.js';
import { PLAID_SANDBOX_URL, SandboxOnlyError, assertSandboxAccessToken, assertSandboxPublicToken, type PlaidKeys } from './sandbox-lock.js';
import type {
  AccountsGetResponse,
  ItemGetResponse,
  LiabilitiesGetResponse,
  PlaidErrorBody,
  SandboxTransaction,
  TransactionsSyncResponse,
} from './types.js';

// A small Plaid client: only the calls the app needs, all to the test bank.
// Rule 0.4: the app is read-only toward the bank, so the list below has no
// call that can move money. The access token is sent in the request body,
// which is never logged; the API keys go in headers.

// Pinned, so Plaid's answers do not change shape under the app.
export const PLAID_API_VERSION = '2020-09-14';

export const ENDPOINTS = {
  // Reading the bank.
  transactionsSync: '/transactions/sync',
  accountsGet: '/accounts/get',
  liabilitiesGet: '/liabilities/get',
  itemGet: '/item/get',
  // Asks Plaid to look at the bank again now.
  transactionsRefresh: '/transactions/refresh',
  // Turning a new connection's link key into its bank key.
  publicTokenExchange: '/item/public_token/exchange',
  // The test bank only: make a connection without screens, add test
  // transactions, and pretend the bank wants a new login.
  sandboxPublicTokenCreate: '/sandbox/public_token/create',
  sandboxTransactionsCreate: '/sandbox/transactions/create',
  sandboxItemResetLogin: '/sandbox/item/reset_login',
} as const;

type Endpoint = (typeof ENDPOINTS)[keyof typeof ENDPOINTS];

export interface FetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type Fetch = (
  url: string,
  init: { readonly method: 'POST'; readonly headers: Record<string, string>; readonly body: string; readonly signal?: AbortSignal },
) => Promise<FetchResponse>;

// The access token of a connection. It shows as [bank key] wherever it is
// printed, and only a test-bank key is accepted.
export class BankKey {
  readonly #token: string;

  constructor(token: string) {
    assertSandboxAccessToken(token);
    this.#token = token;
  }

  reveal(): string {
    return this.#token;
  }

  toJSON(): string {
    return '[bank key]';
  }

  toString(): string {
    return '[bank key]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[bank key]';
  }
}

export class PlaidError extends Error {
  override readonly name = 'PlaidError';
  readonly endpoint: Endpoint;
  // The HTTP status, or null when Plaid could not be reached.
  readonly status: number | null;
  readonly errorType: string;
  readonly errorCode: string;
  readonly requestId: string | null;

  constructor(endpoint: Endpoint, status: number | null, body: PlaidErrorBody, message: string) {
    super(message);
    this.endpoint = endpoint;
    this.status = status;
    this.errorType = body.error_type;
    this.errorCode = body.error_code;
    this.requestId = body.request_id ?? null;
  }
}

export interface PlaidClientOptions {
  readonly fetch?: Fetch;
  readonly log: Log;
  readonly timeoutMs?: number;
}

export class PlaidClient {
  readonly #keys: PlaidKeys;
  readonly #fetch: Fetch;
  readonly #log: Log;
  readonly #timeoutMs: number;

  constructor(keys: PlaidKeys, options: PlaidClientOptions) {
    this.#keys = keys;
    this.#fetch = options.fetch ?? (globalThis.fetch as unknown as Fetch);
    this.#log = options.log;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  toJSON(): string {
    return '[PlaidClient]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[PlaidClient]';
  }

  // Changes since the cursor; the whole history when there is none.
  syncTransactions(key: BankKey, cursor: string | null, count: number): Promise<TransactionsSyncResponse> {
    return this.#post(ENDPOINTS.transactionsSync, {
      access_token: key.reveal(),
      ...(cursor === null ? {} : { cursor }),
      count,
      options: { include_original_description: true },
    });
  }

  getAccounts(key: BankKey): Promise<AccountsGetResponse> {
    return this.#post(ENDPOINTS.accountsGet, { access_token: key.reveal() });
  }

  getLiabilities(key: BankKey): Promise<LiabilitiesGetResponse> {
    return this.#post(ENDPOINTS.liabilitiesGet, { access_token: key.reveal() });
  }

  getItem(key: BankKey): Promise<ItemGetResponse> {
    return this.#post(ENDPOINTS.itemGet, { access_token: key.reveal() });
  }

  async refreshTransactions(key: BankKey): Promise<void> {
    await this.#post(ENDPOINTS.transactionsRefresh, { access_token: key.reveal() });
  }

  async exchangePublicToken(publicToken: string): Promise<{ readonly key: BankKey; readonly itemId: string }> {
    assertSandboxPublicToken(publicToken);
    const reply = await this.#post<{ access_token: string; item_id: string }>(ENDPOINTS.publicTokenExchange, { public_token: publicToken });
    return { key: new BankKey(reply.access_token), itemId: reply.item_id };
  }

  // The test bank's way to connect without screens. With the username
  // user_custom, the password is a description of the accounts to make.
  async createSandboxPublicToken(input: {
    readonly institutionId: string;
    readonly products: readonly string[];
    readonly username?: string;
    readonly password?: string;
    readonly daysRequested?: number;
  }): Promise<string> {
    const options: Record<string, unknown> = {};
    if (input.username !== undefined) options['override_username'] = input.username;
    if (input.password !== undefined) options['override_password'] = input.password;
    if (input.daysRequested !== undefined) options['transactions'] = { days_requested: input.daysRequested };
    const reply = await this.#post<{ public_token: string }>(ENDPOINTS.sandboxPublicTokenCreate, {
      institution_id: input.institutionId,
      initial_products: input.products,
      options,
    });
    assertSandboxPublicToken(reply.public_token);
    return reply.public_token;
  }

  async createSandboxTransactions(key: BankKey, transactions: readonly SandboxTransaction[]): Promise<void> {
    await this.#post(ENDPOINTS.sandboxTransactionsCreate, { access_token: key.reveal(), transactions });
  }

  async resetSandboxLogin(key: BankKey): Promise<void> {
    await this.#post(ENDPOINTS.sandboxItemResetLogin, { access_token: key.reveal() });
  }

  async #post<T>(endpoint: Endpoint, body: Record<string, unknown>): Promise<T> {
    const url = `${PLAID_SANDBOX_URL}${endpoint}`;
    if (!url.startsWith(`${PLAID_SANDBOX_URL}/`)) throw new SandboxOnlyError('every request goes to the test bank');
    const secrets = [this.#keys.clientId, this.#keys.secret];
    let response: FetchResponse;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PLAID-CLIENT-ID': this.#keys.clientId,
          'PLAID-SECRET': this.#keys.secret,
          'Plaid-Version': PLAID_API_VERSION,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      // What went wrong is kept to its kind. The error from the network layer
      // is not passed on, in case it carries any of what was sent.
      const kind = error instanceof Error ? hideSecrets(error.name, secrets) : 'unknown';
      this.#log.warn('plaid unreachable', { endpoint, kind });
      throw new PlaidError(endpoint, null, { error_type: 'NETWORK', error_code: 'NETWORK_ERROR' }, `Plaid ${endpoint} could not be reached (${kind})`);
    }
    const text = await response.text();
    let reply: unknown;
    try {
      reply = JSON.parse(text);
    } catch {
      this.#log.warn('plaid answer not JSON', { endpoint, status: response.status });
      throw new PlaidError(endpoint, response.status, { error_type: 'API_ERROR', error_code: 'NOT_JSON' }, `Plaid ${endpoint} answered with something that is not JSON`);
    }
    if (!response.ok) {
      const error = plaidErrorBody(reply);
      this.#log.warn('plaid error', { endpoint, status: response.status, errorCode: error.error_code, requestId: error.request_id ?? null });
      const said = error.error_message === undefined ? '' : `: ${hideSecrets(error.error_message, secrets)}`;
      throw new PlaidError(endpoint, response.status, error, `Plaid ${endpoint} failed with ${error.error_code} (${error.error_type})${said}`);
    }
    const requestId = typeof reply === 'object' && reply !== null && 'request_id' in reply ? String(reply.request_id) : null;
    this.#log.info('plaid', { endpoint, status: response.status, requestId });
    return reply as T;
  }
}

function plaidErrorBody(reply: unknown): PlaidErrorBody {
  const r = (typeof reply === 'object' && reply !== null ? reply : {}) as Record<string, unknown>;
  const text = (value: unknown, fallback: string): string => (typeof value === 'string' && value !== '' ? value : fallback);
  return {
    error_type: text(r['error_type'], 'API_ERROR'),
    error_code: text(r['error_code'], 'UNKNOWN'),
    ...(typeof r['error_message'] === 'string' ? { error_message: r['error_message'] } : {}),
    ...(typeof r['request_id'] === 'string' ? { request_id: r['request_id'] } : {}),
  };
}
