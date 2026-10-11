import type { Server } from 'node:http';
import type { BrowserContext, Page, Route } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { outboxCounts } from '../../../server/src/alerts/outbox.js';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { alertWhenText, alertsRowText } from '../../src/screens/alerts-text.js';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, WEB_ROOT, close, listen, phone, textAt, untilAnswered, untilQuiet, useEngine, waitOrReport } from './harness.js';

// Phase 5: the list of alerts the app worked out and sent, on the real
// server, in a browser like a person would use it. The alerts are worked out
// by the server's own books (Keeper.checkAlerts) from made-up bank activity:
// a take-back at 3:00 PM, sent; the 8:00 PM daily review, whose send failed
// and waits to be tried again. The list must say exactly what the outbox
// keeps. Then the design rules on it, in every state. Every name and number is
// made up.

const E = ACCOUNT_IDS.everyday;

interface Real {
  readonly life: Life;
  readonly server: Server;
  base: string;
}

// The books on Oct 3: set up, then a cafe the bank shows and takes back
// (10.6), and a shop purchase left waiting in review, so the evening has a
// daily review (10.3).
async function withAlerts(): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-03');
  await life.sync();
  life.keeper.checkAlerts();
  life.h.fake.addPosted({ id: 'copy-1', account: E, amount: 1_150, date: '2026-10-02', description: 'MADE UP CAFE' });
  life.now = new Date('2026-10-03T18:00:00Z');
  await life.sync();
  life.keeper.checkAlerts();
  life.h.fake.removePosted('copy-1', { keepBalance: false });
  life.now = new Date('2026-10-03T19:00:00Z');
  await life.sync();
  life.keeper.checkAlerts();
  life.keeper.trying('bank-took-back copy-1');
  life.keeper.sent('bank-took-back copy-1');
  life.h.fake.addPosted({ id: 'shop-1', account: E, amount: 2_399, date: '2026-10-03', description: 'MADE UP SHOP' });
  await life.sync();
  life.keeper.checkAlerts();
  // 8:00 PM in New York: the evening.
  life.now = new Date('2026-10-04T00:00:00Z');
  life.keeper.checkAlerts();
  life.keeper.trying('daily-review 2026-10-03');
  life.keeper.failed('daily-review 2026-10-03', 'the phone did not answer');
  return life;
}

async function serve(life: Life): Promise<Real> {
  const real: Real = { life, server: undefined as unknown as Server, base: '' };
  (real as { server: Server }).server = life.keeper.server(WEB_ROOT, () => real.base);
  real.base = await listen(real.server);
  return real;
}

async function openAlerts(page: Page, base: string, selector: string): Promise<void> {
  await page.goto(`${base}/alerts`);
  await waitOrReport(page, selector);
  await untilAnswered(page);
}

// Holds the list's numbers until let go.
async function holdAlerts(page: Page): Promise<() => Promise<void>> {
  let letGo: () => void = () => undefined;
  const held = new Promise<void>((done) => {
    letGo = done;
  });
  await page.route('**/api/alerts', async (route: Route) => {
    await held;
    await route.continue();
  });
  return async () => {
    letGo();
    await untilQuiet(page);
  };
}

type Which = 'alerts' | 'none' | 'not-set-up';
type Open = (page: Page, base: string) => Promise<(() => Promise<void>) | void>;

const STATES: readonly (readonly [string, Which, Open])[] = [
  ['the list', 'alerts', (page, base) => openAlerts(page, base, '[data-testid="alerts-list"]')],
  ['no alerts yet', 'none', (page, base) => openAlerts(page, base, '[data-testid="alerts-empty"]')],
  ['before setup day', 'not-set-up', (page, base) => openAlerts(page, base, '[data-testid="alerts-not-set-up"]')],
  ['the error, with Try again', 'alerts', async (page, base) => {
    await page.route('**/api/alerts', (route) => route.fulfill({ status: 500, body: 'no' }));
    await openAlerts(page, base, '[data-testid="alerts-error"]');
  }],
  ['loading', 'alerts', async (page, base) => {
    const letGo = await holdAlerts(page);
    await page.goto(`${base}/alerts`);
    await waitOrReport(page, '[data-testid="alerts-loading"]');
    return letGo;
  }],
  ['Settings, with the row that opens the list', 'alerts', async (page, base) => {
    await page.goto(`${base}/settings`);
    await waitOrReport(page, '[data-testid="row-alerts-sent"]');
    await untilAnswered(page);
  }],
];

// The loading skeleton shimmers for as long as it loads; the checks look at a
// screen at rest, so it is looked at with motion reduced.
const STILL = new Set(['loading']);

describe.each(ENGINES)('the list of alerts sent, on the real server, in %s', (_name, engine) => {
  const { browser } = useEngine(engine);
  const servers: Partial<Record<Which, Real>> = {};
  beforeAll(async () => {
    servers.alerts = await serve(await withAlerts());
    const none = await lifeInAFile();
    setUpThroughTheDesk(none);
    servers.none = await serve(none);
    servers['not-set-up'] = await serve(await lifeInAFile());
  });
  afterAll(async () => {
    for (const real of Object.values(servers)) {
      await close(real.server);
      real.life.done();
    }
  });
  const real = (which: Which): Real => {
    const r = servers[which];
    if (r === undefined) throw new Error('no server yet');
    return r;
  };

  // Logged in the tests' way (login-for-tests.ts). A cookie is kept by host,
  // not by port, so each test server has its own context.
  async function contextFor(options: Parameters<typeof phone>[0], which: Which = 'alerts'): Promise<BrowserContext> {
    const context = await browser().newContext(phone(options));
    const r = real(which);
    await context.addCookies([loginCookieForTests(r.life.h.db, r.life.now, r.base)]);
    return context;
  }

  async function eachState(options: Parameters<typeof phone>[0], check: (page: Page, where: string) => Promise<void>): Promise<void> {
    for (const [name, which, open] of STATES) {
      const context = await contextFor(STILL.has(name) ? { ...options, reducedMotion: 'reduce' } : options, which);
      const page = await context.newPage();
      const letGo = await open(page, real(which).base);
      await check(page, name);
      if (letGo !== undefined) await letGo();
      await context.close();
    }
  }

  it('10.3 10.6 the list says what the outbox keeps, newest first: each alert\'s words, when it was due, and when it was sent or why not yet', async () => {
    const r = real('alerts');
    const view = r.life.keeper.alertsView();
    if (view.state !== 'tracking') throw new Error('not tracking');
    expect(view.alerts.map((a) => a.key)).toContain('bank-took-back copy-1');
    expect(view.alerts[0]?.key).toBe('daily-review 2026-10-03');
    const context = await contextFor({});
    const page = await context.newPage();
    await openAlerts(page, r.base, '[data-testid="alerts-list"]');
    const rows = page.getByTestId('alerts-list').locator('.row');
    expect(await rows.count()).toBe(view.alerts.length);
    for (const [i, line] of view.alerts.entries()) {
      const row = rows.nth(i);
      expect(await row.getAttribute('data-testid'), `row ${i}`).toBe(`alert-${line.key}`);
      expect((await row.locator('.row__title').innerText()).trim()).toBe(line.title);
      expect((await row.getByTestId('alert-body').innerText()).trim()).toBe(line.body);
      expect((await row.getByTestId('alert-when').innerText()).trim()).toBe(alertWhenText(line, view.today));
    }
    // By hand: the take-back went at 3:00 PM; the daily review failed at 8:00 PM and is tried again a minute later.
    expect((await page.getByTestId('alert-bank-took-back copy-1').getByTestId('alert-when').innerText()).trim()).toBe('Due 3:00 PM, sent 3:00 PM');
    expect((await page.getByTestId('alert-daily-review 2026-10-03').getByTestId('alert-when').innerText()).trim()).toBe('Due 8:00 PM. Not sent yet: tried once, trying again at 8:01 PM.');
    expect((await page.getByTestId('alert-bank-took-back copy-1').getByTestId('alert-body').innerText()).trim()).toBe('MADE UP CAFE, $11.50, taken back Sat, Oct 3. It is undone in your buckets too.');
    // What has not gone out says so in words and with an icon, not by color alone.
    expect(await page.getByTestId('alert-daily-review 2026-10-03').locator('[data-icon]').first().getAttribute('data-icon')).toBe('clock');
    await context.close();
  });

  it('10.3 Settings has a row that counts them and opens the list; back goes to Settings', async () => {
    const r = real('alerts');
    const context = await contextFor({});
    const page = await context.newPage();
    await page.goto(`${r.base}/settings`);
    await waitOrReport(page, '[data-testid="row-alerts-sent"]');
    await untilAnswered(page);
    const counts = outboxCounts(r.life.h.db);
    expect(counts.notSent).toBe(1);
    expect(await textAt(page, 'row-alerts-sent')).toContain(alertsRowText(counts));
    await page.getByTestId('row-alerts-sent').click();
    await waitOrReport(page, '[data-testid="alerts-list"]');
    await untilAnswered(page);
    expect(new URL(page.url()).pathname).toBe('/alerts');
    expect(await page.title()).toBe('Alerts · Budget');
    expect(await page.getByTestId('tab-settings').getAttribute('aria-current')).toBe('page');
    await page.getByTestId('back').click();
    await waitOrReport(page, '[data-testid="row-alerts-sent"]');
    await untilAnswered(page);
    expect(new URL(page.url()).pathname).toBe('/settings');
    await context.close();
  });

  it('10.3 every state is there: loading, the list; none yet; before setup day; an error, and Try again brings the list', async () => {
    const context = await contextFor({});
    const page = await context.newPage();
    const letGo = await holdAlerts(page);
    await page.goto(`${real('alerts').base}/alerts`);
    await waitOrReport(page, '[data-testid="alerts-loading"]');
    expect(await page.locator('main').getAttribute('aria-busy')).toBe('true');
    await letGo();
    await waitOrReport(page, '[data-testid="alerts-list"]');
    expect(await page.locator('main').getAttribute('aria-busy')).toBe('false');
    await page.close();

    for (const [which, testId, words] of [
      ['none', 'alerts-empty', 'No alerts yet'],
      ['not-set-up', 'alerts-not-set-up', 'Alerts start once setup day is done.'],
    ] as const) {
      const other = await contextFor({}, which);
      const none = await other.newPage();
      await openAlerts(none, real(which).base, `[data-testid="${testId}"]`);
      expect(await textAt(none, testId)).toContain(words);
      await other.close();
    }

    const broken = await context.newPage();
    let fail = true;
    await broken.route('**/api/alerts', (route) => (fail ? route.fulfill({ status: 500, body: 'no' }) : route.continue()));
    await openAlerts(broken, real('alerts').base, '[data-testid="alerts-error"]');
    expect(await textAt(broken, 'alerts-error')).toContain("Couldn't load the alerts");
    fail = false;
    await broken.getByTestId('retry').click();
    await waitOrReport(broken, '[data-testid="alerts-list"]');
    await untilQuiet(broken);
    await context.close();
  });

  for (const scheme of ['light', 'dark'] as const) {
    it(`readable contrast and no accessibility problems on the list, in ${scheme} mode, in every state`, async () => {
      const problems: string[] = [];
      await eachState({ colorScheme: scheme, bypassCSP: true }, async (page, where) => {
        problems.push(...(await axeViolations(page)).map((p) => `${scheme} ${where}: ${p}`));
      });
      expect(problems).toEqual([]);
    });
  }

  it('every tap target is at least 44 by 44 points, in every state', async () => {
    const small: string[] = [];
    await eachState({}, async (page, where) => {
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`${where}: ${t.what} is ${t.width}x${t.height}`);
    });
    expect(small).toEqual([]);
  });

  it('nothing sits under the notch, and the last alert ends above the tab bar', async () => {
    const off: string[] = [];
    const insets = `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`;
    await eachState({ bypassCSP: true }, async (page, where) => {
      await addStyle(page, insets);
      const first = await page.locator('main *:not(.sr-only)').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0).map((b) => b.top)));
      if (first < IPHONE_INSETS.top) off.push(`${where}: the first thing is at ${first}, under the notch`);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const last = await page.locator('main *:not(.sr-only)').evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0).map((b) => b.bottom)));
      const bar = await page.locator('.tabbar').boundingBox();
      if (bar === null) off.push(`${where}: no tab bar`);
      else if (last > bar.y + 0.5) off.push(`${where}: the last thing ends at ${last}, under the tab bar at ${bar.y}`);
      if (bar !== null && bar.y + bar.height > IPHONE.height + 0.5) off.push(`${where}: the tab bar ends at ${bar.y + bar.height}`);
    });
    expect(off).toEqual([]);
  });

  it("the text grows with the phone's text size, and the list still fits", async () => {
    const off: string[] = [];
    await eachState({ bypassCSP: true }, async (page, where) => {
      const size = (): Promise<number> => page.locator('main').evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      const before = await size();
      await addStyle(page, 'html { font-size: 36px !important; }');
      const after = await size();
      if (!(after > before * 1.8)) off.push(`${where}: the text went from ${before} to ${after} only`);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      if (width > IPHONE.width) off.push(`${where}: the page is ${width} wide`);
      for (const right of await page.locator('main *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
        if (right > IPHONE.width + 0.5) {
          off.push(`${where}: something ends at ${right}`);
          break;
        }
      }
    });
    expect(off).toEqual([]);
  });

  it('with reduced motion on, the loading list does not shimmer', async () => {
    const still = await contextFor({ reducedMotion: 'reduce' });
    const page = await still.newPage();
    const letGo = await holdAlerts(page);
    await page.goto(`${real('alerts').base}/alerts`);
    await waitOrReport(page, '[data-testid="alerts-loading"]');
    const shimmer = await page.locator('.skeleton').evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
    expect(shimmer.length).toBeGreaterThan(0);
    expect(shimmer.every((name) => name === 'none')).toBe(true);
    await letGo();
    await still.close();
    const moving = await contextFor({});
    const shimmering = await moving.newPage();
    const letGoToo = await holdAlerts(shimmering);
    await shimmering.goto(`${real('alerts').base}/alerts`);
    await waitOrReport(shimmering, '[data-testid="alerts-loading"]');
    const names = await shimmering.locator('.skeleton').evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
    expect(names.some((name) => name !== 'none')).toBe(true);
    await letGoToo();
    await moving.close();
  });
});
