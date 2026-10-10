import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POT_SLUGS } from '../../../server/src/views/activity.js';
import { readHistory } from '../../../server/src/history/history-db.js';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from '../../../server/test/keeper-harness.js';
import { ENGINES, WEB_ROOT, close, launch, listen, phone, untilAnswered, untilQuiet, waitOrReport } from './harness.js';

// The real server (npm run serve), used in a browser like a person would:
// its books in a database file, a made-up bank. In the middle of a pay
// period, with answers given on the screens and through the server, the
// server is stopped and started again from the database, and every number on
// every screen is as it was. Every name and number is made up.

const E = ACCOUNT_IDS.everyday;
const C = ACCOUNT_IDS.checking;
const SCREENS = ['/home', '/buckets', '/review', '/payday', '/settings', ...Object.keys(POT_SLUGS).map((slug) => `/buckets/${slug}`)];

// What a person reads on one screen, once it has its numbers.
async function readScreen(page: Page, base: string, path: string): Promise<string> {
  await page.goto(`${base}${path}`);
  await waitOrReport(page, 'main[aria-busy="false"], [data-testid="settings"]');
  await untilAnswered(page);
  await untilQuiet(page);
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim();
}

async function readAll(page: Page, base: string): Promise<Record<string, string>> {
  const read: Record<string, string> = {};
  for (const path of SCREENS) read[path] = await readScreen(page, base, path);
  return read;
}

// The middle of a pay period: set up Oct 1, a paycheck Oct 9, spending
// before and after it, some of it sorted, one answer still to give.
async function midPeriod(life: Life): Promise<void> {
  setUpThroughTheDesk(life);
  const k = life.keeper;
  const ask = (answer: { readonly ok: boolean }, what: string): void => {
    if (!answer.ok) throw new Error(`${what}: ${JSON.stringify(answer)}`);
  };
  const id = decision();
  const asked = k.settingsChange({ id, settings: { paycheckRule: { contains: 'MADEUP CORP PAYROLL' } } });
  if (asked.ok || asked.preview === undefined) throw new Error('the paycheck rule did not ask first');
  ask(k.settingsChange({ id, settings: { paycheckRule: { contains: 'MADEUP CORP PAYROLL' } }, confirmed: true, seen: asked.preview.key }), 'the paycheck rule');
  life.now = noonInNewYork('2026-10-04');
  life.h.fake.addPosted({ id: 'store-1', account: E, amount: 2_345, date: '2026-10-03', description: 'CORNER STORE 12' });
  life.h.fake.addPosted({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-04', description: 'MADE UP CAFE' });
  await life.sync();
  ask(k.choice({ id: decision(), item: 'store-1', choice: { to: 'needs' } }), 'sorting');
  life.now = noonInNewYork('2026-10-12');
  life.h.fake.addPosted({ id: 'pay-1', account: C, amount: -250_000, date: '2026-10-09', description: 'MADEUP CORP PAYROLL' });
  life.h.fake.addPosted({ id: 'books-1', account: E, amount: 4_210, date: '2026-10-11', description: 'MADE UP BOOKSHOP' });
  await life.sync();
  ask(k.move({ id: decision(), move: { from: 'wants', to: 'needs', amount: 1_000 } }), 'the move');
}

describe.each(ENGINES)('the real server, restarted, in %s', (_name, engine) => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('restarted in the middle of a pay period, it finds every number on every screen as it was, the tap given on the screen included', async () => {
    const life = await lifeInAFile();
    let server: Server | undefined;
    try {
      await midPeriod(life);
      let base = '';
      server = life.keeper.server(WEB_ROOT, () => base);
      base = await listen(server);
      const context = await browser!.newContext(phone());
      // Logged in the tests' way (Step 2): a login written into the test's own database.
      await context.addCookies([loginCookieForTests(life.h.db, life.now, base)]);
      const page = await context.newPage();
      // A tap on Review: the bookshop goes to wants.
      await readScreen(page, base, '/review');
      await page.getByTestId('item-books-1').getByTestId('pick-wants').click();
      await page.getByTestId('notice').waitFor();
      await untilQuiet(page);
      expect(life.keeper.book()?.purchases().find((p) => p.id === 'books-1')?.sortedTo).toEqual({ to: 'wants' });
      const before = await readAll(page, base);
      expect(before['/home']).toContain('days');
      expect(before['/review']).toContain('MADE UP CAFE');

      // Stopped, and started again from the database file.
      await close(server);
      server = undefined;
      const events = readHistory(life.h.db).length;
      life.restart();
      server = life.keeper.server(WEB_ROOT, () => base);
      base = await listen(server);
      const after = await readAll(page, base);
      for (const path of SCREENS) expect(after[path], path).toBe(before[path]);
      expect(readHistory(life.h.db)).toHaveLength(events);
      await context.close();
    } finally {
      if (server !== undefined) await close(server);
      life.done();
    }
  });
});
