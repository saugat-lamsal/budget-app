import type { Server } from 'node:http';
import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenBox } from '../../../server/src/crypto/token-box.js';
import { openDatabase } from '../../../server/src/db/database.js';
import { readAccounts, readConnection } from '../../../server/src/db/store.js';
import { Keeper, type SyncBank } from '../../../server/src/history/keeper.js';
import { memoryLog } from '../../../server/src/log.js';
import { PlaidClient } from '../../../server/src/plaid/client.js';
import { plaidKeysFromEnv } from '../../../server/src/plaid/sandbox-lock.js';
import { serverLinesIn } from '../../../server/src/server-log.js';
import { ACCOUNT_IDS, FakePlaid, fourAccounts } from '../../../server/test/fake-plaid.js';
import { POSTED_AT_START, TOKEN_KEY } from '../../../server/test/harness.js';
import { noonInNewYork } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { axeViolations, tappable } from './design-helpers.js';
import { ENGINES, WEB_ROOT, close, launch, listen, phone, textAt, untilQuiet, waitOrReport } from './harness.js';

// Rules 1.1 to 1.3 in a browser, on the real server, with the Bank page's
// own rules on (no bypassing them). Plaid Link is Plaid's, so a stand-in for
// its script is served at its own address: it logs in at once (or is closed),
// handing back the made-up bank's link key, as the real one hands back the
// real bank's. That the stand-in runs at all shows the page's rules let
// Plaid's script in; a script from anywhere else is kept out. The real
// Link is tried by hand against Plaid's test bank (the rehearsal). Every name
// and number is made up.

const LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

interface Running {
  readonly server: Server;
  readonly base: string;
  readonly context: BrowserContext;
  readonly fake: FakePlaid;
  readonly db: ReturnType<typeof openDatabase>;
  readonly keeper: Keeper;
  readonly bank: SyncBank;
}

// What the stand-in for Link does when opened.
type LinkDoes = 'log-in' | 'close';

describe.each(ENGINES)('the Bank connection screen in %s', (_name, engine) => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
  });

  // The design checks put their own script on the page, which the Bank page's
  // rules keep out: they run with the rules bypassed, as on every other page.
  async function realServer(link: { does: LinkDoes } = { does: 'log-in' }, colorScheme: 'light' | 'dark' = 'light', bypassCSP = false): Promise<Running> {
    const db = openDatabase(':memory:');
    const fake = new FakePlaid(fourAccounts(POSTED_AT_START));
    const log = memoryLog([], [fake.clientId, fake.secret]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    const now = noonInNewYork('2026-10-01');
    const keeper = Keeper.open({ db, now: () => now, log });
    const bank: SyncBank = { plaid, box: new TokenBox(TOKEN_KEY), log, pageSize: 3 };
    const r = { server: undefined as unknown as Server, base: '', context: undefined as unknown as BrowserContext, fake, db, keeper, bank };
    (r as { server: Server }).server = keeper.server(WEB_ROOT, () => r.base, undefined, { bank });
    r.base = await listen(r.server);
    (r as { context: BrowserContext }).context = await browser!.newContext(phone({ colorScheme, bypassCSP }));
    await r.context.addCookies([loginCookieForTests(db, now, r.base)]);
    await r.context.route(LINK_SCRIPT, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `window.__linkOpened = 0;
window.Plaid = { create(config) { return { open() {
  window.__linkOpened += 1; window.__linkToken = config.token;
  setTimeout(() => ${link.does === 'log-in' ? `config.onSuccess(${JSON.stringify(fake.publicToken)}, {})` : 'config.onExit(null, {})'}, 20);
}, destroy() {} }; } };`,
      }),
    );
    // A script from anywhere else: the page's rules must keep it out.
    await r.context.route('https://elsewhere.example/**', (route) => route.fulfill({ contentType: 'text/javascript', body: 'window.__elsewhere = true;' }));
    return r;
  }

  async function done(r: Running): Promise<void> {
    await r.context.close();
    await close(r.server);
    r.db.close();
  }

  async function open(r: Running, path: string): Promise<Page> {
    const page = await r.context.newPage();
    await page.goto(`${r.base}${path}`);
    await waitOrReport(page, 'main[aria-busy="false"]');
    await untilQuiet(page);
    return page;
  }

  async function connect(page: Page): Promise<void> {
    await page.getByTestId('bank-connect').click();
    await waitOrReport(page, '[data-testid="bank-ask"]');
    await page.getByTestId('bank-ask-yes').click();
    await waitOrReport(page, '[data-testid="bank-said"]');
    await untilQuiet(page);
  }

  async function pickAll(page: Page): Promise<void> {
    for (const [role, id] of [['checking', ACCOUNT_IDS.checking], ['savings', ACCOUNT_IDS.savings], ['everyday-card', ACCOUNT_IDS.everyday], ['old-card', ACCOUNT_IDS.old]] as const) {
      await page.getByTestId(`bank-pick-${role}`).click();
      await waitOrReport(page, '[data-testid="bank-pick-sheet"]');
      await page.getByTestId(`bank-pick-account-${id}`).click();
      await page.getByTestId('bank-pick-sheet').waitFor({ state: 'detached' });
    }
  }

  it('1.1 from Settings the Bank screen opens as a page of its own, with Link\'s address and nonce; no other page has them', async () => {
    const r = await realServer();
    try {
      const page = await open(r, '/settings');
      expect(await page.locator('meta[name="plaid-link"]').count()).toBe(0);
      await page.getByTestId('row-bank-connection').click();
      await page.waitForURL(`${r.base}/bank`);
      await waitOrReport(page, '[data-testid="bank-connect-card"]');
      expect(await page.locator('meta[name="plaid-link"]').getAttribute('content')).toBe(LINK_SCRIPT);
      expect(await page.locator('meta[name="plaid-nonce"]').getAttribute('content')).toMatch(/^[A-Za-z0-9+/=]{22,}$/);
      expect(await textAt(page, 'bank-connect-card')).toContain('1 of the 10 connections Plaid allows');
      expect(await textAt(page, 'bank-connect-card')).toContain("Plaid's test bank");
      // Leaving it, the next page is a page of its own again, with the strict rules.
      await page.getByTestId('back').click();
      await page.waitForURL(`${r.base}/settings`);
      await waitOrReport(page, 'main[aria-busy="false"]');
      expect(await page.locator('meta[name="plaid-link"]').count()).toBe(0);
    } finally {
      await done(r);
    }
  });

  it('1.1 connecting asks first, opens the bank\'s login, and keeps the connection; nothing is connected before his yes', async () => {
    const r = await realServer();
    try {
      const page = await open(r, '/bank');
      await page.getByTestId('bank-connect').click();
      await waitOrReport(page, '[data-testid="bank-ask"]');
      expect(await textAt(page, 'bank-ask')).toContain('1 of the 10 connections Plaid allows, and one that is removed never comes back');
      expect(await page.evaluate(() => (window as { __linkOpened?: number }).__linkOpened ?? 0)).toBe(0);
      expect(readConnection(r.db)).toBeNull();
      await page.getByTestId('bank-ask-yes').click();
      await waitOrReport(page, '[data-testid="bank-said"]');
      await untilQuiet(page);
      expect(await textAt(page, 'bank-said')).toBe('The bank is connected. Now say which account is which.');
      expect(await page.evaluate(() => (window as { __linkToken?: string }).__linkToken)).toMatch(/^link-sandbox-/);
      expect(readConnection(r.db)).not.toBeNull();
      expect(r.fake.calls.filter((c) => c.endpoint === '/item/public_token/exchange')).toHaveLength(1);
      await waitOrReport(page, '[data-testid="bank-pick"]');
      // The bank key is never on the page.
      expect(await page.content()).not.toContain(r.fake.accessToken);
    } finally {
      await done(r);
    }
  });

  it('1.1 closing the bank\'s login connects nothing, and says so', async () => {
    const r = await realServer({ does: 'close' });
    try {
      const page = await open(r, '/bank');
      await connect(page);
      expect(await textAt(page, 'bank-said')).toBe('Nothing was connected.');
      expect(readConnection(r.db)).toBeNull();
      expect(await page.getByTestId('bank-connect').isVisible()).toBe(true);
    } finally {
      await done(r);
    }
  });

  it('1.2 the four are picked on the screen and kept after his yes; then the bank is read', async () => {
    const r = await realServer();
    try {
      const page = await open(r, '/bank');
      await connect(page);
      await waitOrReport(page, '[data-testid="bank-pick"]');
      expect(await page.getByTestId('bank-pick-save').isDisabled()).toBe(true);
      await pickAll(page);
      await page.getByTestId('bank-pick-save').click();
      await waitOrReport(page, '[data-testid="bank-keep"]');
      expect(await textAt(page, 'bank-keep')).toContain('Once tracking starts, which account is which cannot change');
      expect(readAccounts(r.db).every((a) => a.role === null)).toBe(true);
      await page.getByTestId('bank-keep-yes').click();
      await waitOrReport(page, '[data-testid="bank-role-old-card"]');
      await untilQuiet(page);
      expect(Object.fromEntries(readAccounts(r.db).map((a) => [a.role, a.plaidAccountId]))).toEqual({ checking: ACCOUNT_IDS.checking, savings: ACCOUNT_IDS.savings, 'everyday-card': ACCOUNT_IDS.everyday, 'old-card': ACCOUNT_IDS.old });
      expect(await textAt(page, 'bank-role-old-card')).toContain('Made-up Old Card ••4444');
      expect(r.fake.calls.some((c) => c.endpoint === '/transactions/sync')).toBe(true);
      expect(serverLinesIn(r.db).map((l) => l.action)).toEqual(['bank-connected', 'bank-accounts']);
    } finally {
      await done(r);
    }
  });

  it('1.2 an account picked for a second role leaves the first: each is only one of the four', async () => {
    const r = await realServer();
    try {
      const page = await open(r, '/bank');
      await connect(page);
      await page.getByTestId('bank-pick-checking').click();
      await page.getByTestId(`bank-pick-account-${ACCOUNT_IDS.checking}`).click();
      await page.getByTestId('bank-pick-sheet').waitFor({ state: 'detached' });
      await page.getByTestId('bank-pick-savings').click();
      await page.getByTestId(`bank-pick-account-${ACCOUNT_IDS.checking}`).click();
      await page.getByTestId('bank-pick-sheet').waitFor({ state: 'detached' });
      expect(await textAt(page, 'bank-pick-checking')).toContain('Pick one');
      expect(await textAt(page, 'bank-pick-savings')).toContain('Made-up Checking ••1111');
    } finally {
      await done(r);
    }
  });

  it('1.3 10.5 logging in again from the Bank screen: the same connection, the bank read again, the login no longer asked for', async () => {
    const r = await realServer();
    try {
      const desk = r.keeper.bankDesk(r.bank);
      await desk.link({ mode: 'connect', yes: true });
      await desk.connected({ publicToken: r.fake.publicToken });
      desk.roles({ roles: { checking: ACCOUNT_IDS.checking, savings: ACCOUNT_IDS.savings, 'everyday-card': ACCOUNT_IDS.everyday, 'old-card': ACCOUNT_IDS.old }, yes: true });
      await desk.read();
      r.fake.needsLogin = true;
      await r.keeper.sync(r.bank);
      const page = await open(r, '/bank');
      await waitOrReport(page, '[data-testid="bank-needs-login"]');
      r.fake.needsLogin = false;
      await page.getByTestId('bank-login-again').click();
      await waitOrReport(page, '[data-testid="bank-said"]');
      await untilQuiet(page);
      expect(await textAt(page, 'bank-said')).toBe('Logged in again. The bank was read.');
      expect(await page.getByTestId('bank-needs-login').count()).toBe(0);
      expect(r.fake.calls.filter((c) => c.endpoint === '/item/public_token/exchange')).toHaveLength(1);
      expect(serverLinesIn(r.db).at(-1)).toMatchObject({ action: 'bank-logged-in-again' });
    } finally {
      await done(r);
    }
  });

  // A nonce lets in any script that carries it (Plaid's way); one put on the
  // page without it, from anywhere but Plaid's address, is kept out.
  it('1.1 the Bank page\'s rules keep out a script without the page\'s nonce from anywhere but Plaid\'s address', async () => {
    const r = await realServer();
    try {
      const page = await open(r, '/bank');
      const loaded = await page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const s = document.createElement('script');
            s.src = 'https://elsewhere.example/script.js';
            s.onload = () => resolve('loaded');
            s.onerror = () => resolve('blocked');
            document.head.append(s);
          }),
      );
      expect(loaded).toBe('blocked');
      expect(await page.evaluate(() => (window as { __elsewhere?: boolean }).__elsewhere)).toBeUndefined();
    } finally {
      await done(r);
    }
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    it(`design the Bank screen: readable contrast and 44-point taps, before and after connecting (${colorScheme})`, async () => {
      const r = await realServer({ does: 'log-in' }, colorScheme, true);
      try {
        const page = await open(r, '/bank');
        const problems: string[] = [];
        const check = async (where: string): Promise<void> => {
          for (const v of await axeViolations(page)) problems.push(`${where}: ${v}`);
          for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) problems.push(`${where}: ${t.what} is ${t.width}x${t.height}`);
        };
        await check('not connected');
        await page.getByTestId('bank-connect').click();
        await waitOrReport(page, '[data-testid="bank-ask"]');
        await check('asks first');
        await page.getByTestId('bank-ask-yes').click();
        await waitOrReport(page, '[data-testid="bank-pick"]');
        await untilQuiet(page);
        await check('picking');
        await page.getByTestId('bank-pick-checking').click();
        await waitOrReport(page, '[data-testid="bank-pick-sheet"]');
        await check('picking one');
        expect(problems).toEqual([]);
      } finally {
        await done(r);
      }
    });
  }
});
