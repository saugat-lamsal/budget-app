import type { Server } from 'node:http';
import type { BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newPushKeys, type PushKeys } from '../../../server/src/push/push-keys.js';
import { FakePushService, type TestPhone } from '../../../server/test/fake-push-service.js';
import { lifeInAFile, setUpThroughTheDesk, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { ENGINES, WEB_ROOT, close, listen, phone, textAt, untilAnswered, untilQuiet, useEngine, waitOrReport } from './harness.js';
import { pushAsked, setPushPhone, stubPush } from './push-stub.js';

// Phase 5, the phone: Settings' Notifications card on the real server, used
// like a person would, in both engines. Turning them on asks the phone (only
// from his tap), subscribes with the app's public key, and the server keeps
// this device; Send a test alert reaches the test phone through the made-up
// push service, opened with the phone's own keys; Turn off forgets it; and
// the states in words: blocked in the phone's settings, open it from the home
// screen first, stopped by the push service. The browser's push parts are a
// stand-in (push-stub.ts says why); the server, the web-push library and the
// push service are real. Every name, key and number is made up.

interface Real {
  readonly life: Life;
  readonly server: Server;
  base: string;
}

describe.each(ENGINES)('Settings, Notifications, on the real server, in %s', (_name, engine) => {
  const { browser } = useEngine(engine);
  let keys: PushKeys;
  let service: FakePushService;
  let real: Real;
  beforeAll(async () => {
    keys = newPushKeys('mailto:made-up@example.com');
    const life = await lifeInAFile();
    service = await FakePushService.start({ now: () => life.now, serverKey: keys.publicKey });
    life.restart({ push: { keys, agent: service.agent } });
    setUpThroughTheDesk(life);
    real = { life, server: undefined as unknown as Server, base: '' };
    (real as { server: Server }).server = life.keeper.server(WEB_ROOT, () => real.base);
    real.base = await listen(real.server);
  });
  afterAll(async () => {
    await close(real.server);
    await service.close();
    real.life.done();
  });

  // A phone of its own for each test, logged in the tests' way, its browser's
  // push parts the test phone's; the Settings page open, its card read.
  async function openOn(t: TestPhone): Promise<{ readonly context: BrowserContext; readonly page: Page }> {
    const context = await browser().newContext(phone());
    await context.addCookies([loginCookieForTests(real.life.h.db, real.life.now, real.base)]);
    await stubPush(context, t.subscription());
    const page = await context.newPage();
    await settings(page);
    return { context, page };
  }

  async function settings(page: Page): Promise<void> {
    await page.goto(`${real.base}/settings`);
    await waitOrReport(page, '[data-testid="notifications-state"]');
    await untilAnswered(page);
    await page.waitForFunction(() => document.querySelector('[data-testid="notifications-state"]')?.textContent?.includes('Checking') === false);
  }

  const subscriptions = (): { endpoint: string; device: string }[] => real.life.h.db.prepare('SELECT endpoint, device FROM push_subscriptions ORDER BY created_at').all() as { endpoint: string; device: string }[];
  const logTitles = async (page: Page): Promise<string[]> => page.getByTestId('log').locator('.row__title').allInnerTexts();

  it('Phase 5 off: Turn on asks the phone, subscribes with the app\'s public key, and the server keeps this device; the card says On, and the change log says so', async () => {
    const t = service.newPhone();
    const { context, page } = await openOn(t);
    expect(await textAt(page, 'notifications-state')).toContain('Off on this phone');
    // Only from his tap: opening Settings asked the phone nothing.
    expect((await pushAsked(page)).permissionAsks).toBe(0);
    await page.getByTestId('notifications-on').click();
    await page.getByTestId('notice').waitFor();
    await untilQuiet(page);
    expect(await textAt(page, 'notice')).toContain('Notifications are on for this phone.');
    expect(await pushAsked(page)).toEqual({ permissionAsks: 1, subscribedWith: keys.publicKey, registered: '/sw.js' });
    expect(subscriptions().map((s) => s.endpoint)).toContain(t.endpoint);
    await page.waitForFunction(() => document.querySelector('[data-testid="notifications-state"]')?.textContent?.includes('On for this phone') === true);
    expect(await logTitles(page)).toContain('Notifications turned on');
    await context.close();
  });

  it('Phase 5 B92 a double tap on Turn on asks the phone once and sends one request', async () => {
    const t = service.newPhone();
    const { context, page } = await openOn(t);
    // The change log is the server's, shared with the tests before: only the lines this tap adds.
    const turnedOn = async (): Promise<number> => (await logTitles(page)).filter((title) => title === 'Notifications turned on').length;
    const before = await turnedOn();
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname.startsWith('/api/push/')) sent.push(new URL(r.url()).pathname);
    });
    await page.getByTestId('notifications-on').dblclick();
    await page.getByTestId('notice').waitFor();
    await untilQuiet(page);
    expect(sent).toEqual(['/api/push/on']);
    expect((await pushAsked(page)).permissionAsks).toBe(1);
    await page.waitForFunction(() => document.querySelector('[data-testid="notifications-state"]')?.textContent?.includes('On for this phone') === true);
    expect(await turnedOn()).toBe(before + 1);
    await context.close();
  });

  it('Phase 5 Send a test alert reaches this phone through its push service, opened with its own keys, and goes nowhere else', async () => {
    const t = service.newPhone();
    const other = service.newPhone();
    const { context, page } = await openOn(t);
    await page.getByTestId('notifications-on').click();
    await page.getByTestId('notifications-test').waitFor();
    await untilQuiet(page);
    await page.getByTestId('notifications-test').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="notice"]')?.textContent?.includes('A test alert') === true);
    await untilQuiet(page);
    expect(t.shown.map((s) => [s.title, s.notification.body, s.notification.screen])).toEqual([['Test alert', 'Notifications are on for this phone. Alerts come like this one.', '/settings']]);
    expect(other.shown).toEqual([]);
    expect(service.problems).toEqual([]);
    await context.close();
  });

  it('Phase 5 Turn off: the server forgets this device and the browser its subscription; the card says Off', async () => {
    const t = service.newPhone();
    const { context, page } = await openOn(t);
    await page.getByTestId('notifications-on').click();
    await page.getByTestId('notifications-off').waitFor();
    await untilQuiet(page);
    await page.getByTestId('notifications-off').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="notice"]')?.textContent?.includes('Notifications are off on this phone.') === true);
    await untilQuiet(page);
    expect(subscriptions().map((s) => s.endpoint)).not.toContain(t.endpoint);
    // And the browser let its own subscription go.
    expect(await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription())?.endpoint ?? null)).toBeNull();
    await page.waitForFunction(() => document.querySelector('[data-testid="notifications-state"]')?.textContent?.includes('Off on this phone') === true);
    expect(await logTitles(page)).toContain('Notifications turned off');
    await context.close();
  });

  it('Phase 5 the phone does not allow them: the card says they are blocked in the phone\'s settings, in words, and nothing is kept', async () => {
    const t = service.newPhone();
    const { context, page } = await openOn(t);
    await setPushPhone(page, 'home-screen', 'denied');
    await settings(page);
    await page.getByTestId('notifications-on').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="notifications-state"]')?.textContent?.includes('Blocked') === true);
    await untilQuiet(page);
    expect(await textAt(page, 'notifications-state')).toBe("Blocked in the phone's settings To allow them: the phone's Settings, then Notifications, then Budget.");
    expect(await page.getByTestId('notifications-on').count()).toBe(0);
    expect(subscriptions().map((s) => s.endpoint)).not.toContain(t.endpoint);
    await context.close();
  });

  it('Phase 5 iPhone Safari, not opened from the home screen: the card says to open it from there first, and offers no Turn on', async () => {
    const t = service.newPhone();
    const { context, page } = await openOn(t);
    await setPushPhone(page, 'safari-not-home-screen');
    await settings(page);
    expect(await textAt(page, 'notifications-state')).toContain('Open the app from the home screen first');
    expect(await page.getByTestId('notifications-on').count()).toBe(0);
    await context.close();
  });

  it('Phase 5 a subscription its push service says is gone is removed when an alert goes, logged, and the card says notifications stopped; Turn on starts them again', async () => {
    const t = service.newPhone();
    const { context, page } = await openOn(t);
    await page.getByTestId('notifications-on').click();
    await page.getByTestId('notifications-test').waitFor();
    await untilQuiet(page);
    t.gone = true;
    await page.getByTestId('notifications-test').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="notice"]')?.textContent?.includes('notifications stopped here') === true);
    await untilQuiet(page);
    expect(subscriptions().map((s) => s.endpoint)).not.toContain(t.endpoint);
    await settings(page);
    expect(await textAt(page, 'notifications-state')).toMatch(/^Off on this phone They stopped \w{3}, \w{3} \d+: this phone's push service would not take them any more\. Turn them on to start again\./);
    expect(await logTitles(page)).toContain('Notifications stopped');
    t.gone = false;
    await page.getByTestId('notifications-on').click();
    await page.getByTestId('notifications-test').waitFor();
    await untilQuiet(page);
    expect(subscriptions().map((s) => s.endpoint)).toContain(t.endpoint);
    await context.close();
  });

  it('Phase 5 the app\'s private push key never reaches the phone: not in what the server answers, nor in the app\'s own files', async () => {
    const t = service.newPhone();
    const context = await browser().newContext(phone());
    await context.addCookies([loginCookieForTests(real.life.h.db, real.life.now, real.base)]);
    await stubPush(context, t.subscription());
    const page = await context.newPage();
    const bodies: string[] = [];
    page.on('response', (r) => void r.text().then((b) => bodies.push(b), () => undefined));
    await settings(page);
    await page.goto(`${real.base}/sw.js`);
    await untilQuiet(page);
    expect(bodies.length).toBeGreaterThan(3);
    expect(bodies.some((b) => b.includes(keys.publicKey))).toBe(true);
    expect(bodies.filter((b) => b.includes(keys.privateKey))).toEqual([]);
    await context.close();
  });
});
