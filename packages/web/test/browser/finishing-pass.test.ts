import { chromium, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { addStyle } from './design-helpers.js';
import { ENGINES, openScenario, phone, useEngine } from './harness.js';

// The redesign's finishing pass, the UI sweep (redesign PR 5): what was
// found and fixed, each kept fixed by a test. In Chromium (only the screens
// touched). Every name and number is made up.

const chromiumOnly = ENGINES.filter(([name]) => name === 'chromium');

// Every piece of text in a padded card sits inside its padding: none runs
// into the card's edge or its rounded corner (found: PR 1 dropped the padded
// card's padding, and the note under Trends' bars was cut by the corner).
async function textInsidePaddedCards(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const card of document.querySelectorAll<HTMLElement>('.card--padded')) {
      if (card.closest('[aria-hidden="true"]') !== null) continue;
      const box = card.getBoundingClientRect();
      if (box.width === 0) continue;
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = (node.textContent ?? '').trim();
        if (text === '' || node.parentElement?.closest('[aria-hidden="true"], .sr-only, .roll') != null) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width === 0) continue;
          const gaps = [r.left - box.left, box.right - r.right, box.bottom - r.bottom, r.top - box.top];
          if (Math.min(...gaps) < 11.5) out.push(`"${text.slice(0, 40)}" ${gaps.map((g) => g.toFixed(1)).join(' ')}`);
        }
      }
    }
    return out;
  });
}

describe.runIf(chromiumOnly.length > 0)('the finishing pass, in chromium', () => {
  const { browser, base } = useEngine(chromium);

  it('PR 5 a padded card keeps its text inside its padding, at the default and the largest text size', async () => {
    // The largest text size is the root font size at 36px, as the other design checks have it.
    for (const fontScale of ['default', '36px']) {
      const page = await openScenario(await browser().newContext(phone({ bypassCSP: true })), base(), 'trends', '/trends');
      await page.getByTestId('trends-periods').waitFor();
      if (fontScale !== 'default') await addStyle(page, 'html { font-size: 36px !important; }');
      expect(await textInsidePaddedCards(page), `Past at ${fontScale}`).toEqual([]);
      for (const segment of ['now', 'future', 'habits']) {
        const tab = page.getByTestId(`trends-segment-${segment}`);
        if ((await tab.count()) === 0) continue;
        await tab.click();
        await page.waitForTimeout(50);
        expect(await textInsidePaddedCards(page), `${segment} at ${fontScale}`).toEqual([]);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.context().close();
    }
  });

  it('PR 5 Settings has the day first and its title under it, as every other screen', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'settings-busy', '/settings');
    await page.locator('main[aria-busy="false"] .eyebrow').waitFor();
    const order = await page.locator('main').evaluate((m) => [...m.children].map((c) => c.className).filter((c) => c === 'eyebrow' || c === 'screen-title'));
    expect(order).toEqual(['eyebrow', 'screen-title']);
    await page.context().close();
  });

  it('PR 5 a count as the main number has the same type and fade as an amount', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'review-busy', '/review');
    const count = page.locator('.hero__count').first();
    await count.waitFor();
    const look = await count.evaluate((e) => ({ em: Number.parseFloat(getComputedStyle(e).letterSpacing) / Number.parseFloat(getComputedStyle(e).fontSize), mask: getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage }));
    await page.goto(`${base()}/home`);
    const amount = page.locator('.money--hero').first();
    await amount.waitFor();
    const hero = await amount.evaluate((e) => ({ em: Number.parseFloat(getComputedStyle(e).letterSpacing) / Number.parseFloat(getComputedStyle(e).fontSize), mask: getComputedStyle(e).maskImage || getComputedStyle(e).webkitMaskImage }));
    expect(look.mask).not.toBe('none');
    expect(look.mask).toBe(hero.mask);
    expect(look.em).toBeCloseTo(hero.em, 3);
    await page.context().close();
  });

  it('PR 5 Trends: the bars run to the card\'s edge, and a big range fits across its card at the largest text size', async () => {
    const page = await openScenario(await browser().newContext(phone({ bypassCSP: true })), base(), 'trends-future', '/trends');
    const edges = await page.getByTestId('period-bar').evaluate((row) => {
      const card = row.closest('.card')!.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return [Math.round(r.left - card.left), Math.round(card.right - r.right)];
    });
    expect(edges).toEqual([0, 0]);
    await page.getByTestId('trends-segment-future').click();
    await addStyle(page, 'html { font-size: 36px !important; }');
    const over = await page.locator('.trend-range .money').evaluateAll((els) =>
      els.filter((e) => e.getBoundingClientRect().right > e.closest('.card')!.getBoundingClientRect().right - 16).map((e) => e.textContent),
    );
    expect(over).toEqual([]);
    await page.context().close();
  });

});
