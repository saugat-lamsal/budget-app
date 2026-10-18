import type { BankBalances, Book, IsoDate } from '@budget-app/money';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { ringFraction } from '../../src/ui/motion.js';
import { atRest } from './design-helpers.js';
import { ENGINES, openScenario, phone, textAt, useEngine } from './harness.js';

// Redesign PR 2, motion, used in a browser. Run with motion on (the tests'
// default is reduced, so every other test sees the screens at rest).

function life(name: string): { readonly book: Book; readonly bank: BankBalances; readonly today: IsoDate } {
  const input = demoScenario(name)?.input?.();
  if (input === undefined || input.book === null || input.bank === null) throw new Error(`no made-up life called ${name}`);
  return { book: input.book, bank: input.bank, today: input.today };
}

const MOVING = { reducedMotion: 'no-preference' } as const;

describe.each(ENGINES)('Motion in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('PR 2: the pay-period ring is drawn to how far the money math says the pay period is', async () => {
    const { book, today } = life('normal');
    const page = await openScenario(await browser().newContext(phone(MOVING)), base(), 'normal');
    const expected = ringFraction(book.period().startDate, today, book.safeToSpend(today).nextPayday);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(1);
    expect(Number(await page.getByTestId('period-ring').getAttribute('data-fraction'))).toBeCloseTo(expected, 4);
    // It draws in, and once at rest the arc covers exactly that much of its circle.
    await atRest(page);
    // (The circle's path length is 1, so the dash is the share of the circle.)
    const dash = await page.locator('.ring__arc').evaluate((e) => Number.parseFloat(getComputedStyle(e).strokeDasharray.split(/[ ,]+/)[0] ?? '0'));
    expect(dash).toBeCloseTo(expected, 2);
    await page.context().close();
  });

  it('PR 2: the pay-period ring is there, already drawn, with reduced motion', async () => {
    const { book, today } = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    const arc = page.locator('.ring__arc');
    await arc.waitFor();
    expect(await arc.evaluate((e) => e.getAnimations().length)).toBe(0);
    const expected = ringFraction(book.period().startDate, today, book.safeToSpend(today).nextPayday);
    const drawn = await arc.evaluate((e) => Number.parseFloat(getComputedStyle(e).strokeDasharray.split(/[ ,]+/)[0] ?? '0'));
    expect(drawn).toBeCloseTo(expected, 2);
    await page.context().close();
  });

  it('PR 2: the ring is hidden from a screen reader (the days to payday say the same)', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await page.getByTestId('period-ring').getAttribute('aria-hidden')).toBe('true');
    expect(await textAt(page, 'payday')).toContain('days to payday');
    await page.context().close();
  });

  it('PR 2: the rolling digits end on exactly the amount, and the amount in the page is still its plain text', async () => {
    const { book, today } = life('normal');
    const page = await openScenario(await browser().newContext(phone(MOVING)), base(), 'normal');
    await atRest(page);
    expect(book.safeToSpend(today).amount).toBe(62244);
    // What a person copies or a screen reader reads: the amount, once.
    expect(await textAt(page, 'safe-to-spend')).toBe('$622.44');
    expect(await page.getByTestId('safe-to-spend').locator('.money__cents').innerText()).toBe('.44');
    // What is drawn: each column sits on its digit.
    const digits = await page.getByTestId('safe-to-spend').locator('.roll__col').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.getPropertyValue('--digit')).join(''));
    expect(digits).toBe('62244');
    // ...and the column is moved up by exactly that many digits (one digit is a line high).
    const moved = await page.getByTestId('safe-to-spend').locator('.roll__col').evaluateAll((els) =>
      els.map((e) => {
        const ty = new DOMMatrix(getComputedStyle(e).transform).m42;
        const line = (e.firstElementChild as HTMLElement).getBoundingClientRect().height;
        return Math.round(-ty / line);
      }),
    );
    expect(moved.join('')).toBe('62244');
    // The drawn digits have the amount's own color and size (the contrast check skips them, as they are drawn over the real text).
    const same = await page.getByTestId('safe-to-spend').evaluate((e) => {
      const roll = e.querySelector('.roll') as HTMLElement;
      return { amount: getComputedStyle(e).color, drawn: getComputedStyle(roll).color, fontSize: getComputedStyle(roll).fontSize === getComputedStyle(e).fontSize };
    });
    expect(same.drawn).toBe(same.amount);
    expect(same.fontSize).toBe(true);
    // The columns are drawn, not written: no stray digits in a card's text.
    expect((await page.getByTestId('bucket-wants').innerText()).replace(/\s+/g, ' ')).toMatch(/^WANTS\s*\$[\d,.]+\s*left of \$[\d,.]+$/i);
    expect(await page.getByTestId('safe-to-spend').locator('.roll').getAttribute('aria-hidden')).toBe('true');
    await page.context().close();
  });

  it('PR 2: the digits roll over 300 ms, expo-out, and not at all with reduced motion', async () => {
    const moving = await openScenario(await browser().newContext(phone(MOVING)), base(), 'normal');
    const style = await moving.locator('.roll__col').first().evaluate((e) => ({ duration: getComputedStyle(e).transitionDuration, fn: getComputedStyle(e).transitionTimingFunction }));
    expect(style.duration).toBe('0.3s');
    expect(style.fn).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
    await moving.context().close();
    const still = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await still.locator('.roll__col').first().evaluate((e) => getComputedStyle(e).transitionDuration)).toBe('0s');
    await still.context().close();
  });

  it('PR 2: a screen comes in with a fade and a rise, and is plain and still once it is at rest', async () => {
    const page = await openScenario(await browser().newContext(phone(MOVING)), base(), 'normal');
    expect(await page.locator('.screen > .hero').evaluate((e) => getComputedStyle(e).animationName)).toBe('rise');
    await atRest(page);
    expect(await page.locator('.screen > .eyebrow').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    expect(await page.locator('.screen > .eyebrow').evaluate((e) => e.getAnimations().length)).toBe(0);
    await page.context().close();
    const still = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await still.locator('.screen > .hero').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    await still.context().close();
  });

  it('PR 2: the tab line slides to the tab that is open, and there is only ever one', async () => {
    const page = await openScenario(await browser().newContext(phone(MOVING)), base(), 'normal');
    await page.getByTestId('tab-buckets').click();
    await page.waitForSelector('[data-testid="tab-buckets"] .tab__line');
    await atRest(page);
    expect(await page.locator('.tab__line').count()).toBe(1);
    const line = (await page.locator('.tab__line').boundingBox())!;
    const tab = (await page.getByTestId('tab-buckets').boundingBox())!;
    expect(Math.abs(line.x - tab.x)).toBeLessThan(1);
    expect(Math.abs(line.width - tab.width)).toBeLessThan(1);
    expect(line.y).toBeLessThan(tab.y + 3);
    await page.context().close();
  });

  it('PR 2: with reduced motion the tab line is on its tab at once', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    await page.getByTestId('tab-buckets').click();
    // Within a moment (a slide takes 250 ms): the line is already under its tab.
    await page.waitForFunction(
      () => {
        const line = document.querySelector('[data-testid="tab-buckets"] .tab__line');
        const tab = document.querySelector('[data-testid="tab-buckets"]');
        return line !== null && tab !== null && Math.abs(line.getBoundingClientRect().x - tab.getBoundingClientRect().x) < 1;
      },
      undefined,
      { timeout: 150 },
    );
    await page.context().close();
  });

  it('PR 2: the Home hero fades, scales and sinks a little as the screen scrolls, and not with reduced motion', async () => {
    const moving = await openScenario(await browser().newContext(phone(MOVING)), base(), 'normal');
    const hero = moving.locator('.screen > .hero');
    await atRest(moving);
    expect(await hero.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    await moving.evaluate(() => window.scrollTo(0, 400));
    await moving.waitForFunction(() => Number(getComputedStyle(document.querySelector('.screen > .hero') as Element).opacity) < 0.9);
    const scrolled = await hero.evaluate((e) => ({ opacity: Number(getComputedStyle(e).opacity), transform: getComputedStyle(e).transform }));
    expect(scrolled.opacity).toBeGreaterThanOrEqual(0.55);
    expect(scrolled.transform).not.toBe('none');
    await moving.context().close();
    const still = await openScenario(await browser().newContext(phone()), base(), 'normal');
    await still.evaluate(() => window.scrollTo(0, 400));
    await still.waitForTimeout(150);
    expect(await still.locator('.screen > .hero').evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    await still.context().close();
  });

  it('PR 2: a light follows the pointer on the hero and the bucket cards, goes when it leaves, and takes no tap', async () => {
    const page = await openScenario(await browser().newContext(phone(MOVING)), base(), 'normal');
    await atRest(page);
    const card = page.getByTestId('bucket-needs');
    // At rest there is no light at all (the contrast check cannot read through one).
    expect(await card.evaluate((e) => getComputedStyle(e, '::after').content)).toBe('none');
    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 20);
    await page.mouse.move(box.x + 40, box.y + 25);
    expect(await card.getAttribute('data-spot')).toBe('on');
    expect(await card.evaluate((e) => (e as HTMLElement).style.getPropertyValue('--spot-x'))).toMatch(/^\d+px$/);
    expect(await card.evaluate((e) => getComputedStyle(e, '::after').pointerEvents)).toBe('none');
    await page.mouse.move(2, 2);
    expect(await card.getAttribute('data-spot')).toBeNull();
    await page.context().close();
    const still = await openScenario(await browser().newContext(phone()), base(), 'normal');
    const b = (await still.getByTestId('bucket-needs').boundingBox())!;
    await still.mouse.move(b.x + 30, b.y + 20);
    await still.mouse.move(b.x + 40, b.y + 25);
    expect(await still.getByTestId('bucket-needs').getAttribute('data-spot')).toBeNull();
    await still.context().close();
  });

  describe('bottom sheets are dragged down to close', () => {
    async function opened(options: Parameters<typeof phone>[0]) {
      const page = await openScenario(await browser().newContext(phone(options)), base(), 'activity-busy', '/buckets/needs');
      await page.getByTestId('move-open').click();
      await page.getByTestId('move-sheet').waitFor();
      await atRest(page);
      return page;
    }

    // Presses on the grabber and pulls straight down by dy, without letting go.
    async function pull(page: Page, dy: number, steps = 6): Promise<void> {
      const grab = (await page.getByTestId('move-sheet-drag').locator('.sheet__grabber').boundingBox())!;
      const x = grab.x + grab.width / 2;
      const y = grab.y + 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + dy, { steps });
    }

    const isOpen = (page: Page): Promise<boolean> => page.getByTestId('move-sheet').evaluate((e) => (e as HTMLDialogElement).open);

    it('PR 2: the sheet follows the finger, and pulled far enough it closes', async () => {
      const page = await opened(MOVING);
      await pull(page, 160);
      expect(await page.getByTestId('move-sheet').evaluate((e) => (e as HTMLElement).style.transform)).toMatch(/^translateY\(1[0-9]{2}(\.\d+)?px\)$/);
      expect(await isOpen(page)).toBe(true);
      await page.mouse.up();
      await page.waitForFunction(() => !(document.querySelector('[data-testid="move-sheet"]') as HTMLDialogElement).open);
      // Nothing is left on it for the next time it opens.
      expect(await page.getByTestId('move-sheet').evaluate((e) => (e as HTMLElement).style.transform)).toBe('');
      await page.getByTestId('move-open').click();
      expect(await isOpen(page)).toBe(true);
      await page.context().close();
    });

    it('PR 2: a short pull slides the sheet back and keeps it open', async () => {
      const page = await opened(MOVING);
      await pull(page, 30);
      await page.mouse.up();
      await page.waitForFunction(() => (document.querySelector('[data-testid="move-sheet"]') as HTMLElement).style.transform === '');
      expect(await isOpen(page)).toBe(true);
      await page.context().close();
    });

    it('PR 2: a quick flick of 60 px closes it, and the same 60 px pulled slowly and let go does not', async () => {
      const flick = await opened(MOVING);
      await pull(flick, 60, 1);
      await flick.mouse.up();
      await flick.waitForFunction(() => !(document.querySelector('[data-testid="move-sheet"]') as HTMLDialogElement).open);
      await flick.context().close();
      const slow = await opened(MOVING);
      await pull(slow, 60);
      await slow.waitForTimeout(400);
      await slow.mouse.up();
      await slow.waitForFunction(() => (document.querySelector('[data-testid="move-sheet"]') as HTMLElement).style.transform === '');
      expect(await isOpen(slow)).toBe(true);
      await slow.context().close();
    });

    it('PR 2: a pull that goes back up before it is let go does not close it', async () => {
      const page = await opened(MOVING);
      await pull(page, 160);
      await page.mouse.move(200, 0);
      const box = (await page.getByTestId('move-sheet-drag').locator('.sheet__grabber').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y - 400, { steps: 4 });
      await page.mouse.up();
      await page.waitForFunction(() => (document.querySelector('[data-testid="move-sheet"]') as HTMLElement).style.transform === '');
      expect(await isOpen(page)).toBe(true);
      await page.context().close();
    });

    it('PR 2: a pull the phone takes over (cancelled) does not close the sheet, however far it went', async () => {
      const page = await opened(MOVING);
      await page.getByTestId('move-sheet-drag').evaluate((e) => {
        (window as unknown as { lastPointer: number }).lastPointer = 1;
        e.addEventListener('pointerdown', (event) => ((window as unknown as { lastPointer: number }).lastPointer = (event as PointerEvent).pointerId), { capture: true });
      });
      // The listener is added after a press would have started, so press again.
      await pull(page, 5);
      await page.mouse.up();
      await pull(page, 200);
      await page.getByTestId('move-sheet-drag').evaluate((e) => {
        const id = (window as unknown as { lastPointer: number }).lastPointer;
        e.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, bubbles: true }));
      });
      await page.waitForFunction(() => (document.querySelector('[data-testid="move-sheet"]') as HTMLElement).style.transform === '');
      expect(await isOpen(page)).toBe(true);
      await page.mouse.up();
      await page.context().close();
    });

    it('PR 2: with reduced motion the sheet still follows a pull and closes, with nothing animated', async () => {
      const page = await opened({});
      await pull(page, 160);
      await page.mouse.up();
      await page.waitForFunction(() => !(document.querySelector('[data-testid="move-sheet"]') as HTMLDialogElement).open);
      await page.context().close();
    });

    it('PR 2: pressing the close button, outside the sheet, and Escape still close it (and a press on the button is no drag)', async () => {
      const page = await opened(MOVING);
      await page.getByTestId('move-sheet').getByRole('button', { name: 'Close' }).click();
      await page.waitForFunction(() => !(document.querySelector('[data-testid="move-sheet"]') as HTMLDialogElement).open);
      await page.getByTestId('move-open').click();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !(document.querySelector('[data-testid="move-sheet"]') as HTMLDialogElement).open);
      await page.context().close();
    });
  });
});
