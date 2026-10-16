import { describe, expect, it } from 'vitest';
import { pointWebhooks } from '../src/bank-webhook.js';
import { openDatabase } from '../src/db/database.js';
import { readConnection } from '../src/db/store.js';
import { Keeper, type SyncBank } from '../src/history/keeper.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { BankKey, ENDPOINTS, PlaidClient, type Fetch } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { WEBHOOK_PATH, plaidKeySource } from '../src/plaid/webhook.js';
import { FakePlaid, fourAccounts } from './fake-plaid.js';
import { FakeWebhookSigner } from './fake-plaid-webhooks.js';
import { POSTED_AT_START, connected } from './harness.js';
import { noonInNewYork } from './keeper-harness.js';
import { TokenBox } from '../src/crypto/token-box.js';
import { TOKEN_KEY } from './harness.js';

// Section 2 (QUESTIONS.md A47): where Plaid sends his connection's webhooks.
// A new connection's link key carries the hosted server's own address; his
// existing connection is pointed at it with one /item/webhook/update call,
// run on the machine at his word after the deploy: the same connection,
// nothing new made and nothing read. And the two calls the client makes for
// webhooks: configuration, never money. Every name and number is made up.

const HOSTED = 'https://made-up-budget.fly.dev';
const keys = plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'client-made-up-123', PLAID_SECRET: 'secret-made-up-456' });
const TOKEN = 'access-sandbox-11111111-2222-4333-8444-555555555555';

function replying(reply: (body: Record<string, unknown>) => { status: number; body: unknown }): { fetch: Fetch; sent: { url: string; body: Record<string, unknown> }[] } {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: Fetch = async (url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    sent.push({ url, body });
    const answer = reply(body);
    return { ok: answer.status === 200, status: answer.status, text: async () => JSON.stringify(answer.body) };
  };
  return { fetch, sent };
}

describe('section 2 A47 the client\'s two calls for webhooks', () => {
  it('section 2 A47 0.4 the key a webhook is checked with is asked for by its id alone: no bank key is sent', async () => {
    const signer = await FakeWebhookSigner.make('made-up-kid');
    const { fetch, sent } = replying(() => ({ status: 200, body: { key: signer.key, request_id: 'req-1' } }));
    const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
    expect((await client.getWebhookVerificationKey('made-up-kid')).key).toEqual(signer.key);
    expect(sent).toEqual([{ url: `https://sandbox.plaid.com${ENDPOINTS.webhookVerificationKeyGet}`, body: { key_id: 'made-up-kid' } }]);
  });

  it('section 2 A47 0.4 the webhook address is set on the connection with its own key, and Plaid says which connection', async () => {
    const { fetch, sent } = replying(() => ({ status: 200, body: { item: { item_id: 'item-made-up-1', webhook: `${HOSTED}${WEBHOOK_PATH}` }, request_id: 'req-1' } }));
    const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
    expect(await client.updateWebhook(new BankKey(TOKEN), `${HOSTED}${WEBHOOK_PATH}`)).toEqual({ itemId: 'item-made-up-1' });
    expect(sent).toEqual([{ url: `https://sandbox.plaid.com${ENDPOINTS.itemWebhookUpdate}`, body: { access_token: TOKEN, webhook: `${HOSTED}${WEBHOOK_PATH}` } }]);
  });

  it('section 2 A47 1.1 a new connection\'s link key carries the webhook address; logging in again (1.3) does not (the connection keeps its own)', async () => {
    const { fetch, sent } = replying(() => ({ status: 200, body: { link_token: 'link-sandbox-made-up', request_id: 'req-1' } }));
    const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
    await client.createLinkToken({ clientUserId: 'budget-app-made-up', webhook: `${HOSTED}${WEBHOOK_PATH}` });
    await client.createLinkToken({ clientUserId: 'budget-app-made-up', webhook: null });
    await client.createLinkToken({ clientUserId: 'budget-app-made-up', updateKey: new BankKey(TOKEN) });
    expect(sent.map((s) => s.body['webhook'])).toEqual([`${HOSTED}${WEBHOOK_PATH}`, undefined, undefined]);
  });

  it('section 2 A47 the key source: Plaid\'s key by its id; Plaid\'s "no such key" is not found; out of reach, or slower than 5 seconds, is a key not had', async () => {
    const fake = new FakePlaid(fourAccounts(POSTED_AT_START));
    const signer = await FakeWebhookSigner.make('made-up-kid');
    fake.webhookKeys.set('made-up-kid', signer.key);
    const client = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log: memoryLog([]) });
    const source = plaidKeySource(client);
    expect(await source.fetch('made-up-kid')).toEqual({ found: true, key: signer.key });
    expect(await source.fetch('made-up-nobody')).toEqual({ found: false });
    fake.beforeCall = () => 'network';
    await expect(source.fetch('made-up-kid')).rejects.toThrow();
    const slow = plaidKeySource(new PlaidClient(keys, { fetch: () => new Promise(() => undefined), log: memoryLog([]) }), 20);
    await expect(slow.fetch('made-up-kid')).rejects.toThrow(/too long/);
  });
});

describe('section 2 A47 1.1 a new connection gets the webhook address', () => {
  function desk(origin: string) {
    const db = openDatabase(':memory:');
    const fake = new FakePlaid(fourAccounts(POSTED_AT_START));
    const log = memoryLog([], [fake.clientId, fake.secret]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    const keeper = Keeper.open({ db, now: () => noonInNewYork('2026-10-01'), log, origin: () => origin });
    const bank: SyncBank = { plaid, box: new TokenBox(TOKEN_KEY), log, pageSize: 3 };
    return { fake, keeper, desk: keeper.bankDesk(bank) };
  }

  it('section 2 A47 hosted (https): the link key for connecting carries the address; on this computer (http), none', async () => {
    const hosted = desk(HOSTED);
    expect(hosted.keeper.webhookAddress()).toBe(`${HOSTED}/plaid/webhook`);
    expect(await hosted.desk.link({ mode: 'connect', yes: true })).toMatchObject({ ok: true });
    expect(hosted.fake.calls[0]?.body['webhook']).toBe(`${HOSTED}/plaid/webhook`);
    const local = desk('http://localhost:5190');
    expect(local.keeper.webhookAddress()).toBeNull();
    await local.desk.link({ mode: 'connect', yes: true });
    expect(local.fake.calls[0]?.body).not.toHaveProperty('webhook');
  });
});

describe('section 2 A47 his existing connection pointed at the address, once, at his word', () => {
  it('section 2 A47 1.1 one /item/webhook/update call on the same connection: no new connection, no link key, nothing read', async () => {
    const h = await connected();
    const before = h.fake.calls.length;
    const lines: LogLine[] = [];
    const answer = await pointWebhooks({ db: h.db, plaid: h.plaid, box: h.box, address: `${HOSTED}${WEBHOOK_PATH}`, log: memoryLog(lines) });
    expect(answer).toEqual({ ok: true, address: `${HOSTED}/plaid/webhook`, itemId: readConnection(h.db)?.itemId });
    const calls = h.fake.calls.slice(before);
    expect(calls.map((c) => c.endpoint)).toEqual(['/item/webhook/update']);
    expect(calls[0]?.body['webhook']).toBe(`${HOSTED}/plaid/webhook`);
    expect(h.fake.webhook).toBe(`${HOSTED}/plaid/webhook`);
    // The bank key never shows in what it says or logs.
    expect(JSON.stringify([answer, lines])).not.toContain(h.fake.accessToken);
  });

  it('section 2 A47 refused, with nothing asked of Plaid: no https address (this computer), another path, or no connection', async () => {
    const h = await connected();
    const before = h.fake.calls.length;
    for (const address of [null, 'http://localhost:5190/plaid/webhook', `${HOSTED}/somewhere-else`, 'https://made-up-budget.fly.dev']) {
      expect(await pointWebhooks({ db: h.db, plaid: h.plaid, box: h.box, address, log: memoryLog([]) }), String(address)).toMatchObject({ ok: false });
    }
    expect(h.fake.calls.length).toBe(before);
    const empty = openDatabase(':memory:');
    expect(await pointWebhooks({ db: empty, plaid: h.plaid, box: h.box, address: `${HOSTED}${WEBHOOK_PATH}`, log: memoryLog([]) })).toMatchObject({ ok: false, why: expect.stringMatching(/no bank connection/) });
  });

  it('section 2 A47 Plaid refusing it is said, and nothing changes', async () => {
    const h = await connected();
    h.fake.beforeCall = (endpoint) => (endpoint === '/item/webhook/update' ? { status: 400, body: { error_type: 'INVALID_INPUT', error_code: 'INVALID_WEBHOOK', error_message: 'made up' } } : undefined);
    const answer = await pointWebhooks({ db: h.db, plaid: h.plaid, box: h.box, address: `${HOSTED}${WEBHOOK_PATH}`, log: memoryLog([]) });
    expect(answer).toMatchObject({ ok: false, why: expect.stringMatching(/INVALID_WEBHOOK/) });
    expect(h.fake.webhook).toBeNull();
    // Plaid answering about another connection is not taken as done.
    h.fake.beforeCall = (endpoint) => (endpoint === '/item/webhook/update' ? { status: 200, body: { item: { item_id: 'item-made-up-other' }, request_id: 'req-9' } } : undefined);
    expect(await pointWebhooks({ db: h.db, plaid: h.plaid, box: h.box, address: `${HOSTED}${WEBHOOK_PATH}`, log: memoryLog([]) })).toMatchObject({ ok: false, why: expect.stringMatching(/another connection/) });
  });
});
