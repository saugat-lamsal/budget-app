import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, emulatePhone, openScenario, phone, showScenario, useEngine } from './harness.js';

// The design rules (CLAUDE.md), checked in the browser: light and dark,
// readable contrast, 44-point tap targets, the notch and the home bar, the
// phone's text size and reduced-motion settings, and money written one way.

// Every screen state worth checking.
const STATES = ['normal', 'mismatch', 'catching-up', 'low', 'overspent', 'trouble', 'all-clear', 'not-set-up', 'error', 'big', 'took-back', 'bank-not-read'] as const;

describe('design rules in the style sheets', () => {
  const css = (file: string): string => readFileSync(new URL(`../../src/ui/${file}`, import.meta.url), 'utf8');

  it("text sizes follow the phone's text size: the page's size is relative, and so is every other", () => {
    const base = css('base.css');
    expect(base).toMatch(/html \{[^}]*font-size: [\d.]+%;/);
    expect(base).toMatch(/@supports \(font: -apple-system-body\) \{\s*html \{\s*font: -apple-system-body;/);
    for (const file of ['tokens.css', 'base.css', 'blocks.css']) {
      for (const [, value = ''] of css(file).matchAll(/(?:font-size|--text-[a-z]+):\s*([^;]+);/g)) {
        // Relative sizes, the size tokens, or a small cap on a relative
        // size (tab labels and the badge stay small, as iOS keeps them).
        const relative = /^(?:[\d.]+(?:rem|em|%)|var\(--text-[a-z]+\)|inherit|min\(var\(--text-[a-z]+\), \d+px\)|min\(var\(--text-hero\), calc\(.*\)\))$/.test(value);
        const badge = file === 'blocks.css' && value === '11px';
        expect(relative || badge, `${file}: font-size ${value}`).toBe(true);
      }
    }
  });
});

describe.each(ENGINES)('design rules in %s', (engineName, engine) => {
  const { browser, base } = useEngine(engine);

  // Each test has one page, moved from state to state and the life started
  // over each time (showLive in live.ts says why).
  it('light and dark mode follow the phone', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const [scheme, background] of [
      ['light', 'rgb(242, 242, 247)'],
      ['dark', 'rgb(0, 0, 0)'],
    ] as const) {
      await emulatePhone(page, { colorScheme: scheme });
      await showScenario(page, base(), 'normal');
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(background);
    }
    await context.close();
  });

  // One test for each colour scheme: the pass over every state is long on a slow
  // machine (the checks wait for the screen to be at rest), and both together
  // took longer than the time limit on Windows CI (Oct 8).
  for (const scheme of ['light', 'dark'] as const) {
    it(`readable contrast and no accessibility problems, in ${scheme} mode, in every state`, async () => {
      const problems: string[] = [];
      const context = await browser().newContext(phone({ colorScheme: scheme, bypassCSP: true }));
      const page = await context.newPage();
      for (const state of STATES) {
        await showScenario(page, base(), state);
        problems.push(...(await axeViolations(page)).map((p) => `${scheme} ${state}: ${p}`));
      }
      // The sheets, open.
      await showScenario(page, base(), 'mismatch');
      await page.getByTestId('see-check').click();
      await page.getByTestId('check-sheet').waitFor();
      problems.push(...(await axeViolations(page)).map((p) => `${scheme} check sheet: ${p}`));
      await showScenario(page, base(), 'normal', '/review');
      problems.push(...(await axeViolations(page)).map((p) => `${scheme} review tab: ${p}`));
      await context.close();
      expect(problems).toEqual([]);
    }, 120_000);
  }

  it('every tap target is at least 44 by 44 points, in every state', async () => {
    const small: string[] = [];
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const state of STATES) {
      await showScenario(page, base(), state);
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`${state}: ${t.what} is ${t.width}x${t.height}`);
    }
    await showScenario(page, base(), 'normal');
    await page.getByTestId('attention-move-to-savings').click();
    await page.getByTestId('savings-sheet').waitFor();
    for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`savings sheet: ${t.what} is ${t.width}x${t.height}`);
    await context.close();
    expect(small).toEqual([]);
  });

  it('nothing sits under the notch or the home bar', async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    const page = await context.newPage();
    for (const state of ['normal', 'mismatch', 'not-set-up'] as const) {
      await showScenario(page, base(), state);
      // What the iPhone 15 reports for env(safe-area-inset-*).
      await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
      const first = await page.locator('main > :not(.sr-only):not(dialog)').first().boundingBox();
      expect(first!.y, state).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      // Whatever shows on the first screen starts below the notch.
      for (const t of await tappable(page)) {
        if (t.y < IPHONE.height) expect(t.y, `${state}: ${t.what}`).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      }
      // The tabs sit above the home bar.
      const tabs = await page.locator('.tab').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
      expect(tabs).toHaveLength(4);
      for (const bottom of tabs) expect(bottom, state).toBeLessThanOrEqual(IPHONE.height - IPHONE_INSETS.bottom + 0.5);
      // What scrolls up goes under a solid strip, not into the clock and
      // battery, and nothing shows through the tab bar.
      const strip = await page.locator('.app').evaluate((e) => {
        const s = getComputedStyle(e, '::before');
        return { position: s.position, height: s.height, background: s.backgroundColor, page: getComputedStyle(document.body).backgroundColor };
      });
      expect(strip.position, state).toBe('fixed');
      expect(strip.height, state).toBe(`${IPHONE_INSETS.top}px`);
      expect(strip.background, state).toBe(strip.page);
      expect(await page.locator('.tabbar').evaluate((e) => getComputedStyle(e).backgroundColor), state).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      // The end of the screen scrolls clear of the tab bar.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const bar = await page.locator('.tabbar').boundingBox();
      const last = await page.locator('main > :not(.sr-only):not(dialog)').last().boundingBox();
      expect(last!.y + last!.height, state).toBeLessThanOrEqual(bar!.y);
    }
    await context.close();
  });

  it('only the tokens read the safe areas, so every screen gets them the same way', () => {
    const css = readFileSync(new URL('../../src/ui/blocks.css', import.meta.url), 'utf8');
    expect(css).not.toMatch(/env\(safe-area/);
  });

  it('with reduced motion on, nothing slides or fades', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    await page.getByTestId('attention-move-to-savings').click();
    await page.getByTestId('savings-sheet').waitFor();
    expect(await page.getByTestId('savings-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('sheet-in');

    // The same page with motion reduced, the life started over.
    await emulatePhone(page, { reducedMotion: 'reduce' });
    await showScenario(page, base(), 'normal');
    await page.getByTestId('attention-move-to-savings').click();
    await page.getByTestId('savings-sheet').waitFor();
    expect(await page.getByTestId('savings-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    const durations = await page.locator('.bar__fill, .row, .button').evaluateAll((els) => els.map((e) => getComputedStyle(e).transitionDuration));
    expect(durations.every((d) => d.split(',').every((part) => Number.parseFloat(part) === 0))).toBe(true);
    await page.context().close();
  });

  it("the text grows with the phone's text size, and the screen still fits", async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    const page = await context.newPage();
    for (const state of ['normal', 'mismatch', 'big', 'trouble'] as const) {
      await showScenario(page, base(), state);
      const before = await page.locator('.row__title, .hero__label, .state__title').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      // The largest accessibility text size on the iPhone is about twice the default.
      await addStyle(page, 'html { font-size: 36px !important; }');
      const after = await page.locator('.row__title, .hero__label, .state__title').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      expect(after, state).toBeGreaterThan(before * 1.8);
      // No sideways scrolling, and every amount fully on screen.
      expect(await page.evaluate(() => document.documentElement.scrollWidth), state).toBeLessThanOrEqual(IPHONE.width);
      const boxes = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })));
      for (const b of boxes) {
        expect(b.left, state).toBeGreaterThanOrEqual(0);
        expect(b.right, state).toBeLessThanOrEqual(IPHONE.width);
      }
    }
    await context.close();
  });

  it("the screens start from the reader's own text size, not a fixed one", async () => {
    // Chromium can be told a bigger default text size, the way a person
    // sets it in their browser. (On the iPhone, -apple-system-body in
    // base.css does the same from the phone's text size setting.)
    if (engineName !== 'chromium') return;
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    await page.goto(`${base()}/demo/normal`);
    await page.getByTestId('safe-to-spend').waitFor();
    // 106.25% of 32 pixels.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('34px');
    expect(await page.locator('.row__title').first().evaluate((e) => getComputedStyle(e).fontSize)).toBe('34px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
    await context.close();
  });

  it('money is written the same way everywhere, with digits that line up', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const state of ['normal', 'overspent', 'mismatch', 'trouble', 'big'] as const) {
      await showScenario(page, base(), state);
      const amounts = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', numbers: getComputedStyle(e).fontVariantNumeric })));
      expect(amounts.length, state).toBeGreaterThan(0);
      for (const a of amounts) {
        expect(a.text, state).toMatch(/^−?\$\d{1,3}(,\d{3})*\.\d{2}$/);
        expect(a.numbers, state).toContain('tabular-nums');
      }
    }
    await context.close();
  });

  it('the app runs under its own security policy without a single error', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base()}/demo/mismatch`);
    await page.getByTestId('mismatch').waitFor();
    await page.getByTestId('see-check').click();
    await page.getByTestId('check-sheet').waitFor();
    await page.keyboard.press('Escape');
    await page.getByTestId('check-sheet').waitFor({ state: 'hidden' });
    await page.getByTestId('tab-review').click();
    await page.getByTestId('review').waitFor();
    expect(errors).toEqual([]);
    await context.close();
  });
});
