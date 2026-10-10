import type { Server } from 'node:http';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readHistory } from '../../../server/src/history/history-db.js';
import { serverLinesIn } from '../../../server/src/server-log.js';
import { ACCOUNT_IDS } from '../../../server/test/fake-plaid.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { ENGINES, WEB_ROOT, close, launch, listen, phone, readCents, textAt, untilAnswered, untilQuiet, waitOrReport } from './harness.js';

// Step 3 on the real server, in a browser like a person would use it: Home's
// "Checked at", the sync card on Settings, and a tap on Review about an item
// a sync changed after the screen showed it, which is refused with why and
// shows the item as it is now. Logged in the tests' way (login-for-tests.ts).
// Every name and number is made up.

const E = ACCOUNT_IDS.everyday;

interface Running {
  readonly life: Life;
  readonly server: Server;
  readonly base: string;
  readonly context: BrowserContext;
}

describe.each(ENGINES)('syncing on the real server in %s', (_name, engine) => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
  });

  async function realServer(): Promise<Running> {
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    life.now = noonInNewYork('2026-10-03');
    const r = { life, server: undefined as unknown as Server, base: '', context: undefined as unknown as BrowserContext };
    (r as { server: Server }).server = life.keeper.server(WEB_ROOT, () => r.base);
    r.base = await listen(r.server);
    (r as { context: BrowserContext }).context = await browser!.newContext(phone());
    await r.context.addCookies([loginCookieForTests(life.h.db, life.now, r.base)]);
    return r;
  }

  async function done(r: Running): Promise<void> {
    await r.context.close();
    await close(r.server);
    r.life.done();
  }

  const amountOf = async (page: Page, id: string): Promise<number> => readCents(await page.getByTestId(`item-${id}`).getByTestId('item-amount').innerText());

  async function open(r: Running, path: string): Promise<Page> {
    const page = await r.context.newPage();
    await page.goto(`${r.base}${path}`);
    await waitOrReport(page, 'main[aria-busy="false"], [data-testid="settings"]');
    await untilAnswered(page);
    return page;
  }

  it('Step 3 Home says when the bank was last read, in his home time zone, and moves on with each sync', async () => {
    const r = await realServer();
    try {
      await r.life.sync();
      const page = await open(r, '/home');
      expect(await textAt(page, 'checked-at')).toBe('Checked at 12:00 PM');
      r.life.now = new Date('2026-10-03T21:05:00Z');
      await r.life.sync();
      await page.reload();
      await waitOrReport(page, 'main[aria-busy="false"]');
      await untilQuiet(page);
      expect(await textAt(page, 'checked-at')).toBe('Checked at 5:05 PM');
    } finally {
      await done(r);
    }
  });

  it('Step 3 section 2 Settings: how often it syncs and when it last read the bank; changed on its sheet, it applies at once and is in the change log', async () => {
    const r = await realServer();
    try {
      await r.life.sync();
      const page = await open(r, '/settings');
      await waitOrReport(page, '[data-testid="row-sync-every"]');
      expect(await textAt(page, 'row-sync-every')).toContain('Every 60 minutes · Checked at 12:00 PM');
      await page.getByTestId('row-sync-every').click();
      await page.getByTestId('sync-minutes').fill('14');
      await page.getByTestId('sheet-save').click();
      await waitOrReport(page, '[data-testid="sheet-problem"]');
      expect(await textAt(page, 'sheet-problem')).toBe('Syncing with the bank takes a whole number of minutes, 15 to 1,440. Nothing was changed.');
      await page.getByTestId('sync-minutes').fill('30');
      await page.getByTestId('sheet-save').click();
      await waitOrReport(page, '[data-testid="notice"]');
      await untilQuiet(page);
      expect(await textAt(page, 'notice')).toContain('Sync with the bank: every 30 minutes, from now on.');
      expect(r.life.keeper.syncEveryMinutes()).toBe(30);
      expect(await textAt(page, 'row-sync-every')).toContain('Every 30 minutes');
      expect(serverLinesIn(r.life.h.db).at(-1)).toMatchObject({ action: 'sync-every-changed', before: 60, after: 30 });
      expect(await textAt(page, 'log')).toContain('Every 60 minutes → every 30 minutes');
    } finally {
      await done(r);
    }
  });

  it('Step 3 13.7 A31 a tap on Review about an item a sync changed since the screen showed it: refused with how it is now, nothing changed, and the screen shows it as it is', async () => {
    const r = await realServer();
    try {
      r.life.h.fake.addPending({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-03', description: 'MADE UP CAFE' });
      await r.life.sync();
      const page = await open(r, '/review');
      await waitOrReport(page, '[data-testid="item-cafe-1"]');
      expect(await amountOf(page, 'cafe-1')).toBe(1_150);
      // The bank posts it with a tip, and a sync reads it, while Review stays open.
      r.life.h.fake.postPending('cafe-1', { id: 'cafe-1-posted', date: '2026-10-04', amount: 1_350 });
      await r.life.sync();
      const events = readHistory(r.life.h.db).length;
      await page.getByTestId('item-cafe-1').getByTestId('pick-wants').click();
      await waitOrReport(page, '[data-testid="notice"]');
      await untilQuiet(page);
      expect((await page.getByTestId('notice').locator('.notice__text').innerText()).trim()).toBe('MADE UP CAFE changed since you looked: it is now $13.50. Look at it again, then choose. Nothing was changed.');
      expect(await page.getByTestId('notice').getAttribute('role')).toBe('alert');
      expect(readHistory(r.life.h.db)).toHaveLength(events);
      expect(r.life.keeper.book()?.pots().wants).toBe(20_000);
      // The screen asked for its numbers again: the cafe as it is now.
      await waitOrReport(page, '[data-testid="item-cafe-1"]');
      expect(await amountOf(page, 'cafe-1')).toBe(1_350);
      await page.getByTestId('item-cafe-1').getByTestId('pick-wants').click();
      await expect.poll(() => r.life.keeper.book()?.pots().wants).toBe(20_000 - 1_350);
      await untilQuiet(page);
    } finally {
      await done(r);
    }
  });
});
