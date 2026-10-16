import type { Server } from 'node:http';
import type { BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { lifeInAFile, setUpThroughTheDesk, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { statusLines } from '../../src/screens/status-text.js';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, WEB_ROOT, close, emulatePhone, listen, phone, textAt, untilAnswered, untilQuiet, useEngine, waitOrReport } from './harness.js';

// Rule 0.7 (QUESTIONS.md A57): the status page on the real server, in a
// browser like a person would use it: opened from Settings, every line what
// the server's books say, what needs a look said in words with an icon, no
// amounts; its loading and error states; and the design rules. In Chromium
// (his own tests for the screens he touched, his rule of Oct 14). Every name
// and number is made up.

const C = ACCOUNT_IDS.checking;

interface Real {
  readonly life: Life;
  readonly server: Server;
  base: string;
}

async function serve(life: Life): Promise<Real> {
  const real: Real = { life, server: undefined as unknown as Server, base: '' };
  (real as { server: Server }).server = life.keeper.server(WEB_ROOT, () => real.base);
  real.base = await listen(real.server);
  return real;
}

// All working: set up, read twice, nothing waiting.
async function working(): Promise<Life> {
  const life = await lifeInAFile();
  life.now = new Date('2026-10-02T13:00:00Z');
  await life.sync();
  setUpThroughTheDesk(life);
  life.now = new Date('2026-10-02T14:00:00Z');
  await life.sync();
  return life;
}

// Things to look at: a difference with the bank, then a sync that failed.
async function troubled(): Promise<Life> {
  const life = await working();
  life.now = new Date('2026-10-02T15:00:00Z');
  life.h.fake.drift(C, -4_210);
  await life.sync();
  life.now = new Date('2026-10-02T16:00:00Z');
  life.h.fake.beforeCall = () => 'network';
  await life.sync().catch(() => undefined);
  life.h.fake.beforeCall = undefined;
  return life;
}

async function openStatus(page: Page, base: string, selector = '[data-testid="status-summary"]'): Promise<void> {
  await page.goto(`${base}/status`);
  await waitOrReport(page, selector);
  await untilAnswered(page);
}

const chromiumOnly = ENGINES.filter(([name]) => name === 'chromium');

describe.runIf(chromiumOnly.length > 0)('0.7 the status page, on the real server, in chromium', () => {
  const { browser } = useEngine(chromium);
  const servers: { working?: Real; troubled?: Real } = {};
  beforeAll(async () => {
    servers.working = await serve(await working());
    servers.troubled = await serve(await troubled());
  });
  afterAll(async () => {
    for (const real of Object.values(servers)) {
      await close(real.server);
      real.life.done();
    }
  });
  const real = (which: 'working' | 'troubled'): Real => {
    const r = servers[which];
    if (r === undefined) throw new Error('no server yet');
    return r;
  };
  async function contextFor(which: 'working' | 'troubled', options: Parameters<typeof phone>[0] = {}): Promise<BrowserContext> {
    const r = real(which);
    const context = await browser().newContext(phone(options));
    await context.addCookies([loginCookieForTests(r.life.h.db, r.life.now, r.base)]);
    return context;
  }

  it('0.7 Settings\' Bank card has a Status row that opens the page; back goes to Settings', async () => {
    const r = real('working');
    const context = await contextFor('working');
    const page = await context.newPage();
    await page.goto(`${r.base}/settings`);
    await waitOrReport(page, '[data-testid="row-status"]');
    await untilAnswered(page);
    await page.getByTestId('row-status').click();
    await waitOrReport(page, '[data-testid="status-summary"]');
    expect(new URL(page.url()).pathname).toBe('/status');
    expect(await page.title()).toBe('Status · Budget');
    await untilAnswered(page);
    await page.getByTestId('back').click();
    await waitOrReport(page, '[data-testid="row-status"]');
    expect(new URL(page.url()).pathname).toBe('/settings');
    await untilQuiet(page);
    await context.close();
  });

  for (const which of ['working', 'troubled'] as const) {
    it(`0.7 every line is what the server's books say (${which}), what needs a look said in words and with an icon, and no amounts`, async () => {
      const r = real(which);
      const view = r.life.keeper.statusView();
      const lines = statusLines(view);
      const context = await contextFor(which);
      const page = await context.newPage();
      await openStatus(page, r.base);
      for (const line of lines) {
        expect(await textAt(page, `status-${line.id}`)).toBe(`${line.title} ${line.detail}`);
        const icon = await page.getByTestId(`status-${line.id}`).locator('[data-icon]').first().getAttribute('data-icon');
        expect(icon === 'alert', line.id).toBe(line.look);
      }
      const looks = lines.filter((l) => l.look).length;
      expect(await textAt(page, 'status-summary')).toBe(looks === 0 ? 'All working' : `${looks} things need a look`);
      expect(await page.locator('[data-money]').count()).toBe(0);
      expect(await page.locator('main').innerText()).not.toContain('$');
      await untilQuiet(page);
      await context.close();
    });
  }

  it('0.7 by hand: the troubled server says the sync failed and the totals have not matched since 11:00 AM', async () => {
    const r = real('troubled');
    const context = await contextFor('troubled');
    const page = await context.newPage();
    await openStatus(page, r.base);
    expect(await textAt(page, 'status-last-sync')).toBe('Last sync 12:00 PM: it failed, so nothing changed. It is tried again at the next time.');
    expect(await textAt(page, 'status-last-read')).toBe('Bank last read 11:00 AM');
    expect(await textAt(page, 'status-difference')).toBe('Daily check The totals have not matched the bank since 11:00 AM.');
    expect(await textAt(page, 'status-backups')).toBe('Backups None on this computer.');
    await untilQuiet(page);
    await context.close();
  });

  it('0.7 loading, then the page; an error says so, with Try again', async () => {
    const r = real('working');
    const context = await contextFor('working', { reducedMotion: 'reduce' });
    const page = await context.newPage();
    let letGo: () => void = () => undefined;
    const held = new Promise<void>((done) => {
      letGo = done;
    });
    await page.route('**/api/status', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${r.base}/status`);
    await waitOrReport(page, '[data-testid="status-loading"]');
    letGo();
    await waitOrReport(page, '[data-testid="status-summary"]');
    await untilQuiet(page);
    await page.unrouteAll({ behavior: 'wait' });
    await page.route('**/api/status', (route) => route.fulfill({ status: 500, body: 'no' }));
    await page.goto(`${r.base}/status`);
    await waitOrReport(page, '[data-testid="status-error"]');
    await untilQuiet(page);
    await page.unrouteAll({ behavior: 'wait' });
    await page.getByTestId('retry').click();
    await waitOrReport(page, '[data-testid="status-summary"]');
    await untilQuiet(page);
    await context.close();
  });

  it('0.7 design rules: contrast in light and dark, 44-point taps, below the notch and clear of the tabs, and the largest text size', async () => {
    const problems: string[] = [];
    const context = await contextFor('troubled', { colorScheme: 'light', bypassCSP: true });
    const page = await context.newPage();
    await openStatus(page, real('troubled').base);
    for (const scheme of ['light', 'dark'] as const) {
      await emulatePhone(page, { colorScheme: scheme });
      problems.push(...(await axeViolations(page)).map((p) => `${scheme}: ${p}`));
    }
    for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) problems.push(`${t.what} is ${t.width}x${t.height}`);
    await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
    const first = await page.locator('main > :not(.sr-only):not(dialog)').first().boundingBox();
    expect(first!.y).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bar = await page.locator('.tabbar').boundingBox();
    const last = await page.locator('main > :not(.sr-only):not(dialog)').last().boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y);
    await addStyle(page, 'html { font-size: 36px !important; }');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
    for (const right of await page.locator('main *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(right).toBeLessThanOrEqual(IPHONE.width + 0.5);
    await untilQuiet(page);
    await context.close();
    expect(problems).toEqual([]);
  });
});
