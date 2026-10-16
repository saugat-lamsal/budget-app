import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT, generateKeyPair } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { readConnection } from '../src/db/store.js';
import { ROUTES } from '../src/http/server.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { PlaidClient, type Fetch } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { WEBHOOK_BODY_LIMIT, WEBHOOK_PATH, WebhookKeys, verifyWebhook, type WebhookKey } from '../src/plaid/webhook.js';
import { SyncTimer } from '../src/serve/sync-timer.js';
import { WebhookDesk, webhookAction } from '../src/sync/webhook-desk.js';
import { FakeClock } from './fake-clock.js';
import { FakeKeySource, FakeWebhookSigner, MADE_UP_ITEM, webhookBody, type Signed } from './fake-plaid-webhooks.js';
import { everything, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Section 2 (QUESTIONS.md A47, his call Oct 14): the app syncs with the bank
// as soon as Plaid says it has something new (a webhook), and the 60-minute
// timer stays. Every call to the webhook address is checked before anything
// is done: Plaid's signature (an ES256 JWT in the Plaid-Verification header,
// read whatever its case, with the key Plaid gives for its kid), made no more
// than 5 minutes ago, over the exact bytes of the body, and about his own
// connection. It is answered at once and the work done after; a webhook is
// only a trigger: what it says is never taken as money. Every name, key and
// number is made up.

const NOW = new Date('2026-10-15T16:00:00Z');
const at = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

async function signerAndKeys(now: () => Date = () => NOW, lines: LogLine[] = []): Promise<{ signer: FakeWebhookSigner; source: FakeKeySource; keys: WebhookKeys }> {
  const signer = await FakeWebhookSigner.make();
  const source = new FakeKeySource().add(signer);
  return { signer, source, keys: new WebhookKeys({ source, now, log: memoryLog(lines) }) };
}

const headersOf = (s: Signed, name = 'plaid-verification'): Record<string, string> => ({ [name]: s.header, 'content-type': 'application/json' });

describe('section 2 A47 a webhook is Plaid\'s, checked before anything is done', () => {
  it('section 2 A47 a call Plaid signed verifies, the header read whatever its case (Node gives it in lower case; anything else is looked for too)', async () => {
    const { signer, keys } = await signerAndKeys();
    const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), NOW);
    for (const name of ['plaid-verification', 'Plaid-Verification', 'PLAID-VERIFICATION']) {
      const v = await verifyWebhook({ headers: headersOf(s, name), body: s.body, now: NOW, keys });
      expect(v, name).toMatchObject({ ok: true, webhook: { type: 'TRANSACTIONS', code: 'SYNC_UPDATES_AVAILABLE', itemId: MADE_UP_ITEM, errorCode: null } });
    }
  });

  it('section 2 A47 no header, an empty one, two of them, or one that is not a JWT: refused', async () => {
    const { signer, keys } = await signerAndKeys();
    const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), NOW);
    for (const headers of [{}, { 'plaid-verification': '' }, { 'plaid-verification': [s.header, s.header] }, { 'plaid-verification': 'not.a.jwt' }, { 'plaid-verification': 'nothing' }]) {
      expect(await verifyWebhook({ headers, body: s.body, now: NOW, keys }), JSON.stringify(Object.keys(headers))).toMatchObject({ ok: false, status: 401 });
    }
  });

  it('section 2 A47 the alg must be exactly ES256: HS256 signed with the public key as a secret, "none", ES384 and es256 are refused, without asking Plaid for a key', async () => {
    const { signer, source, keys } = await signerAndKeys();
    const body = Buffer.from(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'));
    const hash = createHash('sha256').update(body).digest('hex');
    const iat = Math.floor(NOW.getTime() / 1000);
    const hs = await new SignJWT({ request_body_sha256: hash }).setProtectedHeader({ alg: 'HS256', kid: signer.kid }).setIssuedAt(iat).sign(new TextEncoder().encode(JSON.stringify(signer.key)));
    const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', kid: signer.kid })}.${b64({ iat, request_body_sha256: hash })}.`;
    const es384Pair = await generateKeyPair('ES384');
    const es384 = await new SignJWT({ request_body_sha256: hash }).setProtectedHeader({ alg: 'ES384', kid: signer.kid }).setIssuedAt(iat).sign(es384Pair.privateKey);
    const good = await signer.sign(body, NOW);
    const lower = `${b64({ alg: 'es256', kid: signer.kid, typ: 'JWT' })}.${good.header.split('.')[1]}.${good.header.split('.')[2]}`;
    for (const header of [hs, none, es384, lower]) {
      expect(await verifyWebhook({ headers: { 'plaid-verification': header }, body, now: NOW, keys })).toMatchObject({ ok: false, status: 401 });
    }
    expect(source.asked).toEqual([]);
  });

  it('section 2 A47 forged: signed with a key that is not Plaid\'s, under Plaid\'s kid, is refused', async () => {
    const { signer, keys } = await signerAndKeys();
    const forger = await FakeWebhookSigner.make(signer.kid);
    const s = await forger.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), NOW);
    expect(await verifyWebhook({ headers: headersOf(s), body: s.body, now: NOW, keys })).toMatchObject({ ok: false, status: 401, why: expect.stringMatching(/signature/) });
  });

  it('section 2 A47 tampered: one byte of the body changed, or the same JSON written another way, is refused (the hash is of the exact bytes, never the JSON written again)', async () => {
    const { signer, keys } = await signerAndKeys();
    const text = webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE');
    const s = await signer.sign(text, NOW);
    const changed = Buffer.from(text.replace('SYNC_UPDATES_AVAILABLE', 'SYNC_UPDATES_AVAILABLF'));
    const rewritten = Buffer.from(JSON.stringify(JSON.parse(text)));
    for (const body of [changed, rewritten, Buffer.concat([s.body, Buffer.from(' ')]), Buffer.alloc(0)]) {
      expect(await verifyWebhook({ headers: headersOf(s), body, now: NOW, keys })).toMatchObject({ ok: false, status: 401, why: expect.stringMatching(/body/) });
    }
    // Its own spacing, exactly as sent, verifies.
    expect(text).toContain('\n  "webhook_type"');
    expect(await verifyWebhook({ headers: headersOf(s), body: s.body, now: NOW, keys })).toMatchObject({ ok: true });
  });

  it('section 2 A47 the body\'s hash missing, not a SHA-256, or in capitals is refused', async () => {
    const { signer, keys } = await signerAndKeys();
    const body = webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE');
    const hash = createHash('sha256').update(body).digest('hex');
    for (const value of [undefined, 'abc', 12, hash.toUpperCase(), `${hash}00`]) {
      const s = await signer.sign(body, NOW, { claims: { request_body_sha256: value } });
      expect(await verifyWebhook({ headers: headersOf(s), body: s.body, now: NOW, keys }), String(value)).toMatchObject({ ok: false, status: 401 });
    }
  });

  it('section 2 A47 made more than 5 minutes ago, or more than a minute ahead of this clock, or with no time: refused; exactly 5 minutes old is taken', async () => {
    const { signer, keys } = await signerAndKeys();
    const body = webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE');
    const sec = Math.floor(NOW.getTime() / 1000);
    const verdict = async (iat: number): Promise<boolean> => {
      const s = await signer.sign(body, NOW, { iat });
      return (await verifyWebhook({ headers: headersOf(s), body: s.body, now: NOW, keys })).ok;
    };
    expect([await verdict(sec - 300), await verdict(sec - 301), await verdict(sec - 86_400), await verdict(sec + 60), await verdict(sec + 61)]).toEqual([true, false, false, true, false]);
    for (const iat of [null, 'now']) {
      const s = await signer.sign(body, NOW, { iat });
      expect((await verifyWebhook({ headers: headersOf(s), body: s.body, now: NOW, keys })).ok, String(iat)).toBe(false);
    }
  });

  it('section 2 A47 replayed later: a call Plaid signed, sent again 6 minutes on, is refused', async () => {
    const { signer, keys } = await signerAndKeys();
    const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), NOW);
    expect((await verifyWebhook({ headers: headersOf(s), body: s.body, now: NOW, keys })).ok).toBe(true);
    expect(await verifyWebhook({ headers: headersOf(s), body: s.body, now: at(360), keys })).toMatchObject({ ok: false, status: 401, why: expect.stringMatching(/old/) });
  });
});

describe('section 2 A47 Plaid\'s keys, by kid', () => {
  it('section 2 A47 a key is asked for once and kept by its kid; an unknown kid is asked for again', async () => {
    const { signer, source, keys } = await signerAndKeys();
    const second = await FakeWebhookSigner.make('made-up-key-2');
    source.add(second);
    for (const s of [signer, signer, second, signer, second]) {
      const signed = await s.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), NOW);
      expect((await verifyWebhook({ headers: headersOf(signed), body: signed.body, now: NOW, keys })).ok).toBe(true);
    }
    expect(source.asked).toEqual(['made-up-key-1', 'made-up-key-2']);
  });

  it('section 2 A47 a kid Plaid does not know is refused, and not asked about again for an hour', async () => {
    const { signer, source, keys } = await signerAndKeys();
    const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), NOW, { kid: 'made-up-nobody' });
    expect(await verifyWebhook({ headers: headersOf(s), body: s.body, now: NOW, keys })).toMatchObject({ ok: false, status: 401 });
    expect(await verifyWebhook({ headers: headersOf(s), body: s.body, now: at(30), keys })).toMatchObject({ ok: false, status: 401 });
    expect(source.asked).toEqual(['made-up-nobody']);
  });

  it('section 2 A47 a key is no good once its expired_at has passed (rotation); before then it still is', async () => {
    const lines: LogLine[] = [];
    let now = NOW;
    const { signer, source, keys } = await signerAndKeys(() => now, lines);
    signer.key = { ...signer.key, expired_at: Math.floor(NOW.getTime() / 1000) + 600 };
    source.add(signer);
    const ok = async (): Promise<boolean> => {
      const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), now);
      return (await verifyWebhook({ headers: headersOf(s), body: s.body, now, keys })).ok;
    };
    expect(await ok()).toBe(true);
    now = at(599);
    expect(await ok()).toBe(true);
    now = at(600);
    expect(await ok()).toBe(false);
  });

  it('section 2 A47 a key kept for a day is asked for again, so a key Plaid has since let expire is seen to be', async () => {
    let now = NOW;
    const { signer, source, keys } = await signerAndKeys(() => now);
    const verify = async (): Promise<boolean> => {
      const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), now);
      return (await verifyWebhook({ headers: headersOf(s), body: s.body, now, keys })).ok;
    };
    expect(await verify()).toBe(true);
    // Plaid rotates: the old key now says when it expired.
    source.keys.set(signer.kid, { ...signer.key, expired_at: Math.floor(NOW.getTime() / 1000) + 3_600 });
    now = at(23 * 3_600);
    expect(await verify()).toBe(true);
    expect(source.asked).toHaveLength(1);
    now = at(24 * 3_600 + 1);
    expect(await verify()).toBe(false);
    expect(source.asked).toHaveLength(2);
  });

  it('section 2 A47 a key that cannot be had (Plaid out of reach) answers 503, so Plaid tries again later; nothing is kept from the failure', async () => {
    const { signer, source, keys } = await signerAndKeys();
    source.failing = 'made up: out of reach';
    const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), NOW);
    expect(await verifyWebhook({ headers: headersOf(s), body: s.body, now: NOW, keys })).toMatchObject({ ok: false, status: 503 });
    source.failing = null;
    expect((await verifyWebhook({ headers: headersOf(s), body: s.body, now: at(1), keys })).ok).toBe(true);
  });

  it('section 2 A47 strangers sending made-up kids cannot make the app ask Plaid more than 10 times an hour; once past, an unknown kid answers 503 until the hour is up', async () => {
    let now = NOW;
    const { signer, source, keys } = await signerAndKeys(() => now);
    for (let i = 0; i < 25; i += 1) {
      const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), now, { kid: `made-up-stranger-${i}` });
      await verifyWebhook({ headers: headersOf(s), body: s.body, now, keys });
    }
    expect(source.asked).toHaveLength(10);
    const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), now);
    expect(await verifyWebhook({ headers: headersOf(s), body: s.body, now, keys })).toMatchObject({ ok: false, status: 503 });
    now = at(3_601);
    const later = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), now);
    expect((await verifyWebhook({ headers: headersOf(later), body: later.body, now, keys })).ok).toBe(true);
  });

  it('section 2 A47 a key Plaid gives that is not an ES256 P-256 public key is not used', async () => {
    const { signer, source, keys } = await signerAndKeys();
    for (const bad of [{ alg: 'RS256' }, { crv: 'P-384' }, { kty: 'RSA' }, { kid: 'made-up-other' }] as Partial<WebhookKey>[]) {
      source.keys.set(signer.kid, { ...signer.key, ...bad });
      const fresh = new WebhookKeys({ source, now: () => NOW, log: memoryLog([]) });
      const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE'), NOW);
      expect((await verifyWebhook({ headers: headersOf(s), body: s.body, now: NOW, keys: fresh })).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(keys).toBeDefined();
  });
});

describe('section 2 A47 what each webhook does: a trigger only', () => {
  it('section 2 A47 new transactions, the connection\'s state (10.5, 10.13), and new statements are read by a sync; Plaid\'s confirmation of the address is only noted; the rest nothing', () => {
    const cases: [string, string, ReturnType<typeof webhookAction>][] = [
      ['TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', 'sync'],
      ['ITEM', 'ERROR', 'sync'],
      ['ITEM', 'LOGIN_REPAIRED', 'sync'],
      ['ITEM', 'PENDING_DISCONNECT', 'sync'],
      ['ITEM', 'PENDING_EXPIRATION', 'sync'],
      ['ITEM', 'USER_PERMISSION_REVOKED', 'sync'],
      ['ITEM', 'USER_ACCOUNT_REVOKED', 'sync'],
      ['ITEM', 'NEW_ACCOUNTS_AVAILABLE', 'sync'],
      ['LIABILITIES', 'DEFAULT_UPDATE', 'sync'],
      ['ITEM', 'WEBHOOK_UPDATE_ACKNOWLEDGED', 'note'],
      ['TRANSACTIONS', 'INITIAL_UPDATE', 'nothing'],
      ['TRANSACTIONS', 'HISTORICAL_UPDATE', 'nothing'],
      ['TRANSACTIONS', 'DEFAULT_UPDATE', 'nothing'],
      ['TRANSACTIONS', 'TRANSACTIONS_REMOVED', 'nothing'],
      ['TRANSFER', 'TRANSFER_EVENTS_UPDATE', 'nothing'],
      ['MADE_UP', 'ANYTHING', 'nothing'],
    ];
    for (const [type, code, action] of cases) expect(webhookAction({ type, code, itemId: MADE_UP_ITEM, errorCode: null }), `${type} ${code}`).toBe(action);
  });
});

interface Desk {
  readonly desk: WebhookDesk;
  readonly signer: FakeWebhookSigner;
  readonly source: FakeKeySource;
  readonly clock: FakeClock;
  readonly time: { now: Date };
  readonly lines: LogLine[];
  syncs: number;
  // While set, each sync waits for it.
  hold: Promise<void> | null;
  call(body: string, options?: { readonly at?: Date; readonly kid?: string }): Promise<{ status: number; text: string }>;
  settle(ms?: number): Promise<void>;
}

const desks: Desk[] = [];
afterEach(async () => {
  for (const d of desks.splice(0)) await d.desk.stop();
});

async function makeDesk(itemId: string | null = MADE_UP_ITEM): Promise<Desk> {
  const time = { now: NOW };
  const clock = new FakeClock(time);
  const lines: LogLine[] = [];
  const signer = await FakeWebhookSigner.make();
  const source = new FakeKeySource().add(signer);
  const d: Desk = {
    signer,
    source,
    clock,
    time,
    lines,
    syncs: 0,
    hold: null,
    desk: undefined as unknown as WebhookDesk,
    call: async (body, options = {}) => {
      const s = await signer.sign(body, options.at ?? time.now, options.kid === undefined ? {} : { kid: options.kid });
      return d.desk.receive({ headers: headersOf(s), body: s.body });
    },
    settle: async (ms = 0) => {
      await clock.advance(ms, () => d.desk.idle());
    },
  };
  (d as { desk: WebhookDesk }).desk = new WebhookDesk({
    keys: new WebhookKeys({ source, now: () => time.now, log: memoryLog(lines) }),
    itemId: () => itemId,
    sync: async () => {
      d.syncs += 1;
      await d.hold;
      return 'synced';
    },
    onItsWay: () => null,
    clock,
    now: () => time.now,
    log: memoryLog(lines),
  });
  desks.push(d);
  return d;
}

const SYNC = webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', { initial_update_complete: true, historical_update_complete: true });

describe('section 2 A47 the webhook desk: answered at once, the work after', () => {
  it('section 2 A47 new transactions: answered 200 before the sync, which starts once the burst has had a moment to come in', async () => {
    const d = await makeDesk();
    let release: () => void = () => undefined;
    d.hold = new Promise((done) => (release = done));
    expect(await d.call(SYNC)).toEqual({ status: 200, text: 'ok' });
    expect(d.syncs).toBe(0);
    await d.settle(1_999);
    expect(d.syncs).toBe(0);
    await d.clock.advance(1, async () => undefined);
    expect(d.syncs).toBe(1);
    release();
    await d.desk.idle();
    expect(d.lines.some((l) => l.event === 'webhook' && l.fields?.['type'] === 'TRANSACTIONS' && l.fields['code'] === 'SYNC_UPDATES_AVAILABLE')).toBe(true);
  });

  it('section 2 A47 a burst of twenty calls makes one sync', async () => {
    const d = await makeDesk();
    for (let i = 0; i < 20; i += 1) expect((await d.call(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', { n: i }))).status).toBe(200);
    await d.settle(10_000);
    expect(d.syncs).toBe(1);
  });

  it('section 2 A47 calls while a sync is on its way make exactly one more sync after it, never two at once', async () => {
    const d = await makeDesk();
    let release: () => void = () => undefined;
    d.hold = new Promise((done) => (release = done));
    await d.call(SYNC);
    await d.clock.advance(2_000, async () => undefined);
    expect(d.syncs).toBe(1);
    for (let i = 0; i < 5; i += 1) await d.call(webhookBody('ITEM', 'NEW_ACCOUNTS_AVAILABLE', { n: i }));
    await d.clock.advance(10_000, async () => undefined);
    expect(d.syncs).toBe(1);
    d.hold = null;
    release();
    await d.desk.idle();
    await d.settle(10_000);
    expect(d.syncs).toBe(2);
    await d.settle(60_000);
    expect(d.syncs).toBe(2);
  });

  it('section 2 A47 one that waits for a sync already on its way (the timer\'s) starts its own after it, so what Plaid has now is read', async () => {
    const time = { now: NOW };
    const clock = new FakeClock(time);
    const signer = await FakeWebhookSigner.make();
    let release: () => void = () => undefined;
    const timers = new Promise<void>((done) => (release = done));
    const order: string[] = [];
    let busy: Promise<void> | null = timers.then(() => {
      order.push('timer done');
      busy = null;
    });
    const desk = new WebhookDesk({
      keys: new WebhookKeys({ source: new FakeKeySource().add(signer), now: () => time.now, log: memoryLog([]) }),
      itemId: () => MADE_UP_ITEM,
      sync: async () => {
        order.push(busy === null ? 'webhook sync' : 'webhook sync while busy');
      },
      onItsWay: () => busy,
      clock,
      now: () => time.now,
      log: memoryLog([]),
    });
    const s = await signer.sign(SYNC, NOW);
    expect((await desk.receive({ headers: headersOf(s), body: s.body })).status).toBe(200);
    await clock.advance(5_000, () => Promise.resolve());
    expect(order).toEqual([]);
    release();
    await desk.idle();
    expect(order).toEqual(['timer done', 'webhook sync']);
    await desk.stop();
  });

  it('section 2 A47 another connection\'s webhook, or one before any connection, is refused (403) and does nothing', async () => {
    const d = await makeDesk();
    expect(await d.call(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', {}, 'item-made-up-someone-else'))).toMatchObject({ status: 403 });
    const none = await makeDesk(null);
    expect(await none.call(SYNC)).toMatchObject({ status: 403 });
    const noItem = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE' });
    expect(await d.call(noItem)).toMatchObject({ status: 403 });
    await d.settle(10_000);
    await none.settle(10_000);
    expect([d.syncs, none.syncs]).toEqual([0, 0]);
  });

  it('section 2 A47 replayed at once: the same signed call twice is answered 200 and does nothing more', async () => {
    const d = await makeDesk();
    const s = await d.signer.sign(webhookBody('ITEM', 'WEBHOOK_UPDATE_ACKNOWLEDGED', { new_webhook_url: 'https://made-up-budget.fly.dev/plaid/webhook' }), NOW);
    expect(await d.desk.receive({ headers: headersOf(s), body: s.body })).toEqual({ status: 200, text: 'ok' });
    expect(await d.desk.receive({ headers: headersOf(s), body: s.body })).toEqual({ status: 200, text: 'ok' });
    expect(d.lines.filter((l) => l.event === 'webhook address confirmed by Plaid')).toHaveLength(1);
    const sync = await d.signer.sign(SYNC, NOW);
    for (let i = 0; i < 3; i += 1) await d.desk.receive({ headers: headersOf(sync), body: sync.body });
    await d.settle(10_000);
    expect(d.syncs).toBe(1);
    expect(d.lines.filter((l) => l.event === 'webhook repeat')).toHaveLength(3);
  });

  it('section 2 A47 forged, too old, tampered: refused (401), nothing synced, and the log says why without the body or the header', async () => {
    const d = await makeDesk();
    const forger = await FakeWebhookSigner.make(d.signer.kid);
    const forged = await forger.sign(SYNC, NOW);
    const old = await d.signer.sign(SYNC, at(-301));
    const good = await d.signer.sign(SYNC, NOW);
    for (const [s, body] of [
      [forged, forged.body],
      [old, old.body],
      [good, Buffer.from(SYNC.replace('true', 'false'))],
    ] as const) {
      expect((await d.desk.receive({ headers: headersOf(s), body })).status).toBe(401);
    }
    await d.settle(10_000);
    expect(d.syncs).toBe(0);
    const refused = d.lines.filter((l) => l.event === 'webhook refused');
    expect(refused).toHaveLength(3);
    const logged = JSON.stringify(d.lines);
    for (const secret of [forged.header, good.header, 'SYNC_UPDATES_AVAILABLE', MADE_UP_ITEM, 'initial_update_complete']) expect(logged).not.toContain(secret);
  });

  it('section 2 A47 more than 30 calls in a minute: the rest answered 429 without being looked at (no key asked for)', async () => {
    const d = await makeDesk();
    expect((await d.call(SYNC)).status).toBe(200);
    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1) statuses.push((await d.call(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', { n: i }), { kid: `made-up-stranger-${i}` })).status);
    // 30 a minute: his first, and 29 strangers; the other 11 never looked at.
    expect(statuses.filter((s) => s === 429)).toHaveLength(11);
    // His key, then 9 strangers': 10, the most Plaid is asked in an hour.
    expect(d.source.asked).toHaveLength(10);
    d.time.now = at(61);
    expect((await d.call(SYNC)).status).toBe(200);
    expect(d.source.asked).toHaveLength(10);
  });

  it('section 2 A47 a sync that fails is logged and the desk goes on: the next webhook syncs again', async () => {
    const time = { now: NOW };
    const clock = new FakeClock(time);
    const signer = await FakeWebhookSigner.make();
    const lines: LogLine[] = [];
    let tries = 0;
    const desk = new WebhookDesk({
      keys: new WebhookKeys({ source: new FakeKeySource().add(signer), now: () => time.now, log: memoryLog([]) }),
      itemId: () => MADE_UP_ITEM,
      sync: async () => {
        tries += 1;
        if (tries === 1) throw new Error('made up: the bank could not be reached');
      },
      onItsWay: () => null,
      clock,
      now: () => time.now,
      log: memoryLog(lines),
    });
    const send = async (n: number): Promise<void> => {
      const s = await signer.sign(webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', { n }), time.now);
      await desk.receive({ headers: headersOf(s), body: s.body });
      await clock.advance(5_000, () => desk.idle());
    };
    await send(1);
    await send(2);
    expect(tries).toBe(2);
    expect(lines.some((l) => l.event === 'webhook sync failed')).toBe(true);
    await desk.stop();
  });
});

// ----- With the real books, the real server, and the made-up bank -----

interface Hosted {
  readonly life: Life;
  readonly desk: WebhookDesk;
  readonly signer: FakeWebhookSigner;
  readonly clock: FakeClock;
  readonly port: number;
  readonly lines: LogLine[];
  inFlight: number;
  most: number;
  gate: Promise<void> | null;
  post(body: Buffer | string, headers: Record<string, string>, method?: string): Promise<{ status: number; text: string }>;
  close(): Promise<void>;
}

const hostedRuns: Hosted[] = [];
afterEach(async () => {
  for (const h of hostedRuns.splice(0)) await h.close();
});

async function hosted(): Promise<Hosted> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  const clock = new FakeClock(life);
  const lines: LogLine[] = [];
  const signer = await FakeWebhookSigner.make();
  const h = { inFlight: 0, most: 0, gate: null as Promise<void> | null } as Hosted;
  // The made-up bank, its /transactions/sync calls counted while they are on their way.
  const fetch: Fetch = async (url, init) => {
    const counted = url.endsWith('/transactions/sync');
    if (counted) {
      h.inFlight += 1;
      h.most = Math.max(h.most, h.inFlight);
    }
    try {
      if (counted) await h.gate;
      return await life.h.fake.fetch(url, init);
    } finally {
      if (counted) h.inFlight -= 1;
    }
  };
  const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: life.h.fake.clientId, PLAID_SECRET: life.h.fake.secret }), { fetch, log: memoryLog(lines) });
  const bank = { plaid, box: life.h.box, log: memoryLog(lines) };
  const desk = new WebhookDesk({
    keys: new WebhookKeys({ source: new FakeKeySource().add(signer), now: () => life.now, log: memoryLog(lines) }),
    itemId: () => life.keeper.itemId(),
    sync: () => life.keeper.sync(bank),
    onItsWay: () => life.keeper.syncOnItsWay(),
    clock,
    now: () => life.now,
    log: memoryLog(lines),
  });
  const webRoot = join(life.dir, 'dist');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
  const server = life.keeper.server(webRoot, () => 'https://made-up-budget.fly.dev', undefined, { bank, webhook: desk });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  Object.assign(h, {
    life,
    desk,
    signer,
    clock,
    port,
    lines,
    timer: new SyncTimer({ syncer: { syncDueIn: () => life.keeper.syncDueIn(), sync: () => life.keeper.sync(bank) }, clock, log: memoryLog(lines) }),
    post: (body: Buffer | string, headers: Record<string, string>, method = 'POST') =>
      new Promise((resolve, reject) => {
        const bytes = typeof body === 'string' ? Buffer.from(body) : body;
        const chunked = headers['Transfer-Encoding'] === 'chunked';
        const sent = method === 'POST' ? { 'Content-Type': 'application/json', ...(chunked ? {} : { 'Content-Length': String(bytes.length) }) } : {};
        const req = httpRequest(
          { host: '127.0.0.1', port, method, path: WEBHOOK_PATH, headers: { Host: 'made-up-budget.fly.dev', 'X-Forwarded-Proto': 'https', ...sent, ...headers }, setHost: false, agent: false },
          (res) => {
            let text = '';
            res.on('data', (c: Buffer) => (text += c.toString()));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
          },
        );
        req.on('error', reject);
        req.end(method === 'POST' ? bytes : undefined);
      }),
    close: async () => {
      await desk.stop();
      await new Promise<void>((done) => server.close(() => done()));
      life.done();
    },
  });
  hostedRuns.push(h);
  return h;
}

async function signedFor(h: Hosted, body: string): Promise<{ body: Buffer; headers: Record<string, string> }> {
  const s = await h.signer.sign(body, h.life.now);
  return { body: s.body, headers: { 'Plaid-Verification': s.header } };
}

describe('section 2 A47 the webhook address on the real server', () => {
  it('section 2 A47 POST /plaid/webhook is open without a login (Plaid has none), the one webhook address among the open ones', () => {
    expect(WEBHOOK_PATH).toBe('/plaid/webhook');
    expect(ROUTES.filter((r) => r.path === WEBHOOK_PATH)).toEqual([{ method: 'POST', path: WEBHOOK_PATH, login: false }]);
  });

  it('section 2 A47 his connection\'s webhook, signed by Plaid, is answered without a login, and the made-up bank is read by a sync after it', async () => {
    const h = await hosted();
    const item = readConnection(h.life.h.db)?.itemId;
    expect(item).toBeDefined();
    h.life.h.fake.addPosted({ id: 'shop-1', account: 'acct-everyday', amount: 1_234, date: '2026-10-02', description: 'MADE UP SHOP' });
    const { body, headers } = await signedFor(h, webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', {}, item));
    expect(await h.post(body, headers)).toEqual({ status: 200, text: 'ok' });
    await h.clock.advance(5_000, () => h.desk.idle());
    expect(h.life.keeper.book()?.reviewItems().map((i) => i.id)).toContain('shop-1');
  });

  it('section 2 A47 never money from its contents: a webhook carrying made-up transactions and amounts changes nothing the bank does not show', async () => {
    const h = await hosted();
    await h.life.sync();
    const before = everything(h.life.keeper.book()!);
    const item = readConnection(h.life.h.db)?.itemId;
    const { body, headers } = await signedFor(h, webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', { added: [{ transaction_id: 'made-up-1', amount: 99_999, name: 'MADE UP' }], new_transactions: 5, balance: 1_000_000 }, item));
    expect((await h.post(body, headers)).status).toBe(200);
    await h.clock.advance(5_000, () => h.desk.idle());
    expect(everything(h.life.keeper.book()!)).toEqual(before);
  });

  it('section 2 A47 the webhook and the timer never sync twice at once: one on its way waits, and the webhook\'s own sync comes after', async () => {
    const h = await hosted();
    let release: () => void = () => undefined;
    h.gate = new Promise((done) => (release = done));
    const timer = (h as unknown as { timer: SyncTimer }).timer;
    timer.start();
    for (let i = 0; i < 200 && h.inFlight === 0; i += 1) await new Promise((done) => setImmediate(done));
    expect(h.inFlight).toBe(1);
    const item = readConnection(h.life.h.db)?.itemId;
    const { body, headers } = await signedFor(h, webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', {}, item));
    // Answered while the timer's sync is held.
    expect((await h.post(body, headers)).status).toBe(200);
    await h.clock.advance(5_000, async () => undefined);
    expect(h.most).toBe(1);
    h.gate = null;
    release();
    await timer.stop();
    await h.desk.idle();
    expect(h.most).toBe(1);
    // Two syncs, one after the other: the timer's, then the webhook's own.
    expect(h.lines.filter((l) => l.event === 'sync done')).toHaveLength(2);
  });

  it('section 2 A47 only POST, only JSON, and at most 8 KB; refused before anything is looked at', async () => {
    const h = await hosted();
    const { body, headers } = await signedFor(h, SYNC);
    expect((await h.post(body, headers, 'GET')).status).toBe(405);
    expect((await h.post(body, { ...headers, 'Content-Type': 'text/plain' })).status).toBe(415);
    const big = Buffer.alloc(WEBHOOK_BODY_LIMIT + 1, 0x20);
    expect((await h.post(big, headers)).status).toBe(413);
    // Sent in pieces, with no length given: counted as it comes.
    expect((await h.post(big, { ...headers, 'Transfer-Encoding': 'chunked' })).status).toBe(413);
    // Exactly the limit is read (and then refused, not being Plaid's).
    expect((await h.post(Buffer.alloc(WEBHOOK_BODY_LIMIT, 0x20), headers)).status).toBe(401);
    expect(WEBHOOK_BODY_LIMIT).toBe(8_192);
  });

  it('section 2 A47 a signed call for another connection reaching the real server is refused (403), and nothing is read', async () => {
    const h = await hosted();
    const before = h.life.h.fake.calls.length;
    const { body, headers } = await signedFor(h, webhookBody('TRANSACTIONS', 'SYNC_UPDATES_AVAILABLE', {}, 'item-made-up-someone-else'));
    expect((await h.post(body, headers)).status).toBe(403);
    await h.clock.advance(5_000, () => h.desk.idle());
    expect(h.life.h.fake.calls.length).toBe(before);
  });
});
