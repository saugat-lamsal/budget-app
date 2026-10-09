import type { Page, Request, Route } from 'playwright';
import { describe, expect, it } from 'vitest';
import { ENGINES, centsAt, phone, useEngine, watchPage } from './harness.js';

// Loading Home's numbers (design rules: every screen has a loading, an
// empty, and an error state, and loading always ends in one of the others).
// Found on CI: WebKit on Linux reports the page as becoming visible as it
// opens. Home took that as "back in the app", cancelled the request still
// on its way and sent it again, and that WebKit then never delivered the
// answer, so Home stayed loading for good. Now a request is never
// cancelled, a refresh happens only after the app was really away, and no
// answer within the time limit shows the error with Try again.

const TIME_LIMIT_MS = 15_000;

// Holds /api/home until released, counting the requests.
async function holdHome(page: Page): Promise<{ readonly count: () => number; readonly release: () => Promise<void> }> {
  const held: Route[] = [];
  let count = 0;
  let releasing = false;
  await page.route('**/api/home', async (route) => {
    count += 1;
    if (releasing) await route.continue();
    else held.push(route);
  });
  return {
    count: () => count,
    release: async () => {
      releasing = true;
      for (const route of held.splice(0)) await route.continue();
    },
  };
}

// What a phone does when the app goes to the background and comes back.
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

describe.each(ENGINES)('loading Home in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  async function open(): Promise<{ page: Page; failed: Request[] }> {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await watchPage(page);
    const failed: Request[] = [];
    page.on('requestfailed', (r) => failed.push(r));
    // Picks the made-up life without loading Home yet.
    await context.request.get(`${base()}/demo/normal`, { maxRedirects: 0 }).catch(() => undefined);
    const cookies = await context.request.storageState();
    await context.addCookies(cookies.cookies);
    return { page, failed };
  }

  it('the page saying it is visible as it opens does not cancel the load or send it twice', async () => {
    const { page, failed } = await open();
    const home = await holdHome(page);
    await page.goto(`${base()}/home`);
    await page.getByTestId('home-loading').waitFor();
    await expect.poll(() => home.count()).toBe(1);
    await setVisibility(page, 'visible');
    await setVisibility(page, 'visible');
    await page.waitForTimeout(200);
    expect(home.count()).toBe(1);
    await home.release();
    await page.getByTestId('safe-to-spend').waitFor();
    expect(home.count()).toBe(1);
    // Saying "visible" again once loaded, without ever having been hidden,
    // is not coming back to the app either.
    await setVisibility(page, 'visible');
    await page.waitForTimeout(300);
    expect(home.count()).toBe(1);
    expect(failed.map((r) => r.url())).toEqual([]);
    await page.context().close();
  });

  it('coming back to the app after being away loads the numbers again, once', async () => {
    const { page } = await open();
    let count = 0;
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/home') count += 1;
    });
    await page.goto(`${base()}/home`);
    await page.getByTestId('safe-to-spend').waitFor();
    const before = count;
    await setVisibility(page, 'hidden');
    expect(count).toBe(before);
    await setVisibility(page, 'visible');
    await expect.poll(() => count).toBe(before + 1);
    // The numbers stay on screen while they are fetched again.
    expect(await page.getByTestId('safe-to-spend').count()).toBe(1);
    await page.waitForLoadState('networkidle');
    expect(count).toBe(before + 1);
    await page.context().close();
  });

  it('coming back while a load is still on its way does not start another', async () => {
    const { page, failed } = await open();
    await page.goto(`${base()}/home`);
    await page.getByTestId('safe-to-spend').waitFor();
    const home = await holdHome(page);
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await expect.poll(() => home.count()).toBe(1);
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    expect(home.count()).toBe(1);
    await home.release();
    await page.waitForLoadState('networkidle');
    expect(failed.map((r) => r.url())).toEqual([]);
    await page.context().close();
  });

  it('no answer within the time limit shows the error with Try again, instead of loading for good', async () => {
    const { page } = await open();
    await page.clock.install();
    const home = await holdHome(page);
    await page.goto(`${base()}/home`);
    await page.getByTestId('home-loading').waitFor();
    // The time limit starts when the request goes out.
    await expect.poll(() => home.count()).toBe(1);
    await page.clock.runFor(TIME_LIMIT_MS - 1_000);
    expect(await page.getByTestId('home-loading').count()).toBe(1);
    await page.clock.runFor(1_000);
    await page.getByTestId('home-error').waitFor();
    expect(await page.locator('[data-money]').count()).toBe(0);
    // A late answer to the request that ran out of time does not replace
    // the error on its own; Try again asks again.
    await home.release();
    await page.waitForTimeout(300);
    expect(await page.getByTestId('home-error').count()).toBe(1);
    await page.getByTestId('retry').click();
    await page.getByTestId('safe-to-spend').waitFor();
    expect(await centsAt(page, 'safe-to-spend')).toBe(62_244);
    expect(home.count()).toBe(2);
    await page.context().close();
  });
});
