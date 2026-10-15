import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryLog } from '../src/log.js';
import { PlaidClient, type Fetch } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { serveBooks } from '../src/serve/serving.js';
import type { AlertTimer } from '../src/serve/alert-timer.js';
import type { SyncTimer } from '../src/serve/sync-timer.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { FakePhone } from './fake-phone.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { FakeWebhookSigner, webhookBody } from './fake-plaid-webhooks.js';
import type { WebhookDesk } from '../src/sync/webhook-desk.js';
import { WEBHOOK_PATH } from '../src/plaid/webhook.js';
import { readConnection } from '../src/db/store.js';
import { loginForTests } from './login-for-tests.js';

// serveBooks (serve/serving.ts): what npm run serve runs once the books are
// open, and what the full pay period through the screens runs too: the
// screens behind the login, and the timer that syncs with the bank by itself
// (Step 3). Here with a made-up bank and a clock that moves only when the
// test moves it. Every name and number is made up.

const HOUR = 3_600_000;
const E = ACCOUNT_IDS.everyday;

const running: { life: Life; server: Server; timer: SyncTimer; alerts: AlertTimer; webhooks: WebhookDesk }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    await r.timer.stop();
    await r.alerts.stop();
    await r.webhooks.stop();
    await new Promise<void>((resolve) => r.server.close(() => resolve()));
    r.life.done();
  }
});

// hold: while it gives a promise, the made-up bank's /transactions/sync waits for it.
async function served(hold?: () => Promise<void> | null): Promise<{ life: Life; clock: FakeClock; timer: SyncTimer; alerts: AlertTimer; webhooks: WebhookDesk; phone: FakePhone; base: string }> {
  const life = await lifeInAFile();
  const fetch: Fetch = async (url, init) => {
    if (url.endsWith('/transactions/sync')) await hold?.();
    return life.h.fake.fetch(url, init);
  };
  const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: life.h.fake.clientId, PLAID_SECRET: life.h.fake.secret }), { fetch, log: memoryLog([]) });
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  const clock = new FakeClock(life);
  let base = '';
  const phone = new FakePhone(() => life.now);
  const { server, timer, alerts, webhooks } = serveBooks({ keeper: life.keeper, bank: { plaid, box: life.h.box, log: memoryLog([]), pageSize: 3 }, clock, webRoot: 'C:/made-up/no-screens/', origin: () => base, sender: phone, now: () => life.now });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  base = `http://localhost:${typeof address === 'object' && address !== null ? address.port : 0}`;
  running.push({ life, server, timer, alerts, webhooks });
  return { life, clock, timer, alerts, webhooks, phone, base };
}

// A webhook signed by the made-up Plaid, whose key the made-up bank hands out.
async function postWebhook(base: string, life: Life, signer: FakeWebhookSigner, body: string): Promise<number> {
  const s = await signer.sign(body, life.now);
  const answer = await fetch(`${base}${WEBHOOK_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Plaid-Verification': s.header }, body: s.body });
  return answer.status;
}

describe('npm run serve, once the books are open (serveBooks)', () => {
  it("section 2 A47 it takes Plaid's webhooks, checked with the key the bank hands out: a sync starts at once after, not an hour later", async () => {
    const { life, clock, timer, webhooks, base } = await served();
    timer.start();
    await timer.idle();
    const first = life.keeper.lastRead();
    const signer = await FakeWebhookSigner.make();
    life.h.fake.webhookKeys.set(signer.kid, signer.key);
    life.h.fake.addPosted({ id: 'cafe-2', account: E, amount: 1_150, date: '2026-10-02', description: 'MADE UP CAFE' });
    expect(await postWebhook(base, life, signer, webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', {}, readConnection(life.h.db)?.itemId))).toBe(200);
    await clock.advance(5_000, async () => {
      await timer.idle();
      await webhooks.idle();
    });
    expect(life.keeper.lastRead()).toBe(new Date(Date.parse(first ?? '') + 5_000 - 3_000).toISOString());
    expect(life.keeper.book()?.purchases().some((p) => p.id === 'cafe-2')).toBe(true);
    expect(life.h.fake.calls.filter((c) => c.endpoint === '/webhook_verification_key/get').map((c) => c.body)).toEqual([{ key_id: signer.kid }]);
  });

  it("section 2 A47 a webhook that comes while the timer's sync is on its way waits for it and then syncs again", async () => {
    let release: () => void = () => undefined;
    let gate: Promise<void> | null = new Promise((done) => (release = done));
    let held = 0;
    const { life, clock, timer, webhooks, base } = await served(() => {
      if (gate !== null) held += 1;
      return gate;
    });
    const signer = await FakeWebhookSigner.make();
    life.h.fake.webhookKeys.set(signer.kid, signer.key);
    let reads = 0;
    life.h.fake.beforeCall = (endpoint) => {
      if (endpoint === '/item/get') reads += 1;
      return undefined;
    };
    timer.start();
    for (let i = 0; i < 200 && held === 0; i += 1) await new Promise((done) => setImmediate(done));
    expect(held).toBe(1);
    expect(await postWebhook(base, life, signer, webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', {}, readConnection(life.h.db)?.itemId))).toBe(200);
    // The webhook's moment comes while the timer's sync is held: it waits.
    await clock.advance(5_000, async () => undefined);
    expect(reads).toBe(0);
    gate = null;
    release();
    await timer.idle();
    await webhooks.idle();
    // The timer's read, then the webhook's own.
    expect(reads).toBe(2);
  });

  it('section 2 Step 3 its timer syncs at once when started, then only once each interval of the clock it is given; each sync reads the bank into the books', async () => {
    const { life, clock, timer } = await served();
    timer.start();
    await timer.idle();
    const first = life.keeper.lastRead();
    expect(first).toBe(life.now.toISOString());
    // Something new at the bank: not read until the hour is up.
    life.h.fake.addPosted({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-02', description: 'MADE UP CAFE' });
    await clock.advance(HOUR - 1, () => timer.idle());
    expect(life.keeper.lastRead()).toBe(first);
    expect(life.keeper.book()?.purchases().some((p) => p.id === 'cafe-1')).toBe(false);
    await clock.advance(1, () => timer.idle());
    expect(life.keeper.lastRead()).toBe(new Date(Date.parse(first ?? '') + HOUR).toISOString());
    expect(life.keeper.book()?.purchases().some((p) => p.id === 'cafe-1')).toBe(true);
  });

  it('Phase 5 10.6 its alert timer starts the alerts, and a sync that brings an alert sends it in the same moment', async () => {
    const { life, clock, timer, alerts, phone } = await served();
    alerts.start();
    await alerts.idle();
    expect(life.keeper.alertsView()).toMatchObject({ state: 'tracking', alerts: [], total: 0 });
    timer.start();
    await timer.idle();
    life.h.fake.addPosted({ id: 'copy-1', account: E, amount: 1_150, date: '2026-10-02', description: 'MADE UP CAFE' });
    await clock.advance(HOUR, async () => {
      await timer.idle();
      await alerts.idle();
    });
    life.h.fake.removePosted('copy-1', { keepBalance: false });
    const syncedAt = new Date(life.now.getTime() + HOUR).toISOString();
    await clock.advance(HOUR, async () => {
      await timer.idle();
      await alerts.idle();
    });
    expect(phone.shown.map((s) => [s.id, s.title, s.at])).toEqual([['bank-took-back copy-1', 'The bank took something back', syncedAt]]);
    expect(life.keeper.alertsView()).toMatchObject({ state: 'tracking', total: 1, alerts: [{ key: 'bank-took-back copy-1', sentAt: '2026-10-02T14:00:00-04:00', dueAt: '2026-10-02T14:00:00-04:00' }] });
  });

  it('Step 2 its server keeps every screen\'s numbers behind the login, and serves them to a login', async () => {
    const { life, base } = await served();
    expect((await fetch(`${base}/api/home`)).status).toBe(401);
    const cookie = loginForTests(life.h.db, life.now);
    const answer = await fetch(`${base}/api/home`, { headers: { cookie } });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ state: 'tracking' });
  });
});
