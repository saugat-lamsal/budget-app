import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { homeView } from '../../../server/src/views/home.js';
import { onItsWayInText } from '../../src/screens/home-text.js';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, openScenario, phone, textAt, useEngine } from './harness.js';

// Rule 11.4 (QUESTIONS.md A57) on Home: each row of money on its way in says
// since when it has been pending and, with 3 earlier ones like it, how long
// they usually took to post; the words are the server's figures, said by
// home-text.ts. And the design rules for the rows. In Chromium (his own tests
// for the screens he touched, his rule of Oct 14). Every name and number is
// made up.

const chromiumOnly = ENGINES.filter(([name]) => name === 'chromium');

describe.runIf(chromiumOnly.length > 0)('11.4 A57 money on its way in, pending since and usually posts within, in chromium', () => {
  const { browser, base } = useEngine(chromium);

  it('11.4 A57 every row says what the server worked out: pending since, and usually posts within only with 3 earlier ones', async () => {
    const input = demoScenario('paycheck-pending')?.input?.();
    if (input === undefined) throw new Error('no made-up life called paycheck-pending');
    const view = homeView(input);
    if (view.state !== 'tracking') throw new Error('not tracking');
    expect(view.onItsWayIn.map((r) => r.usually)).toEqual([null, { within: 22, unit: 'hours' }, null]);
    const page = await openScenario(await browser().newContext(phone()), base(), 'paycheck-pending');
    for (const [i, row] of view.onItsWayIn.entries()) {
      const words = onItsWayInText(row, view.today, view.timeZone);
      expect(await textAt(page, `on-its-way-in-${i}`)).toContain(`${words.title} ${words.detail}`);
    }
    await page.context().close();
  });

  it('11.4 A57 design rules for the rows: contrast in light and dark, 44-point taps, below the notch, and the largest text size', async () => {
    const problems: string[] = [];
    const context = await browser().newContext(phone({ colorScheme: 'light', bypassCSP: true }));
    const page = await openScenario(context, base(), 'paycheck-pending');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      problems.push(...(await axeViolations(page)).map((p) => `${scheme}: ${p}`));
    }
    for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) problems.push(`${t.what} is ${t.width}x${t.height}`);
    // Words and an icon, not colour alone.
    expect(await page.getByTestId('on-its-way-in').locator('[data-icon="clock"]').count()).toBe(3);
    await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
    const card = await page.getByTestId('on-its-way-in').boundingBox();
    expect(card!.y).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
    await addStyle(page, 'html { font-size: 36px !important; }');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
    for (const box of await page.getByTestId('on-its-way-in').locator('*').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })))) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(IPHONE.width + 0.5);
    }
    // The words wrap; they are never squeezed to a sliver beside the amount.
    const squeezed = await page.getByTestId('on-its-way-in').locator('.row__title').evaluateAll((els) =>
      els.flatMap((e) => (e.getBoundingClientRect().width < 6 * Number.parseFloat(getComputedStyle(e).fontSize) ? [e.textContent ?? ''] : [])),
    );
    expect(squeezed).toEqual([]);
    await context.close();
    expect(problems).toEqual([]);
  });
});
