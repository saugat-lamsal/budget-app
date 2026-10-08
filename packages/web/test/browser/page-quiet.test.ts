import type { BrowserContext } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { ENGINES, close, openScenario, phone, useEngine } from './harness.js';
import { openLive, startLive } from './live.js';

// The helpers the browser tests open pages with hand back a page that is
// quiet: everything it asked for has been answered. Home's numbers are asked
// for on every screen, so a test that looks at Buckets can be given the page
// while Home's request is still on its way, and a test that then closes the
// page cancels it. WebKit as Playwright builds it (Linux CI, Oct 8) then
// stalls the next page the test opens. Home's answer is slowed down here, so
// the helper has to wait for it.

// Slows every answer to /api/home down, and counts what was asked and answered.
async function slowHome(context: BrowserContext): Promise<{ asked: () => number; answered: () => number }> {
  let asked = 0;
  let answered = 0;
  context.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/home') asked += 1;
  });
  context.on('requestfinished', (r) => {
    if (new URL(r.url()).pathname === '/api/home') answered += 1;
  });
  await context.route('**/api/home', async (route) => {
    await new Promise((done) => setTimeout(done, 700));
    await route.continue();
  });
  return { asked: () => asked, answered: () => answered };
}

describe.each(ENGINES)('a page the tests open is quiet when they get it, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('openScenario hands back a page whose Home request has been answered, even for another screen', async () => {
    const context = await browser().newContext(phone());
    const home = await slowHome(context);
    const page = await openScenario(context, base(), 'normal', '/buckets');
    expect(home.asked()).toBeGreaterThan(0);
    expect(home.answered()).toBe(home.asked());
    await page.context().close();
  });

  // Playwright says a request finished only for answers it counts as loaded; an error answer (500) is an answer all the same.
  it('a page whose numbers cannot be loaded is handed back too: an error answer is an answer', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'error', '/buckets/needs');
    expect(await page.getByTestId('activity-error').count()).toBe(1);
    await page.context().close();
  }, 8_000);

  it('openLive hands back a page whose Home request has been answered, even for another screen', async () => {
    const input = demoScenario('normal')?.input?.();
    if (input === undefined || input.book === null) throw new Error('no made-up life called normal');
    const live = await startLive({ book: input.book, bank: input.bank, today: input.today });
    try {
      const context = await browser().newContext(phone());
      const home = await slowHome(context);
      const page = await openLive(context, live.base, '/buckets');
      expect(home.asked()).toBeGreaterThan(0);
      expect(home.answered()).toBe(home.asked());
      await page.context().close();
    } finally {
      await close(live.server);
    }
  });
});
