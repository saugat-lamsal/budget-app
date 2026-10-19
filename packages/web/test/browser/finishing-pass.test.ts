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

});
