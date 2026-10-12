import type { Server } from 'node:http';
import type { BrowserContext, Page, Route } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { savePasskey } from '../../../server/src/auth/auth-db.js';
import { lifeInAFile, setUpThroughTheDesk, type Life } from '../../../server/test/keeper-harness.js';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, WEB_ROOT, close, emulatePhone, listen, phone, untilAnswered, untilQuiet, useEngine, waitOrReport } from './harness.js';

// The design rules (CLAUDE.md) for what only the real server shows, in both
// engines: the login page and Settings' Login card (Step 2), and Home's
// "Checked at" and Settings' Bank card (Step 3). Light and dark, readable
// contrast, 44-point tap targets, the notch and the home bar, the phone's text
// size and reduced-motion settings, and every state: loading, error, the code
// form, the passkey button, a refusal, and the sheets. No passkey is made or
// used here (login.test.ts does that, in Chromium): the made-up passkey below
// is only a row in the database, so the page knows one exists. Every name and
// number is made up.

interface Real {
  readonly life: Life;
  readonly server: Server;
  base: string;
}

async function realServer(withPasskey: boolean): Promise<Real> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  if (withPasskey) {
    savePasskey(life.h.db, { id: 'made-up-passkey', publicKey: new Uint8Array(65), counter: 0, transports: ['internal'], device: 'Safari on iPhone', createdAt: '2026-09-30T16:00:00.000Z' });
  }
  const real: Real = { life, server: undefined as unknown as Server, base: '' };
  (real as { server: Server }).server = life.keeper.server(WEB_ROOT, () => real.base);
  real.base = await listen(real.server);
  return real;
}

// Where a state is: the server with no passkey yet (his first), or with one.
type Which = 'first' | 'passkey';

// Opens a state; returns what lets go of anything held on purpose.
type Open = (page: Page, base: string) => Promise<(() => Promise<void>) | void>;

// The loading page's skeleton shimmers for as long as it loads, and the checks
// look at a screen at rest (design-helpers.ts atRest), so it is looked at with
// motion reduced, where the shimmer is off. Contrast and sizes are the same.
const STILL = new Set(['loading']);

async function loginPage(page: Page, base: string, selector: string): Promise<void> {
  await page.goto(`${base}/login`);
  await waitOrReport(page, selector);
  await untilAnswered(page);
}

// Holds the login page's question (are you logged in?) until let go.
async function holdAuth(page: Page): Promise<() => Promise<void>> {
  let letGo: () => void = () => undefined;
  const held = new Promise<void>((done) => {
    letGo = done;
  });
  await page.route('**/api/auth', async (route: Route) => {
    await held;
    await route.continue();
  });
  return async () => {
    letGo();
    await untilQuiet(page);
  };
}

const LOGIN_STATES: readonly (readonly [string, Which, Open])[] = [
  ['loading', 'passkey', async (page, base) => {
    const letGo = await holdAuth(page);
    await page.goto(`${base}/login`);
    await waitOrReport(page, '[data-testid="login-loading"]');
    return letGo;
  }],
  ['the error, with Try again', 'passkey', async (page, base) => {
    await page.route('**/api/auth', (route) => route.fulfill({ status: 500, body: 'no' }));
    await loginPage(page, base, '[data-testid="login-error"]');
  }],
  ['his first passkey: the code form', 'first', (page, base) => loginPage(page, base, '[data-testid="login-code"]')],
  ['a code refused, in words', 'first', async (page, base) => {
    await loginPage(page, base, '[data-testid="login-code"]');
    await page.getByTestId('code').fill('0000-0000-0000');
    await page.getByTestId('make-passkey').click();
    await waitOrReport(page, '[data-testid="login-problem"]');
    await untilQuiet(page);
  }],
  ['with a passkey: one tap', 'passkey', (page, base) => loginPage(page, base, '[data-testid="login-passkey"]')],
  ['lost passkeys: a one-time code instead', 'passkey', async (page, base) => {
    await loginPage(page, base, '[data-testid="login-passkey"]');
    await page.getByTestId('use-code').click();
    await waitOrReport(page, '[data-testid="login-code"]');
  }],
];

async function settingsPage(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/settings`);
  await waitOrReport(page, '[data-testid="login-card"]');
  await untilAnswered(page);
}

async function homePage(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/home`);
  await waitOrReport(page, '[data-testid="checked-at"]');
  await untilAnswered(page);
}

const CARD_STATES: readonly (readonly [string, Open])[] = [
  ['Home, with Checked at', (page, base) => homePage(page, base)],
  ['the Login card and the Bank card', (page, base) => settingsPage(page, base)],
  ['the sync sheet', async (page, base) => {
    await settingsPage(page, base);
    await page.getByTestId('row-sync-every').click();
    await waitOrReport(page, '[data-testid="sync-minutes"]');
  }],
  ['the sync sheet, refused', async (page, base) => {
    await settingsPage(page, base);
    await page.getByTestId('row-sync-every').click();
    await page.getByTestId('sync-minutes').fill('5');
    await page.getByTestId('sheet-save').click();
    await waitOrReport(page, '[data-testid="sheet-problem"]');
    await untilQuiet(page);
  }],
  ['the stay logged in sheet', async (page, base) => {
    await settingsPage(page, base);
    await page.getByTestId('row-stay-logged-in').click();
    await waitOrReport(page, '[data-testid="stay-days"]');
  }],
  ['the stay logged in sheet, refused', async (page, base) => {
    await settingsPage(page, base);
    await page.getByTestId('row-stay-logged-in').click();
    await page.getByTestId('stay-days').fill('400');
    await page.getByTestId('sheet-save').click();
    await waitOrReport(page, '[data-testid="sheet-problem"]');
    await untilQuiet(page);
  }],
  ['adding a passkey, asking first', async (page, base) => {
    await settingsPage(page, base);
    await page.getByTestId('row-add-passkey').click();
    await waitOrReport(page, '[data-testid="confirm-ask"]');
  }],
];

describe.each(ENGINES)('design rules on what only the real server shows (login, Checked at, the Bank card) in %s', (_engine, engine) => {
  const { browser } = useEngine(engine);
  const servers: Partial<Record<Which, Real>> = {};
  beforeAll(async () => {
    servers.first = await realServer(false);
    servers.passkey = await realServer(true);
    // The bank read once, for Checked at.
    await servers.passkey.life.sync();
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

  // A context logged out, or logged in the tests' way (a login written into
  // the test server's own database: login-for-tests.ts).
  async function contextFor(options: Parameters<typeof phone>[0], loggedIn: boolean): Promise<BrowserContext> {
    const context = await browser().newContext(phone(options));
    if (loggedIn) await context.addCookies([loginCookieForTests(real('passkey').life.h.db, real('passkey').life.now, real('passkey').base)]);
    return context;
  }

  // One page for a whole test, moved from state to state (showLive in live.ts
  // says why), each loaded afresh with its own motion setting and nothing held
  // or failed from the state before.
  async function onOnePage(options: Parameters<typeof phone>[0], run: (page: Page) => Promise<void>): Promise<void> {
    const context = await contextFor(options, false);
    try {
      await run(await context.newPage());
    } finally {
      await context.close();
    }
  }

  // Logged out throughout: nothing on the login page sets a cookie but a
  // login or a log out.
  async function eachLoginState(page: Page, options: Parameters<typeof phone>[0], check: (page: Page, where: string) => Promise<void>): Promise<void> {
    await page.context().clearCookies();
    for (const [name, which, open] of LOGIN_STATES) {
      await emulatePhone(page, STILL.has(name) ? { ...options, reducedMotion: 'reduce' } : options);
      const letGo = await open(page, real(which).base);
      await check(page, `login page: ${name}`);
      if (letGo !== undefined) await letGo();
      await page.unrouteAll({ behavior: 'wait' });
    }
  }

  // Logged in the tests' way.
  async function eachCardState(page: Page, options: Parameters<typeof phone>[0], check: (page: Page, where: string) => Promise<void>): Promise<void> {
    await page.context().addCookies([loginCookieForTests(real('passkey').life.h.db, real('passkey').life.now, real('passkey').base)]);
    await emulatePhone(page, options);
    for (const [name, open] of CARD_STATES) {
      await open(page, real('passkey').base);
      await check(page, `Settings: ${name}`);
    }
  }

  for (const scheme of ['light', 'dark'] as const) {
    it(`readable contrast and no accessibility problems on the login page, in ${scheme} mode, in every state`, async () => {
      const problems: string[] = [];
      const options = { colorScheme: scheme, bypassCSP: true } as const;
      await onOnePage(options, (page) =>
        eachLoginState(page, options, async (at, where) => {
          problems.push(...(await axeViolations(at)).map((p) => `${scheme} ${where}: ${p}`));
        }),
      );
      expect(problems).toEqual([]);
    });

    it(`readable contrast and no accessibility problems on Home's Checked at, the Login card, the Bank card and their sheets, in ${scheme} mode`, async () => {
      const problems: string[] = [];
      const options = { colorScheme: scheme, bypassCSP: true } as const;
      await onOnePage(options, (page) =>
        eachCardState(page, options, async (at, where) => {
          problems.push(...(await axeViolations(at)).map((p) => `${scheme} ${where}: ${p}`));
        }),
      );
      expect(problems).toEqual([]);
    });
  }

  it('every tap target is at least 44 by 44 points, on the login page, the Login card and the Bank card, in every state', async () => {
    const small: string[] = [];
    const check = async (page: Page, where: string): Promise<void> => {
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`${where}: ${t.what} is ${t.width}x${t.height}`);
    };
    await onOnePage({}, async (page) => {
      await eachLoginState(page, {}, check);
      await eachCardState(page, {}, check);
    });
    expect(small).toEqual([]);
  });

  it('nothing on the login page sits under the notch or the home bar; the sheets end above the home bar', async () => {
    const off: string[] = [];
    const insets = `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`;
    await onOnePage({ bypassCSP: true }, async (one) => {
      await eachLoginState(one, { bypassCSP: true }, async (page, where) => {
        await addStyle(page, insets);
        // What is drawn on the screen (a wrapper that only groups others takes no space of its own).
        const drawn = (): Promise<{ readonly top: number; readonly bottom: number }> =>
          page.locator('main *:not(.sr-only)').evaluateAll((els) => {
            const boxes = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
            return { top: Math.min(...boxes.map((r) => r.top)), bottom: Math.max(...boxes.map((r) => r.bottom)) };
          });
        const first = await drawn();
        if (first.top < IPHONE_INSETS.top) off.push(`${where}: the first thing is at ${first.top}, under the notch`);
        for (const t of await tappable(page)) if (t.y < IPHONE_INSETS.top) off.push(`${where}: ${t.what} is under the notch`);
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const last = await drawn();
        if (last.bottom > IPHONE.height - IPHONE_INSETS.bottom + 0.5) off.push(`${where}: the last thing ends at ${last.bottom}, under the home bar`);
      });
      await eachCardState(one, { bypassCSP: true }, async (page, where) => {
        const sheet = page.locator('dialog[open]');
        if ((await sheet.count()) === 0) return;
        await addStyle(page, insets);
        await sheet.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
        await sheet.evaluate((e) => e.scrollTo(0, e.scrollHeight));
        const lastControl = await sheet.locator('button').last().boundingBox();
        if (lastControl!.y + lastControl!.height > IPHONE.height - IPHONE_INSETS.bottom + 0.5) off.push(`${where}: the last button ends at ${lastControl!.y + lastControl!.height}, under the home bar`);
      });
    });
    expect(off).toEqual([]);
  });

  it("the text grows with the phone's text size, and the login page, Checked at and the cards still fit", async () => {
    const off: string[] = [];
    const check = async (page: Page, where: string): Promise<void> => {
      const before = await page.locator('.screen-title, [data-testid="checked-at"]').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      await addStyle(page, 'html { font-size: 36px !important; }');
      const after = await page.locator('.screen-title, [data-testid="checked-at"]').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      if (!(after > before * 1.8)) off.push(`${where}: the title went from ${before} to ${after} only`);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      if (width > IPHONE.width) off.push(`${where}: the page is ${width} wide`);
      for (const right of await page.locator('main *, dialog[open] *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
        if (right > IPHONE.width + 0.5) {
          off.push(`${where}: something ends at ${right}`);
          break;
        }
      }
    };
    await onOnePage({ bypassCSP: true }, async (page) => {
      await eachLoginState(page, { bypassCSP: true }, check);
      await eachCardState(page, { bypassCSP: true }, check);
    });
    expect(off).toEqual([]);
  });

  it('with reduced motion on, the loading page does not shimmer and the sheet does not slide', async () => {
    // One page, with motion on and then reduced, each screen loaded afresh (showLive in live.ts says why).
    const context = await contextFor({}, true);
    const page = await context.newPage();
    await settingsPage(page, real('passkey').base);
    await page.getByTestId('row-stay-logged-in').click();
    expect(await page.getByTestId('stay-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('sheet-in');

    await emulatePhone(page, { reducedMotion: 'reduce' });
    await settingsPage(page, real('passkey').base);
    await page.getByTestId('row-stay-logged-in').click();
    expect(await page.getByTestId('stay-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    const durations = await page.locator('.row, .button, .field__input').evaluateAll((els) => els.map((e) => getComputedStyle(e).transitionDuration));
    expect(durations.every((d) => d.split(',').every((part) => Number.parseFloat(part) === 0))).toBe(true);
    const letGo = await holdAuth(page);
    await page.goto(`${real('passkey').base}/login`);
    await waitOrReport(page, '[data-testid="login-loading"]');
    const shimmer = await page.locator('.skeleton').evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
    expect(shimmer.length).toBeGreaterThan(0);
    expect(shimmer.every((name) => name === 'none')).toBe(true);
    await letGo();
    await context.close();
  });

  it('every state is there: loading, then the passkey button; an error, and Try again brings the page', async () => {
    const context = await contextFor({}, false);
    const page = await context.newPage();
    const letGo = await holdAuth(page);
    await page.goto(`${real('passkey').base}/login`);
    await waitOrReport(page, '[data-testid="login-loading"]');
    expect(await page.locator('main').getAttribute('aria-busy')).toBe('true');
    await letGo();
    await waitOrReport(page, '[data-testid="login-passkey"]');
    expect(await page.locator('main').getAttribute('aria-busy')).toBe('false');
    await page.unrouteAll({ behavior: 'wait' });

    // The same page, loaded afresh (showLive in live.ts says why).
    let fail = true;
    await page.route('**/api/auth', (route) => (fail ? route.fulfill({ status: 500, body: 'no' }) : route.continue()));
    await loginPage(page, real('passkey').base, '[data-testid="login-error"]');
    expect(await page.getByTestId('login-error').innerText()).toContain("Couldn't reach the app");
    fail = false;
    await page.getByTestId('retry').click();
    await waitOrReport(page, '[data-testid="login-passkey"]');
    await untilQuiet(page);
    await context.close();
  });

  it('light and dark follow the phone on the login page', async () => {
    // One page, loaded afresh in each scheme (showLive in live.ts says why).
    const context = await contextFor({}, false);
    const page = await context.newPage();
    for (const [scheme, background] of [
      ['light', 'rgb(242, 242, 247)'],
      ['dark', 'rgb(0, 0, 0)'],
    ] as const) {
      await emulatePhone(page, { colorScheme: scheme });
      await loginPage(page, real('passkey').base, '[data-testid="login-passkey"]');
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), scheme).toBe(background);
    }
    await context.close();
  });

  it('Step 3 Checked at is said in words with a clock, in the secondary text color, under safe to spend', async () => {
    const context = await contextFor({}, true);
    const page = await context.newPage();
    await homePage(page, real('passkey').base);
    const line = page.getByTestId('checked-at');
    expect((await line.innerText()).trim()).toBe('Checked at 12:00 PM');
    expect(await line.locator('[data-icon="clock"]').count()).toBe(1);
    const colors = await page.evaluate(() => ({ line: getComputedStyle(document.querySelector('[data-testid="checked-at"]')!).color, label: getComputedStyle(document.querySelector('.hero__label')!).color }));
    expect(colors.line).toBe(colors.label);
    const hero = await page.locator('.hero').boundingBox();
    const box = await line.boundingBox();
    expect(box!.y).toBeGreaterThan(hero!.y + hero!.height - 1);
    await context.close();
  });

  it('a refusal says so in words and with an icon, never by color alone', async () => {
    const context = await contextFor({}, false);
    const page = await context.newPage();
    await loginPage(page, real('first').base, '[data-testid="login-code"]');
    await page.getByTestId('code').fill('1111-2222-3333');
    await page.getByTestId('make-passkey').click();
    await waitOrReport(page, '[data-testid="login-problem"]');
    await untilQuiet(page);
    const problem = page.getByTestId('login-problem');
    expect(await problem.innerText()).toContain('That code is not right');
    expect(await problem.locator('[data-icon]').count()).toBe(1);
    await context.close();
  });
});
