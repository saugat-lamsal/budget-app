import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_LIVES, checksOf, exampleNumbers } from '../worked-examples.js';
import { ENGINES, centsAt, openScenario, phone, readCents, textAt, useEngine } from './harness.js';

// Every example in packages/web/worked-examples.txt, against what the screen
// shows a person for the same made-up life.

// Opens "See the numbers", reads one, and closes it again.
async function inCheckSheet(page: Page, testId: string): Promise<number> {
  await page.getByTestId('see-check').click();
  await page.getByTestId('check-sheet').waitFor();
  const cents = await centsAt(page, testId);
  await page.keyboard.press('Escape');
  await page.getByTestId('check-sheet').waitFor({ state: 'hidden' });
  return cents;
}

describe.each(ENGINES)('worked examples on the screen in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it.each(exampleNumbers())('example %i: the screen shows every number worked out by hand', async (n) => {
    const page = await openScenario(await browser().newContext(phone()), base(), EXAMPLE_LIVES[n] ?? '');
    for (const [label, expected] of checksOf(n)) {
      switch (label) {
        case 'safe to spend':
          expect(await centsAt(page, 'safe-to-spend'), label).toBe(expected);
          break;
        case 'needs':
        case 'wants':
          expect(await centsAt(page, `bucket-${label}-left`), label).toBe(expected);
          break;
        case 'held back':
          expect(await centsAt(page, 'held-back'), label).toBe(expected);
          break;
        case 'still to move':
          expect(await centsAt(page, 'move-amount'), label).toBe(expected);
          break;
        case 'waiting':
          expect(await page.getByTestId('review-badge').innerText(), label).toBe(String(expected));
          break;
        case 'days to payday':
          expect(await textAt(page, 'payday'), label).toMatch(new RegExp(`^${expected} days to payday`));
          break;
        case 'difference':
          if (expected === 0) expect(await page.getByTestId('mismatch').count(), label).toBe(0);
          else {
            expect(await centsAt(page, 'mismatch-amount'), label).toBe(Math.abs(expected));
            expect(await inCheckSheet(page, 'check-difference'), label).toBe(expected);
          }
          break;
        case 'bank side':
          expect(await inCheckSheet(page, 'check-bank'), label).toBe(expected);
          break;
        case 'app side':
          expect(await inCheckSheet(page, 'check-app'), label).toBe(expected);
          break;
        case 'needs started with':
          expect(await centsAt(page, 'bucket-needs-of'), label).toBe(expected);
          break;
        case 'wants started with':
          expect(await centsAt(page, 'bucket-wants-of'), label).toBe(expected);
          break;
        case 'taken back':
          expect(await readCents(await page.locator('[data-testid^="attention-bank-took-back-"] [data-money]').innerText()), label).toBe(expected);
          break;
        case 'last checked':
          expect(await centsAt(page, 'safe-to-spend-stale'), label).toBe(expected);
          break;
        default:
          throw new Error(`example ${n}: no way to read "${label}" off the screen`);
      }
    }
    await page.context().close();
  });
});
