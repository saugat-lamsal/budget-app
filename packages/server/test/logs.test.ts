import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryLog, type LogLine } from '../src/log.js';
import { newPushKeys } from '../src/push/push-keys.js';
import { AlertTimer, logSender } from '../src/serve/alert-timer.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { FakePushService } from './fake-push-service.js';
import { TOKEN_KEY } from './harness.js';
import { HOSTED, ask, firstLogin, type Running } from './hosted-harness.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk } from './keeper-harness.js';
import { loginForTests } from './login-for-tests.js';

// Phase 6's checklist: nothing sensitive in the logs. Hosted, the server's
// log is kept by Fly. A hosted server is run through a login, notifications
// turned on, syncs with the bank, alerts sent to the phone, a phone that
// cannot be reached and one whose subscription is gone, and everything it
// writes in its log, with the same secrets hidden as npm run serve hides, is
// searched for anything of his: a key, the bank's key, a login, a one-time
// code, a phone's push address or keys, an amount, or a name from the bank.
// Every name, key and number is made up.

const cleanUp: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const done of cleanUp.splice(0).reverse()) await done();
});

describe('Phase 6 nothing sensitive in the logs', () => {
  // A whole hosted server through logins, syncs and alerts: 0.6 s on his PC,
  // 0.8 s on Linux CI, 5.9 s on CI's Windows runner (2 cores, busy with the
  // long simulations beside it), past the 5-second default.
  it('Phase 6 a hosted server\'s log, through logins, syncs, alerts and failing phones, holds no key, login, code, push address, amount or bank name', async () => {
    const keys = newPushKeys('mailto:made-up@example.com');
    const life = await lifeInAFile();
    const service = await FakePushService.start({ now: () => life.now, serverKey: keys.publicKey });
    cleanUp.push(() => service.close());
    cleanUp.push(() => life.done());
    const lines: LogLine[] = [];
    // What npm run serve hides in its log (main.ts).
    const log = memoryLog(lines, [life.h.fake.clientId, life.h.fake.secret, TOKEN_KEY, keys.privateKey]);
    life.restart({ push: { keys, agent: service.agent }, log });
    setUpThroughTheDesk(life);
    life.now = noonInNewYork('2026-10-03');
    const webRoot = join(life.dir, 'dist');
    mkdirSync(webRoot, { recursive: true });
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
    const server: Server = life.keeper.server(webRoot, () => HOSTED, (error) => log.error('a request failed', { error: error instanceof Error ? error.message : String(error) }));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    cleanUp.push(() => new Promise<void>((done) => server.close(() => done())));
    const address = server.address();
    const r: Running = { life, server, port: typeof address === 'object' && address !== null ? address.port : 0, origin: HOSTED };

    // He logs in, and turns notifications on for two phones.
    const { cookie, code } = await firstLogin(r);
    const phone = service.newPhone();
    const other = service.newPhone();
    // The other phone with a login of its own: each login is one device.
    const otherCookie = loginForTests(life.h.db, life.now);
    expect((await ask(r, 'POST', '/api/push/on', { cookie, body: phone.subscription() })).status).toBe(200);
    expect((await ask(r, 'POST', '/api/push/on', { cookie: otherCookie, body: other.subscription() })).status).toBe(200);
    // The bank: purchases that empty wants, and one it shows and takes back.
    const bank = { plaid: life.h.plaid, box: life.h.box, log };
    const clock = new FakeClock(life);
    const timer = new AlertTimer({ alerter: life.keeper, sender: life.keeper.pushSender() ?? logSender(log), clock, log });
    timer.start();
    cleanUp.push(() => timer.stop());
    const step = async (): Promise<void> => {
      await life.keeper.sync(bank);
      life.keeper.checkAlerts();
      timer.poke();
      await timer.idle();
    };
    life.h.fake.addPosted({ id: 'big-1', account: ACCOUNT_IDS.everyday, amount: 98_765, date: '2026-10-03', description: 'MADE UP FURNITURE' });
    await step();
    life.h.fake.addPosted({ id: 'copy-1', account: ACCOUNT_IDS.everyday, amount: 1_150, date: '2026-10-03', description: 'MADE UP CAFE' });
    await step();
    // One phone cannot be reached, then the other's subscription is gone.
    phone.failing = 'made up: the phone is off';
    life.h.fake.removePosted('copy-1', { keepBalance: false });
    await step();
    other.gone = true;
    life.h.fake.addPosted({ id: 'more-1', account: ACCOUNT_IDS.everyday, amount: 4_321, date: '2026-10-03', description: 'MADE UP GROCER' });
    await step();
    // The evening's review, tried again and again for the phone that is off.
    await clock.advance(12 * 60 * 60_000, () => timer.idle());
    // Back on; what waited goes once quiet hours end, at 7:00 AM (10.8).
    phone.failing = null;
    await clock.advance(9 * 60 * 60_000, () => timer.idle());
    expect(phone.tries).toBeGreaterThan(3);
    expect(phone.shown.length).toBeGreaterThan(1);
    expect(other.tries).toBeGreaterThan(0);

    // Hosted with no push keys, an alert in the log is its title only.
    await logSender(log, 'title only').send({ id: 'made-up', title: 'Wants is empty', body: '$12.34 left of $987.65 at MADE UP CAFE.', screen: '/home', due: null, dueAt: '2026-10-04T00:00:00.000Z' });

    const written = [...lines, ...life.h.lines].map((line) => JSON.stringify(line));
    expect(written.length).toBeGreaterThan(10);
    expect(written.some((l) => l.includes('"push"'))).toBe(true);
    expect(written.some((l) => l.includes('Wants is empty'))).toBe(true);
    const token = cookie.split('=')[1] ?? '';
    const sub = phone.subscription();
    const forbidden: [string, string | RegExp][] = [
      ['the Plaid client id', life.h.fake.clientId],
      ['the Plaid secret', life.h.fake.secret],
      ['the bank key', TOKEN_KEY],
      ['the bank connection\'s key', life.h.fake.accessToken],
      ['the push private key', keys.privateKey],
      ['the login', token],
      ['the other login', otherCookie.split('=')[1] ?? ''],
      ['the one-time code', code],
      ['the one-time code, with dashes', code.replace(/(\d{4})(?=\d)/g, '$1-')],
      ['a phone\'s push address', sub.endpoint],
      ['a phone\'s push key', sub.keys.p256dh],
      ['a phone\'s push secret', sub.keys.auth],
      ['the other phone\'s push address', other.endpoint],
      ['an amount', /\$\s?\d|\d+\.\d\d\b/],
      ['a name from the bank (a store, an account)', /MADE UP|Made-up [A-Z]/],
    ];
    for (const [what, value] of forbidden) {
      for (const line of written) {
        if (typeof value === 'string') expect(line.includes(value), `${what} in ${line}`).toBe(false);
        else expect(value.test(line), `${what} in ${line}`).toBe(false);
      }
    }
  }, 60_000);

  it('Phase 6 what the server hides in its log is every secret it is given: the Plaid keys, the bank key, the push key, and (on Fly) the backup\'s key', () => {
    const main = readFileSync(new URL('../src/serve/main.ts', import.meta.url), 'utf8');
    expect(main).toContain("consoleLog([keys.clientId, keys.secret, process.env['BANK_TOKEN_KEY'] ?? '', ...(push === null ? [] : [push.privateKey])])");
    const start = readFileSync(new URL('../src/serve/start.ts', import.meta.url), 'utf8');
    expect(start).toContain("const secrets = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'BANK_TOKEN_KEY', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'VAPID_PRIVATE_KEY'].map((name) => env[name] ?? '');");
    expect(start).toContain('const log: Log = consoleLog(secrets);');
  });
});
