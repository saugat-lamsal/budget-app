import type { WhyLine } from '@budget-app/server/views';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { homeView } from '../../../server/src/views/home.js';
import { whyText } from '../../src/screens/why-text.js';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, openScenario, phone, readCents, textAt, useEngine } from './harness.js';

// Rule 12.6 (QUESTIONS.md A57) on the screens: Home's check sheet and Buckets'
// sheet say why the totals do not match, each line with its part of the
// difference, adding up to it; the lines are the server's, word for word.
// And the design rules for both sheets. In Chromium (his own tests for the
// screens he touched, his rule of Oct 14). Every name and number is made up.

function serverWhy(life: string): { readonly difference: number; readonly why: readonly WhyLine[] } {
  const input = demoScenario(life)?.input?.();
  if (input === undefined) throw new Error(`no life ${life}`);
  const view = homeView(input);
  if (view.state !== 'tracking' || view.safeToSpend.shown || view.safeToSpend.why !== 'totals-do-not-match') throw new Error(`${life} matches`);
  return { difference: view.safeToSpend.check.difference, why: view.safeToSpend.detail?.why ?? [] };
}

const expectedText = (line: WhyLine): string => {
  const words = whyText(line);
  return [words.title, words.detail].filter((w) => w !== undefined).join(' ');
};

// A signed amount, as a person reads it: a plus sign is money in the bank's favour.
async function signedAt(page: import('playwright').Page, testId: string): Promise<number> {
  return readCents((await page.getByTestId(testId).innerText()).replace(/^\+/, ''));
}

async function linesOn(page: import('playwright').Page, count: number): Promise<{ readonly text: string; readonly cents: number }[]> {
  const lines: { text: string; cents: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const cents = await signedAt(page, `why-${i}-amount`);
    const text = (await textAt(page, `why-${i}`)).replace(await page.getByTestId(`why-${i}-amount`).innerText(), '').trim();
    lines.push({ text, cents });
  }
  return lines;
}

const chromiumOnly = ENGINES.filter(([name]) => name === 'chromium');

describe.runIf(chromiumOnly.length > 0)('12.6 why it does not match, on the screens, in chromium', () => {
  const { browser, base } = useEngine(chromium);

  it('12.6 Home\'s check sheet: the bank posted a coffee Plaid still says is pending (counted twice), and checking went up with no transaction; the lines add up to the difference', async () => {
    const expected = serverWhy('why-counted-twice');
    const page = await openScenario(await browser().newContext(phone()), base(), 'why-counted-twice');
    expect(await textAt(page, 'catching-up')).toContain('The bank is still catching up');
    await page.getByTestId('see-check').click();
    await expect.poll(() => page.getByTestId('check-sheet').isVisible()).toBe(true);
    expect(await page.getByTestId('check-sheet').getByTestId('why').isVisible()).toBe(true);
    const lines = await linesOn(page, expected.why.length);
    expect(lines).toEqual(expected.why.map((l) => ({ text: expectedText(l), cents: l.amount })));
    expect(lines.map((l) => l.text)).toEqual([
      "Checking's available balance went up $27.50 with no transaction from the bank yet.",
      'Everyday card: “BLUE DOOR COFFEE” Posted at the bank, Plaid still says pending: counted twice for now.',
    ]);
    // Signed, so the direction is in the amount itself.
    expect(await page.getByTestId('why-0-amount').innerText()).toBe('+$27.50');
    expect(await page.getByTestId('why-1-amount').innerText()).toBe('−$5.75');
    expect(lines.reduce((total, l) => total + l.cents, 0)).toBe(await signedAt(page, 'check-difference'));
    expect(await page.getByTestId('why-2').count()).toBe(0);
    await page.context().close();
  });

  it('12.6 Buckets: See why opens the same lines, with the difference', async () => {
    const expected = serverWhy('why-counted-twice');
    const page = await openScenario(await browser().newContext(phone()), base(), 'why-counted-twice', '/buckets');
    expect(await page.getByTestId('why-sheet').isVisible()).toBe(false);
    await page.getByTestId('see-why').click();
    await expect.poll(() => page.getByTestId('why-sheet').isVisible()).toBe(true);
    expect(await signedAt(page, 'why-difference')).toBe(expected.difference);
    expect(await page.getByTestId('why-difference').innerText()).toBe('+$21.75');
    const lines = await linesOn(page, expected.why.length);
    expect(lines).toEqual(expected.why.map((l) => ({ text: expectedText(l), cents: l.amount })));
    await page.keyboard.press('Escape');
    await expect.poll(() => page.getByTestId('why-sheet').isVisible()).toBe(false);
    await page.context().close();
  });

  it('12.6 with no earlier read that matched kept, one line, with the whole difference, on Home and Buckets', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'why-no-match-kept');
    await page.getByTestId('see-check').click();
    await expect.poll(() => page.getByTestId('check-sheet').isVisible()).toBe(true);
    expect(await linesOn(page, 1)).toEqual([{ text: 'No earlier read of the bank that matched is kept to compare with.', cents: -1_234 }]);
    expect(await page.getByTestId('why-1').count()).toBe(0);
    await page.goto(`${base()}/buckets`);
    await page.getByTestId('see-why').click();
    await expect.poll(() => page.getByTestId('why-sheet').isVisible()).toBe(true);
    expect(await page.getByTestId('why-difference').innerText()).toBe('−$12.34');
    expect(await linesOn(page, 1)).toEqual([{ text: 'No earlier read of the bank that matched is kept to compare with.', cents: -1_234 }]);
    await page.context().close();
  });

  it('12.6 totals that match have no See why, and no Why on Home', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    expect(await page.getByTestId('see-why').count()).toBe(0);
    expect(await page.getByTestId('why-sheet').count()).toBe(0);
    await page.context().close();
  });

  for (const [screen, path, open, sheet] of [
    ['Home', '/home', 'see-check', 'check-sheet'],
    ['Buckets', '/buckets', 'see-why', 'why-sheet'],
  ] as const) {
    it(`12.6 design rules for the sheet on ${screen}: contrast in light and dark, 44-point taps, clear of the home bar, and the text size`, async () => {
      const problems: string[] = [];
      const context = await browser().newContext(phone({ colorScheme: 'light', bypassCSP: true }));
      const page = await openScenario(context, base(), 'why-counted-twice', path);
      await page.getByTestId(open).click();
      const box = page.getByTestId(sheet);
      await box.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        problems.push(...(await axeViolations(page)).map((p) => `${scheme}: ${p}`));
      }
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) problems.push(`${t.what} is ${t.width}x${t.height}`);
      // Money written one way, signed, digits lined up; colour is not the only signal.
      for (const m of await box.locator('[data-money]').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', numbers: getComputedStyle(e).fontVariantNumeric })))) {
        expect(m.text).toMatch(/^[−+]?\$\d{1,3}(,\d{3})*\.\d{2}$/);
        expect(m.numbers).toContain('tabular-nums');
      }
      expect(await box.getByTestId('why').locator('[data-icon]').count()).toBeGreaterThan(0);
      // Clear of the home bar: the sheet's end is above it once scrolled down.
      await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
      await box.evaluate((e) => e.scrollTo(0, e.scrollHeight));
      const inner = await box.locator('.sheet__inner').boundingBox();
      expect(inner!.y + inner!.height).toBeLessThanOrEqual(IPHONE.height + 0.5);
      const lastLine = await box.getByTestId('why').locator('.row').last().boundingBox();
      expect(lastLine!.y).toBeLessThan(IPHONE.height - IPHONE_INSETS.bottom);
      // The largest text size: nothing runs off the side, and every amount stays on screen.
      await addStyle(page, 'html { font-size: 36px !important; }');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
      for (const right of await box.locator('*').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(right).toBeLessThanOrEqual(IPHONE.width + 0.5);
      // A line's words are not squeezed to a sliver to keep its amount beside them: at least six letters' worth.
      const squeezed = await box.locator('.row--trailing .row__title').evaluateAll((els) =>
        els.flatMap((e) => (e.getBoundingClientRect().width < 6 * Number.parseFloat(getComputedStyle(e).fontSize) ? [e.textContent ?? ''] : [])),
      );
      expect(squeezed).toEqual([]);
      await context.close();
      expect(problems).toEqual([]);
    });
  }
});
