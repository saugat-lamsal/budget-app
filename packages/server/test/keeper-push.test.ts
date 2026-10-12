import { request as httpRequest, type Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readOutbox } from '../src/alerts/outbox.js';
import { memoryLog } from '../src/log.js';
import { newPushKeys, type PushKeys } from '../src/push/push-keys.js';
import { AlertTimer } from '../src/serve/alert-timer.js';
import { serverLinesIn } from '../src/server-log.js';
import type { PushView } from '../src/views/push.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { FakePushService, type TestPhone } from './fake-push-service.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { loginForTests } from './login-for-tests.js';

// Phase 5, the phone, on the real server: Settings' Notifications card for the
// device asking (POST /api/push/on, /off, /test, logged in, from the app's own
// page), each device's subscription tied to its login, and the alerts the
// books work out going through the real sender to the made-up push service
// (fake-push-service.ts), with no amount on the lock screen unless the
// setting says so (10.10). Every name, key and number is made up.

const E = ACCOUNT_IDS.everyday;

interface Running {
  readonly life: Life;
  readonly server: Server;
  readonly port: number;
  readonly origin: string;
  readonly service: FakePushService;
  readonly keys: PushKeys;
}

const running: Running[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    await new Promise<void>((done) => r.server.close(() => done()));
    await r.service.close();
    r.life.done();
  }
});

async function realServer(withKeys = true): Promise<Running> {
  const keys = newPushKeys('mailto:made-up@example.com');
  const life = await lifeInAFile();
  const service = await FakePushService.start({ now: () => life.now, serverKey: keys.publicKey });
  life.restart({ push: { keys: withKeys ? keys : null, agent: service.agent } });
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-03');
  const webRoot = join(life.dir, 'dist');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
  let origin = '';
  const server = life.keeper.server(webRoot, () => origin);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  origin = `http://localhost:${port}`;
  const r = { life, server, port, origin, service, keys };
  running.push(r);
  return r;
}

function ask(r: Running, method: 'GET' | 'POST', path: string, cookie: string, body?: unknown): Promise<{ readonly status: number; readonly body: string }> {
  const text = method === 'POST' ? JSON.stringify(body ?? {}) : undefined;
  const headers: Record<string, string> = { Host: `localhost:${r.port}`, Cookie: cookie };
  if (method === 'POST') Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(text ?? '')), Origin: r.origin, 'Sec-Fetch-Site': 'same-origin' });
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: r.port, method, path, headers }, (res) => {
      let out = '';
      res.on('data', (chunk) => (out += String(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: out }));
    });
    req.on('error', reject);
    req.end(text);
  });
}

async function pushView(r: Running, cookie: string): Promise<PushView | undefined> {
  return (JSON.parse((await ask(r, 'GET', '/api/settings', cookie)).body) as { push?: PushView }).push;
}

async function turnOn(r: Running, cookie: string, phone: TestPhone): Promise<void> {
  expect(await ask(r, 'POST', '/api/push/on', cookie, phone.subscription())).toEqual({ status: 200, body: '{"ok":true}' });
}

// A take-back (10.6): a cafe the bank shows and then takes back, read by syncs.
async function takeBack(r: Running): Promise<void> {
  const { life } = r;
  await life.sync();
  life.keeper.checkAlerts();
  life.h.fake.addPosted({ id: 'copy-1', account: E, amount: 1_150, date: '2026-10-02', description: 'MADE UP CAFE' });
  await life.sync();
  life.keeper.checkAlerts();
  life.h.fake.removePosted('copy-1', { keepBalance: false });
  await life.sync();
  life.keeper.checkAlerts();
}

// The books' own alert timer, with the books' own push sender, until all is tried.
async function sendAll(r: Running): Promise<void> {
  const sender = r.life.keeper.pushSender();
  if (sender === null) throw new Error('no push sender');
  const timer = new AlertTimer({ alerter: r.life.keeper, sender, clock: new FakeClock(r.life), log: memoryLog([]) });
  timer.start();
  await timer.idle();
  await timer.stop();
}

const lines = (r: Running): string[] => serverLinesIn(r.life.h.db).filter((l) => l.action.startsWith('notifications')).map((l) => `${l.action} ${'device' in l ? l.device : ''}`);

describe('Phase 5 the Notifications card on the real server', () => {
  it('Phase 5 Settings tells the device asking about its notifications: the app\'s public key (never the private one), and whether they are on there', async () => {
    const r = await realServer();
    const cookie = loginForTests(r.life.h.db, r.life.now);
    expect(await pushView(r, cookie)).toEqual({ state: 'ready', publicKey: r.keys.publicKey, thisDevice: { on: false, stopped: null }, devices: 0 });
    expect((await ask(r, 'GET', '/api/settings', cookie)).body).not.toContain(r.keys.privateKey);
  });

  it('Phase 5 turned on: this device\'s subscription is kept, tied to its login, and logged; Settings says on, here only', async () => {
    const r = await realServer();
    const phone = r.service.newPhone();
    const mine = loginForTests(r.life.h.db, r.life.now, 'Safari on iPhone');
    const other = loginForTests(r.life.h.db, r.life.now, 'Chrome on Windows');
    await turnOn(r, mine, phone);
    expect(await pushView(r, mine)).toMatchObject({ thisDevice: { on: true, endpoint: phone.endpoint, since: '2026-10-03' }, devices: 1 });
    expect(await pushView(r, other)).toMatchObject({ thisDevice: { on: false, stopped: null }, devices: 1 });
    expect(lines(r)).toEqual(['notifications-on Safari on iPhone']);
  });

  it('Phase 5 turned off: forgotten and logged; off again changes nothing and logs nothing', async () => {
    const r = await realServer();
    const phone = r.service.newPhone();
    const cookie = loginForTests(r.life.h.db, r.life.now, 'Safari on iPhone');
    await turnOn(r, cookie, phone);
    expect(await ask(r, 'POST', '/api/push/off', cookie)).toEqual({ status: 200, body: '{"ok":true}' });
    expect(await ask(r, 'POST', '/api/push/off', cookie)).toEqual({ status: 200, body: '{"ok":true}' });
    expect(await pushView(r, cookie)).toMatchObject({ thisDevice: { on: false, stopped: null }, devices: 0 });
    expect(lines(r)).toEqual(['notifications-on Safari on iPhone', 'notifications-off Safari on iPhone']);
  });

  it('Phase 5 logging out on the device takes its notifications with it', async () => {
    const r = await realServer();
    const cookie = loginForTests(r.life.h.db, r.life.now);
    await turnOn(r, cookie, r.service.newPhone());
    expect((await ask(r, 'POST', '/api/auth/logout', cookie)).status).toBe(200);
    expect(r.life.h.db.prepare('SELECT count(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
  });

  it('Phase 5 only a push subscription is taken, and only for a push service\'s address: anything else is refused, in words when it is well formed, and nothing is kept', async () => {
    const r = await realServer();
    const cookie = loginForTests(r.life.h.db, r.life.now);
    const good = r.service.newPhone().subscription();
    for (const bad of [{}, { ...good, extra: 1 }, { endpoint: good.endpoint }, { ...good, keys: { p256dh: good.keys.p256dh } }, { ...good, keys: { ...good.keys, auth: 'not base64url!' } }, [good], 'text']) {
      expect((await ask(r, 'POST', '/api/push/on', cookie, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(await ask(r, 'POST', '/api/push/on', cookie, { ...good, endpoint: 'https://evil.example/push' })).toEqual({ status: 422, body: JSON.stringify({ ok: false, why: 'Under the tests the server sends to this computer only.' }) });
    expect((await ask(r, 'POST', '/api/push/off', cookie, { why: 'x' })).status).toBe(400);
    expect(r.life.h.db.prepare('SELECT count(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
  });

  it('Phase 5 Send a test alert: to this device only, at once; not one of the rules\' alerts, so not kept in the outbox; refused in words when off here', async () => {
    const r = await realServer();
    const mine = r.service.newPhone();
    const others = r.service.newPhone();
    const cookie = loginForTests(r.life.h.db, r.life.now);
    expect(await ask(r, 'POST', '/api/push/test', cookie)).toEqual({ status: 422, body: JSON.stringify({ ok: false, why: 'Notifications are off on this phone. Turn them on first.' }) });
    await turnOn(r, cookie, mine);
    await turnOn(r, loginForTests(r.life.h.db, r.life.now), others);
    expect(await ask(r, 'POST', '/api/push/test', cookie)).toEqual({ status: 200, body: '{"ok":true}' });
    expect(mine.shown.map((s) => [s.title, s.screen])).toEqual([['Test alert', '/settings']]);
    expect(others.shown).toEqual([]);
    expect(readOutbox(r.life.h.db, 100).rows).toEqual([]);
  });

  it('Phase 5 without push keys: Settings says the server is not set up, turning on is refused in words, and there is no push sender', async () => {
    const r = await realServer(false);
    const cookie = loginForTests(r.life.h.db, r.life.now);
    expect(await pushView(r, cookie)).toEqual({ state: 'no-keys' });
    expect(await ask(r, 'POST', '/api/push/on', cookie, r.service.newPhone().subscription())).toEqual({ status: 422, body: JSON.stringify({ ok: false, why: 'The server is not set up to send notifications: it has no push keys.' }) });
    expect(r.life.keeper.pushSender()).toBeNull();
  });
});

describe('Phase 5 the alerts the books work out, through the real sender', () => {
  it('Phase 5 10.6 10.10 an alert reaches each device that has them on, once, with no amount on the lock screen, opening the screen it is about', async () => {
    const r = await realServer();
    const phones = [r.service.newPhone(), r.service.newPhone()];
    for (const phone of phones) await turnOn(r, loginForTests(r.life.h.db, r.life.now), phone);
    await takeBack(r);
    await sendAll(r);
    for (const phone of phones) {
      expect(phone.shown.map((s) => [s.id, s.title, s.body, s.screen])).toEqual([['bank-took-back copy-1', 'The bank took something back', 'MADE UP CAFE, taken back Sat, Oct 3. It is undone in your buckets too.', '/home']]);
    }
    expect(readOutbox(r.life.h.db, 100).rows.map((row) => [row.key, row.sentAt !== null])).toEqual([['bank-took-back copy-1', true]]);
    expect(r.service.problems).toEqual([]);
  });

  it('Phase 5 10.10 with amounts on the lock screen set on, the amount goes too', async () => {
    const r = await realServer();
    const phone = r.service.newPhone();
    await turnOn(r, loginForTests(r.life.h.db, r.life.now), phone);
    await takeBack(r);
    // The setting in force when it is sent counts (B190), changed the way Settings changes it.
    expect(r.life.keeper.settingsChange({ id: 'lock-amounts-1', settings: { amountsOnLockScreen: true } })).toMatchObject({ ok: true });
    await sendAll(r);
    expect(phone.shown.map((s) => s.body)).toEqual(['MADE UP CAFE, $11.50, taken back Sat, Oct 3. It is undone in your buckets too.']);
  });

  it('Phase 5 a subscription its push service says is gone is removed and logged when an alert goes; that device\'s card says when it stopped; the alert waits to be tried again', async () => {
    const r = await realServer();
    const phone = r.service.newPhone();
    const cookie = loginForTests(r.life.h.db, r.life.now, 'Safari on iPhone');
    await turnOn(r, cookie, phone);
    phone.gone = true;
    await takeBack(r);
    await sendAll(r);
    expect(phone.shown).toEqual([]);
    expect(r.life.h.db.prepare('SELECT count(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
    expect(lines(r)).toEqual(['notifications-on Safari on iPhone', 'notifications-stopped Safari on iPhone']);
    expect(await pushView(r, cookie)).toEqual({ state: 'ready', publicKey: r.keys.publicKey, thisDevice: { on: false, stopped: { date: '2026-10-03', why: 'its push service answered 410: the subscription is gone' } }, devices: 0 });
    const row = readOutbox(r.life.h.db, 100).rows[0];
    expect([row?.sentAt, row?.tries, row?.lastError]).toEqual([null, 1, 'every device stopped taking notifications']);
    // Turned on again: it goes at the next try.
    phone.gone = false;
    await turnOn(r, cookie, phone);
    expect(await pushView(r, cookie)).toMatchObject({ thisDevice: { on: true } });
  });
});
