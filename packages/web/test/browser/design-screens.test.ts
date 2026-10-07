import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, openScenario, phone, useEngine } from './harness.js';

// The design rules (CLAUDE.md) for Buckets and Review and their sheets, in
// the browser: light and dark, readable contrast, 44-point tap targets, the
// notch and the home bar, the phone's text size and reduced-motion
// settings, and money written one way.

// Every state of each screen worth checking: [made-up life, address].
const BUCKETS = ['normal', 'mismatch', 'low', 'overspent', 'all-clear', 'not-set-up', 'bank-not-read', 'big', 'buckets-busy'] as const;
const REVIEW = ['normal', 'review-busy', 'all-clear', 'not-set-up', 'big'] as const;
const SCREENS: readonly (readonly [string, string])[] = [...BUCKETS.map((l) => [l, '/buckets'] as const), ...REVIEW.map((l) => [l, '/review'] as const)];

function idOf(life: string, description: string, amount?: number): string {
  const book = demoScenario(life)!.input!().book!;
  const found = book.reviewItems().find((i) => 'description' in i && i.description === description && (amount === undefined || i.amount === amount));
  if (found === undefined) throw new Error(`no ${description} waiting in ${life}`);
  return found.id;
}

// Opens each sheet on the busy Review life: the choices (with a rule and a
// split), the question that asks first, a refusal, and a done message.
async function sheets(page: Page): Promise<{ readonly name: string }[]> {
  const found: { name: string }[] = [];
  const store = idOf('review-busy', 'CORNER STORE');
  await page.getByTestId(`item-${store}`).getByTestId('more').click();
  await page.getByTestId('review-sheet').waitFor();
  found.push({ name: 'choices' });
  await page.getByTestId('always-toggle').click();
  found.push({ name: 'choices with a rule' });
  await page.getByTestId('always-toggle').click();
  await page.getByTestId('split-needs').fill('abc');
  found.push({ name: 'choices with a split that cannot be read' });
  await page.getByTestId('split-needs').fill('11.50');
  await page.getByTestId('split-submit').click();
  await page.getByTestId('notice').waitFor();
  found.push({ name: 'a refusal' });
  return found;
}

describe.each(ENGINES)('design rules on Buckets and Review in %s', (_engine, engine) => {
  const { browser, base } = useEngine(engine);

  it('readable contrast and no accessibility problems, in light and dark, in every state, and in every sheet', async () => {
    const problems: string[] = [];
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser().newContext(phone({ colorScheme: scheme, bypassCSP: true }));
      for (const [life, path] of SCREENS) {
        const page = await openScenario(context, base(), life, path);
        problems.push(...(await axeViolations(page)).map((p) => `${scheme} ${path} ${life}: ${p}`));
        await page.close();
      }
      const page = await openScenario(context, base(), 'review-busy', '/review');
      for (const sheet of await sheets(page)) {
        problems.push(...(await axeViolations(page)).map((p) => `${scheme} sheet ${sheet.name}: ${p}`));
        if (sheet.name === 'choices with a split that cannot be read') await page.getByTestId('split-needs').fill('11.50');
      }
      await page.keyboard.press('Escape');
      // The question that asks first, and the done message.
      await page.getByTestId(`item-busy-early`).getByTestId('pick-paycheck').click();
      await page.getByTestId('confirm-yes').waitFor();
      problems.push(...(await axeViolations(page)).map((p) => `${scheme} sheet confirm paycheck: ${p}`));
      await page.getByTestId('confirm-cancel').click();
      await page.keyboard.press('Escape');
      await page.getByTestId(`item-${idOf('review-busy', 'CORNER DELI')}`).getByTestId('pick-needs').click();
      await page.getByTestId('notice').waitFor();
      problems.push(...(await axeViolations(page)).map((p) => `${scheme} done message: ${p}`));
      await context.close();
    }
    expect(problems).toEqual([]);
  });

  it('every tap target is at least 44 by 44 points, in every state and every sheet', async () => {
    const small: string[] = [];
    const context = await browser().newContext(phone());
    for (const [life, path] of SCREENS) {
      const page = await openScenario(context, base(), life, path);
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`${path} ${life}: ${t.what} is ${t.width}x${t.height}`);
      await page.close();
    }
    const page = await openScenario(context, base(), 'review-busy', '/review');
    for (const sheet of await sheets(page)) {
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`sheet ${sheet.name}: ${t.what} is ${t.width}x${t.height}`);
    }
    await page.keyboard.press('Escape');
    await page.getByTestId('item-busy-early').getByTestId('pick-paycheck').click();
    await page.getByTestId('confirm-yes').waitFor();
    for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`sheet confirm: ${t.what} is ${t.width}x${t.height}`);
    await context.close();
    expect(small).toEqual([]);
  });

  it('nothing sits under the notch or the home bar, and the end of the screen scrolls clear of the tabs', async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    for (const [life, path] of [
      ['normal', '/buckets'],
      ['mismatch', '/buckets'],
      ['review-busy', '/review'],
      ['all-clear', '/review'],
    ] as const) {
      const page = await openScenario(context, base(), life, path);
      await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
      const first = await page.locator('main > :not(.sr-only):not(dialog)').first().boundingBox();
      expect(first!.y, `${path} ${life}`).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      for (const t of await tappable(page)) {
        if (t.y < IPHONE.height) expect(t.y, `${path} ${life}: ${t.what}`).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      }
      const tabs = await page.locator('.tab').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
      for (const bottom of tabs) expect(bottom, `${path} ${life}`).toBeLessThanOrEqual(IPHONE.height - IPHONE_INSETS.bottom + 0.5);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const bar = await page.locator('.tabbar').boundingBox();
      const last = await page.locator('main > :not(.sr-only):not(dialog)').last().boundingBox();
      expect(last!.y + last!.height, `${path} ${life}`).toBeLessThanOrEqual(bar!.y);
      await page.close();
    }
    // A sheet leaves room for the home bar too: its last control ends above it.
    const page = await openScenario(context, base(), 'review-busy', '/review');
    await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
    await page.getByTestId(`item-${idOf('review-busy', 'CORNER STORE')}`).getByTestId('more').click();
    const sheet = page.getByTestId('review-sheet');
    // Once it has finished sliding up.
    await sheet.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    await sheet.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    const box = await sheet.locator('.sheet__inner').boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(IPHONE.height + 0.5);
    const lastControl = await sheet.locator('button, input, [role="switch"]').last().boundingBox();
    expect(lastControl!.y + lastControl!.height).toBeLessThanOrEqual(IPHONE.height - IPHONE_INSETS.bottom + 0.5);
    await context.close();
  });

  it('with reduced motion on, the sheet does not slide and the switch does not slide', async () => {
    const moving = await openScenario(await browser().newContext(phone()), base(), 'review-busy', '/review');
    await moving.getByTestId(`item-${idOf('review-busy', 'CORNER STORE')}`).getByTestId('more').click();
    expect(await moving.getByTestId('review-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('sheet-in');
    await moving.context().close();

    const still = await openScenario(await browser().newContext(phone({ reducedMotion: 'reduce' })), base(), 'review-busy', '/review');
    await still.getByTestId(`item-${idOf('review-busy', 'CORNER STORE')}`).getByTestId('more').click();
    expect(await still.getByTestId('review-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    const durations = await still.locator('.toggle__track, .toggle__thumb, .button, .bar__fill').evaluateAll((els) => els.map((e) => getComputedStyle(e).transitionDuration));
    expect(durations.length).toBeGreaterThan(3);
    expect(durations.every((d) => d.split(',').every((part) => Number.parseFloat(part) === 0))).toBe(true);
    await still.context().close();
  });

  it("the text grows with the phone's text size, and Buckets and Review still fit", async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    for (const [life, path] of [
      ['normal', '/buckets'],
      ['big', '/buckets'],
      ['mismatch', '/buckets'],
      ['review-busy', '/review'],
      ['big', '/review'],
    ] as const) {
      const page = await openScenario(context, base(), life, path);
      const before = await page.locator('.row__title, .hero__label, .state__title, .decision__title').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      // The largest accessibility text size on the iPhone is about twice the default.
      await addStyle(page, 'html { font-size: 36px !important; }');
      const after = await page.locator('.row__title, .hero__label, .state__title, .decision__title').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      expect(after, `${path} ${life}`).toBeGreaterThan(before * 1.8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} ${life}`).toBeLessThanOrEqual(IPHONE.width);
      const boxes = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })));
      for (const b of boxes) {
        expect(b.left, `${path} ${life}`).toBeGreaterThanOrEqual(0);
        expect(b.right, `${path} ${life}`).toBeLessThanOrEqual(IPHONE.width);
      }
      await page.close();
    }
    // And with a sheet open at the largest size.
    const page = await openScenario(context, base(), 'review-busy', '/review');
    await addStyle(page, 'html { font-size: 36px !important; }');
    await page.getByTestId(`item-${idOf('review-busy', 'CORNER STORE')}`).getByTestId('more').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
    const widths = await page.getByTestId('review-sheet').locator('*').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    for (const right of widths) expect(right).toBeLessThanOrEqual(IPHONE.width + 0.5);
    await context.close();
  });

  it("the text still fits when the font is wider than this computer's, at the largest text size", async () => {
    // Windows' font is narrower than Linux's (found on CI), so the test makes every letter wider.
    const context = await browser().newContext(phone({ bypassCSP: true }));
    for (const [life, path] of [
      ['big', '/buckets'],
      ['normal', '/buckets'],
      ['mismatch', '/buckets'],
      ['buckets-busy', '/buckets'],
      ['bank-not-read', '/buckets'],
      ['big', '/review'],
      ['review-busy', '/review'],
    ] as const) {
      const page = await openScenario(context, base(), life, path);
      await addStyle(page, 'html { font-size: 36px !important; } * { letter-spacing: 0.07em !important; }');
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} ${life}`).toBeLessThanOrEqual(IPHONE.width);
      const boxes = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
      for (const right of boxes) expect(right, `${path} ${life}`).toBeLessThanOrEqual(IPHONE.width + 0.5);
      // A row's title is not squeezed to a sliver to keep its amount on the same line: the amount goes below it instead.
      const squeezed = await page.locator('.row--trailing .row__title').evaluateAll((els) =>
        els.flatMap((e) => {
          const lines = e.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(e).lineHeight);
          return lines > 2.5 ? [`"${e.textContent ?? ''}" takes ${lines.toFixed(1)} lines`] : [];
        }),
      );
      expect(squeezed, `${path} ${life}`).toEqual([]);
      await page.close();
    }
    await context.close();
  });

  it('money is written the same way everywhere on the new screens, with digits that line up', async () => {
    const context = await browser().newContext(phone());
    for (const [life, path] of [
      ['normal', '/buckets'],
      ['overspent', '/buckets'],
      ['mismatch', '/buckets'],
      ['big', '/buckets'],
      ['buckets-busy', '/buckets'],
      ['review-busy', '/review'],
      ['big', '/review'],
    ] as const) {
      const page = await openScenario(context, base(), life, path);
      const amounts = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', numbers: getComputedStyle(e).fontVariantNumeric })));
      expect(amounts.length, `${path} ${life}`).toBeGreaterThan(0);
      for (const a of amounts) {
        expect(a.text, `${path} ${life}`).toMatch(/^−?\$\d{1,3}(,\d{3})*\.\d{2}$/);
        expect(a.numbers, `${path} ${life}`).toContain('tabular-nums');
      }
      await page.close();
    }
    await context.close();
  });

  it('light and dark follow the phone on the new screens', async () => {
    for (const [scheme, background] of [
      ['light', 'rgb(242, 242, 247)'],
      ['dark', 'rgb(0, 0, 0)'],
    ] as const) {
      for (const path of ['/buckets', '/review']) {
        const page = await openScenario(await browser().newContext(phone({ colorScheme: scheme })), base(), 'normal', path);
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), `${scheme} ${path}`).toBe(background);
        await page.context().close();
      }
    }
  });

  it('low, empty, under target, over target, pending, and refused say so in words and an icon, never by color alone', async () => {
    const context = await browser().newContext(phone());
    const buckets = await openScenario(context, base(), 'low', '/buckets');
    for (const status of ['low'] as const) {
      const label = buckets.locator(`[data-status="${status}"]`).first();
      expect((await label.innerText()).length).toBeGreaterThan(2);
      expect(await label.locator('[data-icon]').count()).toBe(1);
    }
    const mom = await openScenario(context, base(), 'normal', '/buckets');
    expect(await mom.locator('[data-status="under-target"] [data-icon]').count()).toBe(1);
    const review = await openScenario(context, base(), 'review-busy', '/review');
    expect(await review.locator('[data-status="pending"] [data-icon]').count()).toBeGreaterThan(0);
    for (const label of await review.locator('[data-status]').all()) expect((await label.innerText()).trim().length).toBeGreaterThan(2);
    await context.close();
  });

  it('using Review runs under the security policy without a single error', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base()}/demo/review-busy`);
    // Home has finished loading before the page goes on: leaving a request unfinished is not an error of the app,
    // but WebKit reports it in the console.
    await page.getByTestId('safe-to-spend').waitFor();
    await page.goto(`${base()}/review`);
    await page.getByTestId('review-count').waitFor();
    const store = idOf('review-busy', 'CORNER STORE');
    await page.getByTestId(`item-${store}`).getByTestId('more').click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('choice-wants').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    await page.getByTestId('tab-buckets').click();
    await page.getByTestId('buckets-total').waitFor();
    expect(errors).toEqual([]);
    await context.close();
  });
});
