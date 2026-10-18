import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoServer } from '../../../server/src/demo/demo-server.js';
import { OFFLINE_WORDS } from '../../src/sw/offline.js';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, WEB_ROOT, close, launch, listen, phone, untilQuiet, waitOrReport } from './harness.js';

// Rule 0.8 (QUESTIONS.md A57) in a real browser: the service worker as built,
// registered for real, and the app's server going away (every connection to
// it dropped, as when the host restarts): opening a screen shows the plain
// page instead of a blank one, its Try again opens the screen once the server
// is back, and the design rules hold on it. In Chromium (his own tests for
// the screens he touched, his rule of Oct 14; headless WebKit has no service
// worker to register). Every name and number is made up.

const chromiumOnly = ENGINES.filter(([name]) => name === 'chromium');

describe.runIf(chromiumOnly.length > 0)('0.8 the plain page when the server cannot be reached, in chromium', () => {
  let browser: Awaited<ReturnType<typeof launch>> | undefined;
  let server: Server | undefined;
  let base = '';
  // While true, every connection to the app's server is dropped.
  let down = false;
  beforeAll(async () => {
    browser = await launch(chromium);
    const app = createDemoServer({ webRoot: WEB_ROOT });
    const handle = app.listeners('request')[0] as (request: IncomingMessage, response: ServerResponse) => void;
    server = createServer((request, response) => {
      if (down) request.socket.destroy();
      else handle(request, response);
    });
    base = await listen(server);
  });
  afterAll(async () => {
    await browser?.close();
    if (server !== undefined) await close(server);
  });

  // A page of the app with the service worker in charge of it.
  async function underTheWorker(options: Parameters<typeof phone>[0] = {}): Promise<Page> {
    if (browser === undefined) throw new Error('no browser yet');
    down = false;
    const context = await browser.newContext(phone(options));
    const page = await context.newPage();
    await page.goto(`${base}/demo/normal`);
    await waitOrReport(page, 'main[aria-busy="false"]');
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await waitOrReport(page, 'main[aria-busy="false"]');
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await untilQuiet(page);
    return page;
  }

  it('0.8 the server goes away: opening a screen shows the plain page, in the rulebook\'s words, with no numbers; Try again opens the screen once it is back', async () => {
    const page = await underTheWorker();
    down = true;
    await page.goto(`${base}/buckets`);
    await waitOrReport(page, '[data-testid="offline"]');
    expect(new URL(page.url()).pathname).toBe('/buckets');
    expect((await page.locator('h1').innerText()).trim()).toBe(OFFLINE_WORDS.title);
    expect((await page.locator('p').innerText()).trim()).toBe(OFFLINE_WORDS.body);
    expect((await page.getByTestId('offline-again').innerText()).trim()).toBe(OFFLINE_WORDS.again);
    expect(await page.locator('body').innerText()).not.toMatch(/\d|\$/);
    expect(await page.locator('script').count()).toBe(0);
    // Still down: Try again shows it again.
    await page.getByTestId('offline-again').click();
    await waitOrReport(page, '[data-testid="offline"]');
    // Back: Try again opens the screen.
    down = false;
    await page.getByTestId('offline-again').click();
    await waitOrReport(page, '[data-testid="buckets"][aria-busy="false"]');
    expect(new URL(page.url()).pathname).toBe('/buckets');
    await untilQuiet(page);
    await page.context().close();
  });

  it('0.8 design rules on the plain page: readable in light and dark, Try again at least 44 points, clear of the notch, and the largest text size', async () => {
    const page = await underTheWorker({ bypassCSP: true });
    down = true;
    await page.goto(`${base}/home`);
    await waitOrReport(page, '[data-testid="offline"]');
    const problems: string[] = [];
    for (const [scheme, background] of [
      ['light', 'rgb(5, 5, 6)'],
      ['dark', 'rgb(5, 5, 6)'],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), scheme).toBe(background);
      problems.push(...(await axeViolations(page)).map((p) => `${scheme}: ${p}`));
    }
    const taps = await tappable(page);
    expect(taps.map((t) => t.what)).toEqual(['A offline-again']);
    for (const t of taps) if (t.width < 44 || t.height < 44) problems.push(`${t.what} is ${t.width}x${t.height}`);
    // The notch and the home bar: room kept at the top and bottom, beyond the phone's own insets.
    const padding = await page.locator('main').evaluate((e) => ({ top: Number.parseFloat(getComputedStyle(e).paddingTop), bottom: Number.parseFloat(getComputedStyle(e).paddingBottom) }));
    expect(padding.top).toBeGreaterThanOrEqual(24);
    expect(padding.bottom).toBeGreaterThanOrEqual(24);
    // The phone's largest text size: everything grows, nothing runs off the side, Try again still fits.
    const before = await page.locator('p').evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
    await addStyle(page, 'html { font-size: 36px !important; }');
    expect(await page.locator('p').evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThan(before * 1.8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
    for (const right of await page.locator('body *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(right).toBeLessThanOrEqual(IPHONE.width + 0.5);
    down = false;
    await page.context().close();
    expect(problems).toEqual([]);
  });

  it('0.8 the numbers never come from the worker: with the server gone, a screen asking for them gets nothing', async () => {
    const page = await underTheWorker();
    down = true;
    const asked = await page.evaluate(async () => {
      try {
        const answer = await fetch('/api/home', { cache: 'no-store' });
        return `answered ${answer.status}`;
      } catch {
        return 'failed';
      }
    });
    expect(asked).toBe('failed');
    down = false;
    await page.context().close();
  });
});
