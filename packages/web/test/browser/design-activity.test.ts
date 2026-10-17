import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { rowOf } from './activity-screens.js';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, emulatePhone, openScenario, phone, showScenario, useEngine } from './harness.js';

// The design rules (CLAUDE.md) for the bucket lists, hand moves, and Payday
// and their sheets, in the browser: light and dark, readable contrast,
// 44-point tap targets, the notch and the home bar, the phone's text size and
// reduced-motion settings, and money written one way.

const ACTIVITY: readonly (readonly [string, string])[] = [
  ['activity-busy', '/buckets/needs'],
  ['activity-busy', '/buckets/wants'],
  ['activity-busy', '/buckets/savings'],
  ['activity-busy', '/buckets/mom-reserve'],
  ['activity-busy', '/buckets/held-for-others'],
  ['normal', '/buckets/needs'],
  ['overspent', '/buckets/wants'],
  ['activity-marked', '/buckets/needs'],
  ['big', '/buckets/needs'],
  ['not-set-up', '/buckets/needs'],
  ['error', '/buckets/needs'],
];
const PAYDAY: readonly (readonly [string, string])[] = [
  ['payday-paid', '/payday'],
  ['on-its-way', '/payday'],
  ['normal', '/payday'],
  ['late', '/payday'],
  ['bank-not-read', '/payday'],
  ['big', '/payday'],
  ['not-set-up', '/payday'],
  ['error', '/payday'],
];
const SCREENS: readonly (readonly [string, string])[] = [...ACTIVITY, ...PAYDAY];

const GROCERY_OCT_1 = rowOf(demoScenario('activity-busy')!.input!().book!, 'needs', (r) => r.what === 'purchase' && r.date === '2026-10-01').id;

// Opens each sheet there is on the bucket lists and Payday, one after another,
// and says which it has open.
async function activitySheets(page: Page): Promise<string[]> {
  const found: string[] = [];
  await page.getByTestId(`row-${GROCERY_OCT_1}`).click();
  await page.getByTestId('activity-sheet').waitFor();
  found.push('row choices');
  await page.getByTestId('always-toggle').click();
  found.push('row choices with a rule');
  await page.getByTestId('always-toggle').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('row-demo-pay').click();
  await page.getByTestId('cannot-resort').waitFor();
  found.push('a row that cannot be sorted again');
  await page.keyboard.press('Escape');
  await page.getByTestId('row-act-landlord').click();
  await page.getByTestId('marked-note').waitFor();
  found.push('a payment marked as going to the old card');
  await page.keyboard.press('Escape');
  await page.getByTestId('move-open').click();
  await page.getByTestId('move-sheet').waitFor();
  found.push('move form');
  await page.getByTestId('move-amount').fill('abc');
  found.push('move form with an amount that cannot be read');
  await page.getByTestId('move-from').selectOption('savings');
  await page.getByTestId('move-amount').fill('100.00');
  await page.getByTestId('move-submit').click();
  await page.getByTestId('move-confirm-title').waitFor();
  found.push('move asking first');
  await page.getByTestId('move-confirm-cancel').click();
  await page.getByTestId('move-from').selectOption('needs');
  await page.getByTestId('move-to').selectOption('needs');
  await page.getByTestId('move-submit').click();
  await page.getByTestId('move-problem').waitFor();
  found.push('move refused');
  return found;
}

describe.each(ENGINES)('design rules on the bucket lists, moves and Payday in %s', (_engine, engine) => {
  const { browser, base } = useEngine(engine);

  // One test for each colour scheme and each part (every state; every sheet,
  // with Payday asking first and its done message): the pass over every
  // screen and every sheet is long (the checks wait for the screen to be at
  // rest). Both schemes together came close to the time limit on the slower
  // machines, and one scheme went past it in WebKit when the whole suite ran
  // (Oct 9). Together they check exactly what the one test did.
  for (const scheme of ['light', 'dark'] as const) {
    // Each test has one page, moved from screen to screen and the life started
    // over each time (showLive in live.ts says why).
    it(`readable contrast and no accessibility problems, in ${scheme} mode, in every state`, async () => {
      const problems: string[] = [];
      const context = await browser().newContext(phone({ colorScheme: scheme, bypassCSP: true }));
      const page = await context.newPage();
      for (const [life, path] of SCREENS) {
        await showScenario(page, base(), life, path);
        problems.push(...(await axeViolations(page)).map((p) => `${scheme} ${path} ${life}: ${p}`));
      }
      await context.close();
      expect(problems).toEqual([]);
    });

    it(`readable contrast and no accessibility problems, in ${scheme} mode, in every sheet`, async () => {
      const problems: string[] = [];
      const context = await browser().newContext(phone({ colorScheme: scheme, bypassCSP: true }));
      const page = await openScenario(context, base(), 'activity-marked', '/buckets/needs');
      const names = await activitySheets(page);
      // The checks run on each sheet as it is open: redo them one by one.
      for (const name of names) {
        await showScenario(page, base(), 'activity-marked', '/buckets/needs');
        const opened = await activitySheetsUpTo(page, name);
        expect(opened).toBe(name);
        problems.push(...(await axeViolations(page)).map((p) => `${scheme} sheet ${name}: ${p}`));
      }
      // Payday asking first, and the done message.
      await showScenario(page, base(), 'payday-paid', '/payday');
      await page.locator('[data-testid^="item-leftover"]').first().getByTestId('answer-roll-over').click();
      await page.getByTestId('confirm-yes').waitFor();
      problems.push(...(await axeViolations(page)).map((p) => `${scheme} sheet payday confirm: ${p}`));
      await page.getByTestId('confirm-yes').click();
      await page.getByTestId('notice').waitFor();
      problems.push(...(await axeViolations(page)).map((p) => `${scheme} payday done message: ${p}`));
      await context.close();
      expect(problems).toEqual([]);
    });
  }

  it('every tap target is at least 44 by 44 points, in every state and every sheet', async () => {
    const small: string[] = [];
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const [life, path] of SCREENS) {
      await showScenario(page, base(), life, path);
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`${path} ${life}: ${t.what} is ${t.width}x${t.height}`);
    }
    await showScenario(page, base(), 'activity-marked', '/buckets/needs');
    const names = await activitySheets(page);
    for (const name of names) {
      await showScenario(page, base(), 'activity-marked', '/buckets/needs');
      await activitySheetsUpTo(page, name);
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`sheet ${name}: ${t.what} is ${t.width}x${t.height}`);
    }
    await showScenario(page, base(), 'payday-paid', '/payday');
    await page.locator('[data-testid^="item-leftover"]').first().getByTestId('answer-roll-over').click();
    await page.getByTestId('confirm-yes').waitFor();
    for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`sheet payday confirm: ${t.what} is ${t.width}x${t.height}`);
    await context.close();
    expect(small).toEqual([]);
  });

  it('nothing sits under the notch or the home bar, and the end of the screen scrolls clear of the tabs', async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    const page = await context.newPage();
    for (const [life, path] of [
      ['activity-busy', '/buckets/needs'],
      ['activity-busy', '/buckets/held-for-others'],
      ['payday-paid', '/payday'],
      ['not-set-up', '/payday'],
    ] as const) {
      await showScenario(page, base(), life, path);
      await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
      const first = await page.locator('main > :not(.sr-only):not(dialog)').first().boundingBox();
      expect(first!.y, `${path} ${life}`).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      for (const t of await tappable(page)) {
        if (t.y < IPHONE.height) expect(t.y, `${path} ${life}: ${t.what}`).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const bar = await page.locator('.tabbar').boundingBox();
      const last = await page.locator('main > :not(.sr-only):not(dialog)').last().boundingBox();
      expect(last!.y + last!.height, `${path} ${life}`).toBeLessThanOrEqual(bar!.y);
    }
    // A sheet leaves room for the home bar too: its last control ends above it.
    await showScenario(page, base(), 'activity-marked', '/buckets/needs');
    await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
    await page.getByTestId(`row-${GROCERY_OCT_1}`).click();
    const sheet = page.getByTestId('activity-sheet');
    await sheet.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    await sheet.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    const lastControl = await sheet.locator('button, input, [role="switch"]').last().boundingBox();
    expect(lastControl!.y + lastControl!.height).toBeLessThanOrEqual(IPHONE.height - IPHONE_INSETS.bottom + 0.5);
    await context.close();
  });

  it('with reduced motion on, the move sheet does not slide', async () => {
    const page = await openScenario(await browser().newContext(phone({ reducedMotion: 'no-preference' })), base(), 'activity-busy', '/buckets/needs');
    await page.getByTestId('move-open').click();
    expect(await page.getByTestId('move-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('sheet-in');
    // The same page with motion reduced, the life started over.
    await emulatePhone(page, { reducedMotion: 'reduce' });
    await showScenario(page, base(), 'activity-busy', '/buckets/needs');
    await page.getByTestId('move-open').click();
    expect(await page.getByTestId('move-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    const durations = await page.locator('.row, .button, .field__input').evaluateAll((els) => els.map((e) => getComputedStyle(e).transitionDuration));
    expect(durations.every((d) => d.split(',').every((part) => Number.parseFloat(part) === 0))).toBe(true);
    await page.context().close();
  });

  it("the text grows with the phone's text size, and the new screens still fit", async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    const page = await context.newPage();
    for (const [life, path] of [
      ['activity-busy', '/buckets/needs'],
      ['big', '/buckets/needs'],
      ['activity-busy', '/buckets/mom-reserve'],
      ['payday-paid', '/payday'],
      ['big', '/payday'],
      ['bank-not-read', '/payday'],
    ] as const) {
      await showScenario(page, base(), life, path);
      const before = await page.locator('.row__title, .hero__label, .state__title, .decision__title').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      await addStyle(page, 'html { font-size: 36px !important; }');
      const after = await page.locator('.row__title, .hero__label, .state__title, .decision__title').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      expect(after, `${path} ${life}`).toBeGreaterThan(before * 1.8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} ${life}`).toBeLessThanOrEqual(IPHONE.width);
      const boxes = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })));
      for (const b of boxes) {
        expect(b.left, `${path} ${life}`).toBeGreaterThanOrEqual(0);
        expect(b.right, `${path} ${life}`).toBeLessThanOrEqual(IPHONE.width);
      }
    }
    // And with the move sheet open at the largest size.
    await showScenario(page, base(), 'activity-marked', '/buckets/needs');
    await addStyle(page, 'html { font-size: 36px !important; }');
    await page.getByTestId('move-open').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
    for (const right of await page.getByTestId('move-sheet').locator('*').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(right).toBeLessThanOrEqual(IPHONE.width + 0.5);
    await context.close();
  });

  it('money is written the same way everywhere on the new screens, with digits that line up, and money that came in has a plus', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const [life, path] of [
      ['activity-busy', '/buckets/needs'],
      ['activity-busy', '/buckets/wants'],
      ['big', '/buckets/needs'],
      ['payday-paid', '/payday'],
      ['big', '/payday'],
    ] as const) {
      await showScenario(page, base(), life, path);
      const amounts = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', numbers: getComputedStyle(e).fontVariantNumeric })));
      expect(amounts.length, `${path} ${life}`).toBeGreaterThan(0);
      for (const a of amounts) {
        expect(a.text, `${path} ${life}`).toMatch(/^[−+]?\$\d{1,3}(,\d{3})*\.\d{2}$/);
        expect(a.numbers, `${path} ${life}`).toContain('tabular-nums');
      }
    }
    // Money coming in is a plus and money going out is a minus: the direction is in the amount itself.
    await showScenario(page, base(), 'activity-marked', '/buckets/needs');
    const rows = await page.locator('[data-testid="row-amount"]').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', label: e.getAttribute('aria-label') })));
    expect(rows.some((r) => r.text.startsWith('+') && r.label?.startsWith('plus '))).toBe(true);
    expect(rows.some((r) => r.text.startsWith('−') && r.label?.startsWith('minus '))).toBe(true);
    await context.close();
  });

  it('dark only, whatever the phone is set to, on the new screens', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    for (const [scheme, background] of [
      ['light', 'rgb(5, 5, 6)'],
      ['dark', 'rgb(5, 5, 6)'],
    ] as const) {
      await emulatePhone(page, { colorScheme: scheme });
      for (const path of ['/buckets/needs', '/payday']) {
        await showScenario(page, base(), 'normal', path);
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), `${scheme} ${path}`).toBe(background);
      }
    }
    await context.close();
  });

  it('pending, refunded, and refused say so in words, never by color alone', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'activity-busy', '/buckets/wants');
    const pending = page.locator('[data-status="pending"]').first();
    expect((await pending.innerText()).length).toBeGreaterThan(2);
    expect(await pending.locator('[data-icon]').count()).toBe(1);
    await showScenario(page, base(), 'activity-busy', '/buckets/needs');
    expect(await page.getByTestId(`row-${rowOf(demoScenario('activity-busy')!.input!().book!, 'needs', (r) => r.refunded > 0).id}`).innerText()).toContain('Refunded');
    await page.context().close();
  });

  it('using the new screens runs under the security policy without a single error', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base()}/demo/activity-busy`);
    await page.getByTestId('safe-to-spend').waitFor();
    await page.goto(`${base()}/buckets/needs`);
    await page.getByTestId('activity-now').waitFor();
    await page.getByTestId(`row-${GROCERY_OCT_1}`).click();
    await untilAskedAgain(page, async () => {
      await page.getByTestId('activity-sheet').getByTestId('choice-wants').click();
      await page.getByTestId('notice').waitFor();
    });
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('5.00');
    await untilAskedAgain(page, async () => {
      await page.getByTestId('move-submit').click();
      await page.getByTestId('notice').waitFor();
    });
    await page.goto(`${base()}/payday`);
    await page.getByTestId('paycheck-amount').waitFor();
    expect(errors, errors.join(' | ')).toEqual([]);
    await context.close();
  });
});

// After a change the screens ask for the bucket's list and for Home again.
// Leaving the page while one of those is on its way is not an error of the
// app, but WebKit reports the cut-short request as one (and waiting for
// "network idle" does not help: the page was already idle once). So the test
// waits for both answers, whole, before it goes anywhere.
async function untilAskedAgain(page: Page, change: () => Promise<void>): Promise<void> {
  const answered = Promise.all([
    page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname.startsWith('/api/activity/')),
    page.waitForResponse((r) => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/home'),
  ]);
  await change();
  for (const response of await answered) await response.finished();
}

// Opens the sheets in order, up to and including the one with this name, and
// returns its name (so each sheet can be checked on its own, from a fresh start).
async function activitySheetsUpTo(page: Page, name: string): Promise<string> {
  const order = ['row choices', 'row choices with a rule', 'a row that cannot be sorted again', 'a payment marked as going to the old card', 'move form', 'move form with an amount that cannot be read', 'move asking first', 'move refused'];
  const target = order.indexOf(name);
  if (target === -1) throw new Error(`no sheet called ${name}`);
  const open = async (id: string): Promise<void> => {
    await page.getByTestId(`row-${id}`).click();
  };
  if (target <= 1) {
    await open(GROCERY_OCT_1);
    await page.getByTestId('activity-sheet').waitFor();
    if (target === 1) await page.getByTestId('always-toggle').click();
    return name;
  }
  if (target === 2) {
    await open('demo-pay');
    await page.getByTestId('cannot-resort').waitFor();
    return name;
  }
  if (target === 3) {
    await open('act-landlord');
    await page.getByTestId('marked-note').waitFor();
    return name;
  }
  await page.getByTestId('move-open').click();
  await page.getByTestId('move-sheet').waitFor();
  if (target === 4) return name;
  if (target === 5) {
    await page.getByTestId('move-amount').fill('abc');
    return name;
  }
  if (target === 6) {
    await page.getByTestId('move-from').selectOption('savings');
    await page.getByTestId('move-amount').fill('100.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-confirm-title').waitFor();
    return name;
  }
  await page.getByTestId('move-from').selectOption('needs');
  await page.getByTestId('move-to').selectOption('needs');
  await page.getByTestId('move-amount').fill('1.00');
  await page.getByTestId('move-submit').click();
  await page.getByTestId('move-problem').waitFor();
  return name;
}
