import type { Server } from 'node:http';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverLinesIn } from '../../../server/src/server-log.js';
import { lifeInAFile, setUpThroughTheDesk, type Life } from '../../../server/test/keeper-harness.js';
import { WEB_ROOT, centsAt, close, launch, listen, phone, untilQuiet, waitOrReport } from './harness.js';

// Passkey login (Step 2) in a real browser, from the first one-time code to
// Home: Chromium with a virtual passkey (its WebAuthn testing feature), on the
// real server with its books in a file. Passkeys are made for the app's host
// name, so the page is opened at http://localhost, as npm run serve prints.
// Chromium only: WebKit has no virtual passkey. Every name and number is
// made up.

interface Running {
  readonly life: Life;
  readonly server: Server;
  readonly base: string;
}

async function realServer(): Promise<Running> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  let origin = '';
  const server = life.keeper.server(WEB_ROOT, () => origin);
  const base = (await listen(server)).replace('127.0.0.1', 'localhost');
  origin = base;
  return { life, server, base };
}

// A virtual passkey on this browser: Face ID that always says yes.
async function withPasskey(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

describe('login in chromium, with a virtual passkey', () => {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await launch(chromium);
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('login the whole thing: the first code, a passkey, Home with his numbers; log out on Settings; log in again with the passkey', async () => {
    const r = await realServer();
    const context = await browser!.newContext(phone());
    try {
      const page = await context.newPage();
      await withPasskey(context, page);
      // Not logged in: Home sends him to the login page, which asks for the code.
      await page.goto(`${r.base}/home`);
      await page.waitForURL(/\/login$/);
      await waitOrReport(page, '[data-testid="login-code"]');
      expect(await page.getByTestId('code-how').innerText()).toContain('npm run serve');
      // A wrong code is refused, in words, and nothing is made.
      await page.getByTestId('code').fill('0000-0000-0000');
      await page.getByTestId('make-passkey').click();
      await waitOrReport(page, '[data-testid="login-problem"]');
      expect(await page.getByTestId('login-problem').innerText()).toContain('That code is not right');
      // The code npm run serve printed, typed without its dashes.
      const code = r.life.keeper.loginCode();
      await page.getByTestId('code').fill(code.replaceAll('-', ''));
      await page.getByTestId('make-passkey').click();
      await page.waitForURL(/\/home$/);
      await waitOrReport(page, 'main[data-testid="home"][aria-busy="false"]');
      await untilQuiet(page);
      const home = r.life.keeper.home();
      if (home.state !== 'tracking' || !home.safeToSpend.shown) throw new Error('no safe to spend');
      expect(await centsAt(page, 'safe-to-spend')).toBe(home.safeToSpend.amount);
      expect(serverLinesIn(r.life.h.db).map((l) => l.action)).toEqual(['passkey-added', 'logged-in']);
      // The cookie: HttpOnly and SameSite=Strict.
      const cookie = (await context.cookies()).find((c) => c.name === 'budget-login');
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });

      // Log out, on Settings.
      await page.goto(`${r.base}/settings`);
      await waitOrReport(page, '[data-testid="logout"]');
      await page.getByTestId('logout').click();
      await page.waitForURL(/\/login$/);
      await waitOrReport(page, '[data-testid="login-passkey"]');
      expect((await page.evaluate(async () => (await fetch('/api/home')).status))).toBe(401);

      // Log in again: one tap, the virtual passkey answers.
      await page.getByTestId('login-passkey-button').click();
      await page.waitForURL(/\/home$/);
      await waitOrReport(page, 'main[data-testid="home"][aria-busy="false"]');
      await untilQuiet(page);
      expect(serverLinesIn(r.life.h.db).map((l) => l.action)).toEqual(['passkey-added', 'logged-in', 'logged-out', 'logged-in']);
      // The change log on Settings says so, newest first.
      await page.goto(`${r.base}/settings`);
      await waitOrReport(page, '[data-testid="log"]');
      const log = await page.getByTestId('log').innerText();
      expect(log.indexOf('Logged in')).toBeLessThan(log.indexOf('Logged out'));
      expect(log).toContain('Passkey added');
      await untilQuiet(page);
    } finally {
      await context.close();
      await close(r.server);
      r.life.done();
    }
  });

  it('login a code used once does not work again, in the browser either', async () => {
    const r = await realServer();
    const context = await browser!.newContext(phone());
    try {
      const page = await context.newPage();
      await withPasskey(context, page);
      const code = r.life.keeper.loginCode();
      await page.goto(`${r.base}/login`);
      await waitOrReport(page, '[data-testid="login-code"]');
      await page.getByTestId('code').fill(code);
      await page.getByTestId('make-passkey').click();
      await page.waitForURL(/\/home$/);
      await untilQuiet(page);
      // A second browser, no login, the same code.
      const other = await browser!.newContext(phone());
      const again = await other.newPage();
      await withPasskey(other, again);
      await again.goto(`${r.base}/login`);
      await waitOrReport(again, '[data-testid="login-passkey"]');
      await again.getByTestId('use-code').click();
      await again.getByTestId('code').fill(code);
      await again.getByTestId('make-passkey').click();
      await waitOrReport(again, '[data-testid="login-problem"]');
      expect(await again.getByTestId('login-problem').innerText()).toContain('it was used');
      await untilQuiet(again);
      await other.close();
    } finally {
      await context.close();
      await close(r.server);
      r.life.done();
    }
  });
});
