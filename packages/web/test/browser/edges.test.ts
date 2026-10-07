import type { Server } from 'node:http';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { START_DATE, appSide, openTestBook, purchase } from '../../../money/test/helpers.js';
import { createAppServer } from '../../../server/src/http/server.js';
import { homeView, type HomeInput } from '../../../server/src/views/home.js';
import { ENGINES, WEB_ROOT, centsAt, close, listen, phone } from './harness.js';

// Edges the made-up lives do not reach, each from a book built here with the
// money math. Found by the break-it check.

// One purchase with no rule: exactly one thing waits in review.
function oneWaiting(): HomeInput {
  const book = openTestBook({ pots: { wants: 10_000 } });
  book.receive(purchase('p1', START_DATE, 1, 'NO RULE SHOP'));
  return { today: START_DATE, book, bank: { checking: appSide(book.pots()), savings: 0, everydayCard: 0 }, needsLogin: false, statements: [], madeUpData: true };
}

describe.each(ENGINES)('edges on Home in %s', (_name, engine) => {
  let server: Server;
  let base = '';
  let browser: Browser;
  beforeAll(async () => {
    server = createAppServer({ webRoot: WEB_ROOT, home: () => homeView(oneWaiting()) });
    base = await listen(server);
    browser = await engine.launch();
  });
  afterAll(async () => {
    await browser?.close();
    await close(server);
  });

  it('10.3 one item waiting: the row says 1 and the Review tab shows a 1', async () => {
    const context = await browser.newContext(phone());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(`${base}/home`);
    await page.getByTestId('safe-to-spend').waitFor();
    expect(await page.getByTestId('attention-review').locator('.row__title').innerText()).toBe('1 waiting in review');
    expect(await centsAt(page, 'held-back')).toBe(1);
    expect(await page.getByTestId('review-badge').innerText()).toBe('1');
    // 11.1: one cent held back.
    expect(await centsAt(page, 'safe-to-spend')).toBe(9_999);
    await context.close();
  });

  it('an error from the server is never shown as numbers, even when it looks like them', async () => {
    const context = await browser.newContext(phone());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    // Something in the way (a proxy, say) answers with an error, but with
    // a body that looks like Home's numbers.
    const looksRight = JSON.stringify(homeView(oneWaiting()));
    await page.route('**/api/home', (route) => route.fulfill({ status: 503, body: looksRight, contentType: 'application/json' }));
    await page.goto(`${base}/home`);
    await page.getByTestId('home-error').waitFor();
    expect(await page.locator('[data-money]').count()).toBe(0);
    await context.close();
  });
});
