import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { memoryLog, type LogLine } from '../src/log.js';
import { BankKey, ENDPOINTS, PLAID_API_VERSION, PlaidClient, PlaidError, type Fetch } from '../src/plaid/client.js';
import { SandboxOnlyError, plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';

// Made-up keys and token.
const keys = plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'client-made-up-123', PLAID_SECRET: 'secret-made-up-456' });
const TOKEN = 'access-sandbox-11111111-2222-4333-8444-555555555555';

interface Sent {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function fakeFetch(reply: (sent: Sent) => { status: number; body: unknown } | Error): { fetch: Fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch: Fetch = async (url, init) => {
    const request = { url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> };
    sent.push(request);
    const answer = reply(request);
    if (answer instanceof Error) throw answer;
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, text: async () => JSON.stringify(answer.body) };
  };
  return { fetch, sent };
}

const okSync = { added: [], modified: [], removed: [], next_cursor: 'cursor-1', has_more: false, request_id: 'req-1' };

describe('0.4 the app is read-only: the bank connection cannot move money', () => {
  it('0.4 the only Plaid endpoints the app can call read the bank or set up the test bank', () => {
    expect(Object.values(ENDPOINTS).sort()).toEqual(
      [
        '/accounts/get',
        '/item/get',
        '/item/webhook/update',
        '/item/public_token/exchange',
        '/liabilities/get',
        '/link/token/create',
        '/sandbox/item/reset_login',
        '/sandbox/public_token/create',
        '/sandbox/transactions/create',
        '/transactions/refresh',
        '/transactions/sync',
        '/webhook_verification_key/get',
      ].sort(),
    );
    for (const endpoint of Object.values(ENDPOINTS)) {
      expect(endpoint).not.toMatch(/transfer|payment|bank_transfer|processor|deposit_switch|signal|wallet/);
    }
  });
});

describe('safety: requests to Plaid', () => {
  it('safety: every request goes to the test bank, with the keys in headers and the API version pinned', async () => {
    const { fetch, sent } = fakeFetch(() => ({ status: 200, body: okSync }));
    const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
    await client.syncTransactions(new BankKey(TOKEN), null, 100);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://sandbox.plaid.com/transactions/sync');
    expect(sent[0]?.headers['PLAID-CLIENT-ID']).toBe('client-made-up-123');
    expect(sent[0]?.headers['PLAID-SECRET']).toBe('secret-made-up-456');
    expect(sent[0]?.headers['Plaid-Version']).toBe(PLAID_API_VERSION);
    expect(sent[0]?.body).toEqual({ access_token: TOKEN, count: 100, options: { include_original_description: true } });
    expect(JSON.stringify(sent[0]?.body)).not.toContain('secret-made-up-456');
  });

  it('safety: a cursor is sent only when there is one', async () => {
    const { fetch, sent } = fakeFetch(() => ({ status: 200, body: okSync }));
    const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
    await client.syncTransactions(new BankKey(TOKEN), 'cursor-0', 250);
    expect(sent[0]?.body['cursor']).toBe('cursor-0');
  });

  it('safety: a key that is not a test-bank key is refused before anything is sent', async () => {
    const { fetch, sent } = fakeFetch(() => ({ status: 200, body: okSync }));
    const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
    // A real bank's key is a bank key (Phase 7), but the test bank's client never sends it.
    await expect(client.syncTransactions(new BankKey(['access', 'production', '0f1e2d3c'].join('-')), null, 100)).rejects.toThrow(SandboxOnlyError);
    expect(() => new BankKey(['access', 'development', '0f1e2d3c'].join('-'))).toThrow(SandboxOnlyError);
    expect(sent).toEqual([]);
  });

  it('1.1 A44 the link key asks for the bank\'s own login, for transactions and card statements, 90 days of history, in English, for one person', async () => {
    const { fetch, sent } = fakeFetch(() => ({ status: 200, body: { link_token: 'link-sandbox-made-up', expiration: '2026-10-13T01:00:00Z', request_id: 'req-1' } }));
    const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
    expect(await client.createLinkToken({ clientUserId: 'budget-app-made-up' })).toBe('link-sandbox-made-up');
    expect(sent[0]?.url).toBe('https://sandbox.plaid.com/link/token/create');
    expect(sent[0]?.body).toEqual({
      client_name: 'Budget App',
      language: 'en',
      country_codes: ['US'],
      user: { client_user_id: 'budget-app-made-up' },
      products: ['transactions', 'liabilities'],
      transactions: { days_requested: 90 },
    });
  });

  it('1.3 logging in again asks with the connection\'s own key and lets him add a missing account; it asks for no new connection and no products', async () => {
    const { fetch, sent } = fakeFetch(() => ({ status: 200, body: { link_token: 'link-sandbox-made-up', expiration: '2026-10-13T01:00:00Z', request_id: 'req-1' } }));
    const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
    await client.createLinkToken({ clientUserId: 'budget-app-made-up', updateKey: new BankKey(TOKEN) });
    expect(sent[0]?.body).toEqual({
      client_name: 'Budget App',
      language: 'en',
      country_codes: ['US'],
      user: { client_user_id: 'budget-app-made-up' },
      access_token: TOKEN,
      update: { account_selection_enabled: true },
    });
    expect(sent[0]?.body).not.toHaveProperty('products');
  });

  it('1.1 a link key that does not look like one is refused', async () => {
    for (const body of [{}, { link_token: '' }, { link_token: 42 }]) {
      const { fetch } = fakeFetch(() => ({ status: 200, body }));
      const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
      await expect(client.createLinkToken({ clientUserId: 'budget-app-made-up' }), JSON.stringify(body)).rejects.toThrow(/link key/);
    }
  });

  it('safety: the bank key never shows when printed', () => {
    const key = new BankKey(TOKEN);
    for (const shown of [String(key), JSON.stringify(key), JSON.stringify({ key }), inspect(key, { showHidden: true })]) {
      expect(shown).not.toContain('11111111');
    }
  });

  it('safety: nothing secret is logged, whether a request works or fails', async () => {
    const lines: LogLine[] = [];
    const log = memoryLog(lines, [keys.clientId, keys.secret]);
    let call = 0;
    const { fetch } = fakeFetch(() => {
      call += 1;
      if (call === 1) return { status: 200, body: okSync };
      if (call === 2) return { status: 400, body: { error_type: 'INVALID_INPUT', error_code: 'INVALID_ACCESS_TOKEN', error_message: 'bad token', request_id: 'req-2' } };
      return new Error(`socket hang up while sending ${TOKEN} with secret-made-up-456`);
    });
    const client = new PlaidClient(keys, { fetch, log });
    const key = new BankKey(TOKEN);
    await client.syncTransactions(key, null, 100);
    const errors: unknown[] = [];
    for (let i = 0; i < 2; i += 1) {
      try {
        await client.getAccounts(key);
      } catch (error) {
        errors.push(error);
      }
    }
    expect(errors).toHaveLength(2);
    const shown = JSON.stringify(lines) + errors.map((e) => `${String(e)} ${JSON.stringify(e)} ${inspect(e)} ${(e as Error).stack ?? ''}`).join(' ');
    expect(shown).not.toContain('11111111');
    expect(shown).not.toContain('secret-made-up-456');
    expect(shown).not.toContain('client-made-up-123');
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Plaid errors', () => {
  it('a Plaid error says which endpoint, and Plaid\'s own type, code and request id', async () => {
    const { fetch } = fakeFetch(() => ({
      status: 400,
      body: {
        error_type: 'TRANSACTIONS_ERROR',
        error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
        error_message: 'Underlying transaction data changed since last page was fetched.',
        display_message: null,
        request_id: 'req-9',
      },
    }));
    const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
    const error = await client.syncTransactions(new BankKey(TOKEN), 'c', 100).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PlaidError);
    const plaid = error as PlaidError;
    expect(plaid.endpoint).toBe('/transactions/sync');
    expect(plaid.status).toBe(400);
    expect(plaid.errorType).toBe('TRANSACTIONS_ERROR');
    expect(plaid.errorCode).toBe('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION');
    expect(plaid.requestId).toBe('req-9');
  });

  it('Plaid out of reach, or answering with something that is not JSON, is a Plaid error too', async () => {
    const down = new PlaidClient(keys, { fetch: fakeFetch(() => new Error('connect ECONNREFUSED')).fetch, log: memoryLog([]) });
    await expect(down.getItem(new BankKey(TOKEN))).rejects.toMatchObject({ errorCode: 'NETWORK_ERROR', status: null });
    const garbled: Fetch = async () => ({ ok: true, status: 200, text: async () => '<html>' });
    const odd = new PlaidClient(keys, { fetch: garbled, log: memoryLog([]) });
    await expect(odd.getItem(new BankKey(TOKEN))).rejects.toMatchObject({ errorCode: 'NOT_JSON', status: 200 });
  });
});
