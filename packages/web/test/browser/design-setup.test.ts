import type { BrowserContext, Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { addStyle, atRest, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, phone, textAt, untilQuiet, useEngine, watchPage } from './harness.js';
import { answerHalf, openSetup, typeAmount, type SetupStepName } from './setup-screens.js';

// The design rules (CLAUDE.md) on the Setup day screens and their sheets:
// light and dark, readable contrast, 44-point tap targets, the notch and the
// home bar, the phone's text size and reduced motion, money written one way,
// and what each state means said in words, not by color alone. Every screen
// has a loading, an empty, and an error state.

const STEPS: readonly SetupStepName[] = ['bank', 'rules', 'transfers', 'paycheck', 'assign', 'check'];

// Every state: [where, made-up life, step, what to do first].
const STATES: readonly (readonly [string, string, SetupStepName, ((page: Page) => Promise<void>) | null])[] = [
  ...STEPS.map((step) => [`setup-day ${step}`, 'setup-day', step, null] as const),
  ...STEPS.map((step) => [`setup-owes-more ${step}`, 'setup-owes-more', step, null] as const),
  // 20a: every suggestion open; the transfers step says to answer them first.
  ['suggestions to answer', 'setup-suggest', 'rules', null],
  ['the transfers step before the suggestions', 'setup-suggest', 'transfers', null],
  ['suggestions answered', 'setup-suggest', 'rules', async (page) => {
    const cards = page.locator('[data-testid^="suggestion-s-"]');
    await cards.nth(0).getByTestId('suggestion-add').click();
    await cards.nth(0).getByTestId('suggestion-status').filter({ hasText: 'added' }).waitFor();
    await untilQuiet(page);
    await cards.nth(6).getByTestId('suggestion-skip').click();
    await cards.nth(6).getByTestId('suggestion-status').filter({ hasText: 'skipped' }).waitFor();
    await untilQuiet(page);
  }],
  ['answered transfers', 'setup-day', 'transfers', async (page) => {
    await answerHalf(page, 'su-card-left', true);
    await answerHalf(page, 'su-sav-landed', false);
  }],
  ['more assigned than there is', 'setup-owes-more', 'assign', async (page) => {
    await typeAmount(page, 'savings', '150.00');
  }],
  ['the self-check passes', 'setup-owes-more', 'check', async (page) => {
    await page.goto(page.url().replace('/setup/check', '/setup/paycheck'));
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.getByTestId('last-paycheck').click();
    await page.getByTestId('date').fill('2026-10-02');
    await page.getByTestId('sheet-save').click();
    await page.waitForFunction(() => document.querySelector('dialog[open]') === null);
    await untilQuiet(page);
    await page.goto(page.url().replace('/setup/paycheck', '/setup/assign'));
    await page.locator('main[aria-busy="false"]').waitFor();
    await typeAmount(page, 'needs', '-1,756.47');
    await page.goto(page.url().replace('/setup/assign', '/setup/check'));
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.getByTestId('self-check-passes').waitFor();
    await untilQuiet(page);
  }],
  ['the bank cannot be read yet', 'not-set-up', 'bank', null],
  ['setup day done', 'normal', 'check', null],
  ['the error state', 'error', 'bank', null],
];

// Every sheet: [name, made-up life, step, how to open it].
const SHEETS: readonly (readonly [string, string, SetupStepName, (page: Page) => Promise<void>])[] = [
  ['a suggestion, changed first', 'setup-suggest', 'rules', async (page) => {
    await page.locator('[data-testid^="suggestion-s-"]').nth(2).getByTestId('suggestion-change').click();
    await page.getByTestId('field-bank-text').waitFor();
  }],
  ['a bank rule, before the yes', 'setup-suggest', 'rules', async (page) => {
    await page.getByTestId('row-add-bank-rule').click();
    await page.getByTestId('field-bank-text').fill('Zelle payment to');
    await page.getByTestId('field-bank-means').selectOption('payment-to-person');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-ask').waitFor();
    await untilQuiet(page);
  }],
  ['how far back', 'setup-day', 'transfers', async (page) => {
    await page.getByTestId('look-back-row').click();
    await page.getByTestId('look-back-days').waitFor();
  }],
  ['an amount', 'setup-day', 'assign', async (page) => {
    await page.getByTestId('assign-needs').click();
    await page.getByTestId('amount').waitFor();
  }],
  ['an amount that cannot be read', 'setup-day', 'assign', async (page) => {
    await page.getByTestId('assign-needs').click();
    await page.getByTestId('amount').fill('12.5');
    await page.getByTestId('sheet-reading').waitFor();
  }],
  ['the last paycheck, refused', 'setup-day', 'paycheck', async (page) => {
    await page.getByTestId('last-paycheck').click();
    await page.getByTestId('date').fill('2026-10-09');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('sheet-problem').waitFor();
    await untilQuiet(page);
  }],
  ['starting, asking first', 'setup-owes-more', 'check', async (page) => {
    for (const step of ['paycheck', 'assign'] as const) {
      await page.goto(page.url().replace(/\/setup\/[a-z]+$/, `/setup/${step}`));
      await page.locator('main[aria-busy="false"]').waitFor();
      if (step === 'paycheck') {
        await page.getByTestId('last-paycheck').click();
        await page.getByTestId('date').fill('2026-10-02');
        await page.getByTestId('sheet-save').click();
        await page.waitForFunction(() => document.querySelector('dialog[open]') === null);
        await untilQuiet(page);
      } else await typeAmount(page, 'needs', '-1,756.47');
    }
    await page.goto(page.url().replace('/setup/assign', '/setup/check'));
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.getByTestId('start').click();
    await page.getByTestId('confirm-yes').waitFor();
    await untilQuiet(page);
  }],
];

// part: only the states, or only the sheets; both when left out.
async function each(context: BrowserContext, base: string, check: (page: Page, where: string) => Promise<void>, part?: 'states' | 'sheets'): Promise<void> {
  for (const [where, life, step, first] of part === 'sheets' ? [] : STATES) {
    const page = await openSetup(context, base, life, step);
    if (first !== null) await first(page);
    await check(page, where);
    await page.close();
  }
  for (const [name, life, step, open] of part === 'states' ? [] : SHEETS) {
    const page = await openSetup(context, base, life, step);
    await open(page);
    await check(page, `sheet: ${name}`);
    await page.close();
  }
}

describe.each(ENGINES)('design rules on Setup day in %s', (_engine, engine) => {
  const { browser, base } = useEngine(engine);

  // One test for each colour scheme and each part (every state, every
  // sheet): in WebKit one scheme took about 30 s alone (Oct 9), as long as
  // the ones that went past the time limit with the whole suite running.
  // Together they check exactly what one test per scheme did.
  for (const scheme of ['light', 'dark'] as const) {
    for (const part of ['states', 'sheets'] as const) {
      it(`readable contrast and no accessibility problems, in ${scheme} mode, in every ${part === 'states' ? 'state' : 'sheet'}`, async () => {
        const problems: string[] = [];
        const context = await browser().newContext(phone({ colorScheme: scheme, bypassCSP: true }));
        await each(context, base(), async (page, where) => {
          problems.push(...(await axeViolations(page)).map((p) => `${scheme} ${where}: ${p}`));
        }, part);
        await context.close();
        expect(problems).toEqual([]);
      });
    }
  }

  it('every tap target is at least 44 by 44 points, in every state and every sheet', async () => {
    const small: string[] = [];
    const context = await browser().newContext(phone());
    await each(context, base(), async (page, where) => {
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`${where}: ${t.what} is ${t.width}x${t.height}`);
    });
    await context.close();
    expect(small).toEqual([]);
  });

  it('nothing sits under the notch or the home bar, and the end of each step scrolls clear of the tabs', async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    for (const step of STEPS) {
      const page = await openSetup(context, base(), 'setup-day', step);
      await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
      const first = await page.locator('main > :not(.sr-only):not(dialog)').first().boundingBox();
      expect(first!.y, step).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const bar = await page.locator('.tabbar').boundingBox();
      const last = await page.locator('main > :not(.sr-only):not(dialog)').last().boundingBox();
      expect(last!.y + last!.height, step).toBeLessThanOrEqual(bar!.y);
      await page.close();
    }
    await context.close();
  });

  it("the text grows with the phone's text size, and every step still fits", async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    for (const [life, step] of [...STEPS.map((s) => ['setup-day', s] as const), ['setup-owes-more', 'bank'] as const]) {
      const page = await openSetup(context, base(), life, step);
      const before = await page.locator('.screen-title').evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      await addStyle(page, 'html { font-size: 36px !important; }');
      const after = await page.locator('.screen-title').evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      expect(after, `${life} ${step}`).toBeGreaterThan(before * 1.8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${life} ${step}`).toBeLessThanOrEqual(IPHONE.width);
      for (const b of await page.locator('[data-money]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })))) {
        expect(b.left, `${life} ${step}`).toBeGreaterThanOrEqual(0);
        expect(b.right, `${life} ${step}`).toBeLessThanOrEqual(IPHONE.width);
      }
      await page.close();
    }
    await context.close();
  });

  it('with reduced motion on, the sheet does not slide', async () => {
    const moving = await openSetup(await browser().newContext(phone()), base(), 'setup-day', 'assign');
    await moving.getByTestId('assign-needs').click();
    expect(await moving.getByTestId('amount-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('sheet-in');
    await moving.context().close();
    const still = await openSetup(await browser().newContext(phone({ reducedMotion: 'reduce' })), base(), 'setup-day', 'assign');
    await still.getByTestId('assign-needs').click();
    expect(await still.getByTestId('amount-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    await still.context().close();
  });

  it('money is written the same way on every step, with digits that line up, and negatives obvious', async () => {
    const context = await browser().newContext(phone());
    for (const [life, step] of [...STEPS.map((s) => ['setup-day', s] as const), ['setup-owes-more', 'bank'] as const, ['setup-owes-more', 'assign'] as const]) {
      const page = await openSetup(context, base(), life, step);
      const amounts = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', numbers: getComputedStyle(e).fontVariantNumeric, negative: e.classList.contains('is-negative'), label: e.getAttribute('aria-label') })));
      // The last paycheck step has a date and no amounts.
      if (step !== 'paycheck') expect(amounts.length, `${life} ${step}`).toBeGreaterThan(2);
      for (const a of amounts) {
        expect(a.text, `${life} ${step}`).toMatch(/^[−+]?\$\d{1,3}(,\d{3})*\.\d{2}$/);
        expect(a.numbers, `${life} ${step}`).toContain('tabular-nums');
        if (a.text.startsWith('−')) expect([a.negative, a.label?.startsWith('minus')], `${life} ${step} ${a.text}`).toEqual([true, true]);
      }
      await page.close();
    }
    await context.close();
  });

  it('what each state means is said in words, not by color alone', async () => {
    const context = await browser().newContext(phone());
    const transfers = await openSetup(context, base(), 'setup-day', 'transfers');
    expect(await textAt(transfers, 'half-su-card-left')).toContain('Not answered yet');
    await answerHalf(transfers, 'su-card-left', true);
    expect(await textAt(transfers, 'half-su-card-left')).toContain('Your answer: on its way');
    await transfers.close();
    const assign = await openSetup(context, base(), 'setup-owes-more', 'assign');
    await typeAmount(assign, 'savings', '150.00');
    expect(await textAt(assign, 'setup-hero')).toContain('More is handed out than there is');
    await assign.close();
    const check = await openSetup(context, base(), 'setup-day', 'check');
    expect(await textAt(check, 'missing')).toContain('Before tracking can start');
    await check.close();
    await context.close();
  });

  it('loading, error, empty, not ready, and done: each says what it is', async () => {
    const context = await browser().newContext(phone());
    // Loading: the slow life takes its time before the numbers come.
    const slow = await context.newPage();
    await watchPage(slow);
    await slow.goto(`${base()}/demo/slow`);
    await slow.locator('main[aria-busy="false"]').waitFor();
    await untilQuiet(slow);
    await slow.goto(`${base()}/setup/bank`);
    await slow.getByTestId('setup-loading').waitFor();
    expect(await slow.locator('main').getAttribute('aria-busy')).toBe('true');
    await slow.getByTestId('setup-done').waitFor();
    await untilQuiet(slow);
    await slow.close();
    const error = await openSetup(context, base(), 'error', 'bank');
    expect(await textAt(error, 'setup-error')).toContain("Couldn't load setup day");
    expect(await error.getByTestId('retry').count()).toBe(1);
    await error.close();
    const empty = await openSetup(context, base(), 'setup-owes-more', 'transfers');
    expect(await textAt(empty, 'transfers-none')).toContain('Nothing on its way');
    await atRest(empty);
    await empty.close();
    const notReady = await openSetup(context, base(), 'not-set-up', 'check');
    expect(await textAt(notReady, 'setup-not-ready')).toContain("Setup day can't start yet");
    await notReady.close();
    const done = await openSetup(context, base(), 'normal', 'bank');
    expect(await textAt(done, 'setup-done')).toContain('Setup day is done');
    await done.close();
    await context.close();
  });

  it('light and dark follow the phone on Setup day', async () => {
    for (const [scheme, background] of [
      ['light', 'rgb(242, 242, 247)'],
      ['dark', 'rgb(0, 0, 0)'],
    ] as const) {
      const page = await openSetup(await browser().newContext(phone({ colorScheme: scheme })), base(), 'setup-day', 'bank');
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), scheme).toBe(background);
      await page.context().close();
    }
  });
});
