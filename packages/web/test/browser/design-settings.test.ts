import type { BrowserContext, Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { addStyle, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, phone, untilAnswered, untilQuiet, useEngine, watchPage } from './harness.js';
import { openSettings } from './settings-screens.js';

// The design rules (CLAUDE.md) for Settings and its sheets, in the browser:
// light and dark, readable contrast, 44-point tap targets, the notch and the
// home bar, the phone's text size and reduced-motion settings, money written
// one way, and what changes said in words, not by color alone.

const STATES = ['settings-busy', 'normal', 'settings-first-sync', 'mismatch', 'big', 'bank-not-read', 'not-set-up', 'error'] as const;

// Every sheet there is on Settings: [name, made-up life, how to open it].
const SHEETS: readonly (readonly [string, string, (page: Page) => Promise<void>])[] = [
  ['the split', 'normal', async (page) => {
    await page.getByTestId('row-split').click();
    await page.getByTestId('field-savings').waitFor();
  }],
  ['the split, typed so it cannot be read', 'normal', async (page) => {
    await page.getByTestId('row-split').click();
    await page.getByTestId('field-savings').fill('abc');
    await page.getByTestId('sheet-reading').waitFor();
  }],
  ['the split, refused', 'normal', async (page) => {
    await page.getByTestId('row-split').click();
    await page.getByTestId('field-needs').fill('40');
    await page.getByTestId('field-wants').fill('30');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('sheet-problem').waitFor();
  }],
  ['the mom reserve', 'normal', async (page) => {
    await page.getByTestId('row-reserve').click();
    await page.getByTestId('field-cap').waitFor();
  }],
  ['the leftover at payday', 'normal', async (page) => {
    await page.getByTestId('row-leftover').click();
    await page.getByTestId('field-leftover-wants').waitFor();
  }],
  ['the daily review time', 'normal', async (page) => {
    await page.getByTestId('row-review-time').click();
    await page.getByTestId('field-review-time').waitFor();
  }],
  ['the home time zone', 'normal', async (page) => {
    await page.getByTestId('row-time-zone').click();
    await page.getByTestId('field-time-zone').waitFor();
  }],
  ['10.8 quiet hours', 'normal', async (page) => {
    await page.getByTestId('row-quiet-hours').click();
    await page.getByTestId('field-quiet-to').waitFor();
  }],
  ['10.7 the bank-not-read alert', 'normal', async (page) => {
    await page.getByTestId('row-not-read').click();
    await page.getByTestId('field-not-read').waitFor();
  }],
  ['10.10 amounts on the lock screen', 'normal', async (page) => {
    await page.getByTestId('row-lock-amounts').click();
    await page.getByTestId('field-lock-amounts').waitFor();
  }],
  ['the promo end date, set', 'settings-busy', async (page) => {
    await page.getByTestId('row-promo').click();
    await page.getByTestId('sheet-clear').waitFor();
  }],
  ['a bank rule, with Move down and Remove', 'normal', async (page) => {
    await page.getByTestId('bank-rule-bank-rule-1').click();
    await page.getByTestId('sheet-move-down').waitFor();
    await page.getByTestId('sheet-remove').waitFor();
  }],
  ['a bank rule moving up, asking first with what would change hands', 'normal', async (page) => {
    await page.getByTestId('bank-rule-bank-rule-3').click();
    await page.getByTestId('sheet-move-up').click();
    await page.getByTestId('preview-move').waitFor();
    await untilQuiet(page);
  }],
  ['a new bank rule, asking first with what it would have matched', 'normal', async (page) => {
    await page.getByTestId('row-add-bank-rule').click();
    await page.getByTestId('field-bank-text').fill('ZELLE TO MADE UP');
    await page.getByTestId('field-bank-means').selectOption('payment-to-person');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-ask').waitFor();
    await untilQuiet(page);
  }],
  ['a new rule', 'normal', async (page) => {
    await page.getByTestId('row-add-rule').click();
    await page.getByTestId('field-rule-text').fill('CORNER STORE');
  }],
  ['a rule, with Move up and Move down', 'normal', async (page) => {
    await page.getByTestId('rule-coffee').click();
    await page.getByTestId('sheet-move-down').waitFor();
  }],
  ['a rule, asking before it is removed', 'normal', async (page) => {
    await page.getByTestId('rule-streaming').click();
    await page.getByTestId('sheet-remove').click();
    await page.getByTestId('confirm-yes').waitFor();
  }],
  ['the paycheck rule, asking first with what it would do', 'settings-first-sync', async (page) => {
    await page.getByTestId('row-paycheck-rule').click();
    await page.getByTestId('field-paycheck-rule').fill('MADE UP EMPLOYER PAYROLL');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('preview').waitFor();
  }],
  ['the mom rule, asking first with what it would do', 'settings-first-sync', async (page) => {
    await page.getByTestId('row-mom-rule').click();
    await page.getByTestId('field-mom-rule').fill('MADE UP MOM');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('preview').waitFor();
  }],
  ['the saved message', 'normal', async (page) => {
    await page.getByTestId('row-low-alert').click();
    await page.getByTestId('field-low-alert').fill('30');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('notice').waitFor();
    await untilQuiet(page);
  }],
];

// The parts each pass can be cut into: the states, the first half of the
// sheets, and the second half. Every part when left out.
type Part = 'states' | 'first sheets' | 'last sheets';
const PARTS: readonly Part[] = ['states', 'first sheets', 'last sheets'];
const HALF = Math.ceil(SHEETS.length / 2);
function sheetsIn(part: Part | undefined): typeof SHEETS {
  if (part === 'states') return [];
  if (part === 'first sheets') return SHEETS.slice(0, HALF);
  if (part === 'last sheets') return SHEETS.slice(HALF);
  return SHEETS;
}

async function each(context: BrowserContext, base: string, check: (page: Page, where: string) => Promise<void>, part?: Part): Promise<void> {
  for (const life of part === undefined || part === 'states' ? STATES : []) {
    const page = await openSettings(context, base, life);
    await check(page, life);
    await page.close();
  }
  for (const [name, life, open] of sheetsIn(part)) {
    const page = await openSettings(context, base, life);
    await open(page);
    await check(page, `sheet: ${name}`);
    await page.close();
  }
}

describe.each(ENGINES)('design rules on Settings in %s', (_engine, engine) => {
  const { browser, base } = useEngine(engine);

  // One test for each colour scheme and each part (every state, the first
  // half of the sheets, the second half): in WebKit one scheme took about
  // 30 s alone (Oct 9), as long as the ones that went past the time limit
  // with the whole suite running. Together they check exactly what one test
  // per scheme did.
  for (const scheme of ['light', 'dark'] as const) {
    for (const part of PARTS) {
      it(`readable contrast and no accessibility problems, in ${scheme} mode, in ${part === 'states' ? 'every state' : `the ${part}`}`, async () => {
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

  // One test for every state and one for each half of the sheets: with the
  // bank rule and time zone sheets added, the one test went past the time
  // limit in WebKit on CI (Oct 9). Together they check exactly what it did.
  for (const part of PARTS) {
    it(`every tap target is at least 44 by 44 points, in ${part === 'states' ? 'every state' : `the ${part}`}`, async () => {
      const small: string[] = [];
      const context = await browser().newContext(phone());
      await each(context, base(), async (page, where) => {
        for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) small.push(`${where}: ${t.what} is ${t.width}x${t.height}`);
      }, part);
      await context.close();
      expect(small).toEqual([]);
    });
  }

  it('nothing sits under the notch or the home bar, and the end of the screen scrolls clear of the tabs', async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    for (const life of ['settings-busy', 'not-set-up', 'mismatch'] as const) {
      const page = await openSettings(context, base(), life);
      await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
      const first = await page.locator('main > :not(.sr-only):not(dialog)').first().boundingBox();
      expect(first!.y, life).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      for (const t of await tappable(page)) {
        if (t.y < IPHONE.height) expect(t.y, `${life}: ${t.what}`).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const bar = await page.locator('.tabbar').boundingBox();
      const last = await page.locator('main > :not(.sr-only):not(dialog)').last().boundingBox();
      expect(last!.y + last!.height, life).toBeLessThanOrEqual(bar!.y);
      await page.close();
    }
    // A sheet leaves room for the home bar too: its last control ends above it.
    const page = await openSettings(context, base(), 'settings-first-sync');
    await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
    await page.getByTestId('row-paycheck-rule').click();
    await page.getByTestId('field-paycheck-rule').fill('MADE UP EMPLOYER PAYROLL');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('preview').waitFor();
    const sheet = page.getByTestId('settings-sheet');
    await sheet.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    await sheet.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    const lastControl = await sheet.locator('button').last().boundingBox();
    expect(lastControl!.y + lastControl!.height).toBeLessThanOrEqual(IPHONE.height - IPHONE_INSETS.bottom + 0.5);
    await context.close();
  });

  it('every arrow stays on its row, at the right edge, never on a line of its own', async () => {
    const context = await browser().newContext(phone());
    const off: string[] = [];
    for (const life of ['settings-busy', 'normal', 'settings-first-sync'] as const) {
      const page = await openSettings(context, base(), life);
      const rows = await page.locator('main .row').evaluateAll((els) =>
        els.flatMap((row) => {
          const chevron = row.querySelector('.row__chevron');
          if (chevron === null) return [];
          const r = row.getBoundingClientRect();
          const c = chevron.getBoundingClientRect();
          return [{ what: row.getAttribute('data-testid') ?? row.textContent?.slice(0, 30) ?? '', rowRight: r.right, rowWidth: r.width, left: c.left }];
        }),
      );
      expect(rows.length, life).toBeGreaterThan(10);
      for (const r of rows) if (r.left < r.rowRight - 64) off.push(`${life} ${r.what}: the arrow is at ${Math.round(r.left)}, the row ends at ${Math.round(r.rowRight)}`);
      await page.close();
    }
    await context.close();
    expect(off).toEqual([]);
  });

  it('with reduced motion on, the sheet does not slide', async () => {
    const moving = await openSettings(await browser().newContext(phone()), base(), 'normal');
    await moving.getByTestId('row-split').click();
    expect(await moving.getByTestId('settings-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('sheet-in');
    await moving.context().close();
    const still = await openSettings(await browser().newContext(phone({ reducedMotion: 'reduce' })), base(), 'normal');
    await still.getByTestId('row-split').click();
    expect(await still.getByTestId('settings-sheet').evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    const durations = await still.locator('.row, .button, .field__input').evaluateAll((els) => els.map((e) => getComputedStyle(e).transitionDuration));
    expect(durations.every((d) => d.split(',').every((part) => Number.parseFloat(part) === 0))).toBe(true);
    await still.context().close();
  });

  it("the text grows with the phone's text size, and Settings still fits, sheets too", async () => {
    const context = await browser().newContext(phone({ bypassCSP: true }));
    for (const life of ['settings-busy', 'big', 'not-set-up'] as const) {
      const page = await openSettings(context, base(), life);
      const before = await page.locator('.row__title, .state__title').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      await addStyle(page, 'html { font-size: 36px !important; }');
      const after = await page.locator('.row__title, .state__title').first().evaluate((e) => Number.parseFloat(getComputedStyle(e).fontSize));
      expect(after, life).toBeGreaterThan(before * 1.8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), life).toBeLessThanOrEqual(IPHONE.width);
      const boxes = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })));
      for (const b of boxes) {
        expect(b.left, life).toBeGreaterThanOrEqual(0);
        expect(b.right, life).toBeLessThanOrEqual(IPHONE.width);
      }
      await page.close();
    }
    const page = await openSettings(context, base(), 'settings-first-sync');
    await addStyle(page, 'html { font-size: 36px !important; }');
    await page.getByTestId('row-paycheck-rule').click();
    await page.getByTestId('field-paycheck-rule').fill('MADE UP EMPLOYER PAYROLL');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('preview').waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
    for (const right of await page.getByTestId('settings-sheet').locator('*').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) expect(right).toBeLessThanOrEqual(IPHONE.width + 0.5);
    await context.close();
  });

  it('money is written the same way everywhere on Settings, with digits that line up', async () => {
    const context = await browser().newContext(phone());
    for (const life of ['settings-busy', 'big', 'normal'] as const) {
      const page = await openSettings(context, base(), life);
      const amounts = await page.locator('[data-money]').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', numbers: getComputedStyle(e).fontVariantNumeric })));
      expect(amounts.length, life).toBeGreaterThan(5);
      for (const a of amounts) {
        expect(a.text, life).toMatch(/^[−+]?\$\d{1,3}(,\d{3})*\.\d{2}$/);
        expect(a.numbers, life).toContain('tabular-nums');
      }
      expect(await page.getByTestId('split-table').evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toContain('tabular-nums');
      await page.close();
    }
    await context.close();
  });

  it('light and dark follow the phone on Settings', async () => {
    for (const [scheme, background] of [
      ['light', 'rgb(242, 242, 247)'],
      ['dark', 'rgb(0, 0, 0)'],
    ] as const) {
      const page = await openSettings(await browser().newContext(phone({ colorScheme: scheme })), base(), 'normal');
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), scheme).toBe(background);
      await page.context().close();
    }
  });

  it('13.1 what changes at the next paycheck says so in words and with an icon, never by color alone; the mismatch banner cannot be missed', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), 'settings-busy');
    const label = page.getByTestId('split-savings-second').locator('[data-status="changes"]');
    expect(await label.innerText()).toBe('Changes');
    expect(await label.locator('[data-icon]').count()).toBe(1);
    expect(await page.getByTestId('split-wants-second').locator('[data-status]').count()).toBe(0);
    const mismatch = await openSettings(page.context(), base(), 'mismatch');
    expect(await mismatch.getByTestId('mismatch').getAttribute('role')).toBe('alert');
    const box = await mismatch.getByTestId('mismatch').boundingBox();
    expect(box!.y).toBeLessThan(IPHONE.height / 2);
    await page.context().close();
  });

  it('there is a loading state and an error state, with Try again', async () => {
    const context = await browser().newContext(phone());
    const slow = await context.newPage();
    await watchPage(slow);
    await slow.goto(`${base()}/demo/slow`);
    // Home's numbers come slowly too: leave only once they are in. Leaving with a
    // request on its way makes WebKit and Windows lose the next answer (CLAUDE.md, Oct 7 and 8).
    await slow.locator('main[aria-busy="false"]').waitFor({ timeout: 15_000 });
    await untilAnswered(slow);
    await slow.goto(`${base()}/settings`);
    await slow.getByTestId('settings-loading').waitFor();
    expect(await slow.locator('main').getAttribute('aria-busy')).toBe('true');
    await slow.locator('main[aria-busy="false"]').waitFor({ timeout: 15_000 });
    await untilQuiet(slow);
    await slow.close();
    const broken = await openSettings(context, base(), 'error');
    expect(await broken.getByTestId('settings-error').innerText()).toContain("Couldn't load your settings");
    expect(await broken.getByTestId('retry').isVisible()).toBe(true);
    await context.close();
  });

  it('using Settings runs under the security policy without a single error', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    await watchPage(page);
    const errors: string[] = [];
    page.on('console', (m) => {
      // The desk answers "needs your OK first" with a 422 (http/server.ts), and the
      // browser itself notes every such answer. That is the question being asked,
      // not an error of the app; anything else is.
      if (/status of 422 \(Unprocessable Entity\)$/.test(m.text())) return;
      if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base()}/demo/settings-first-sync`);
    await page.getByTestId('safe-to-spend').waitFor();
    await page.goto(`${base()}/settings`);
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.getByTestId('row-paycheck-rule').click();
    await page.getByTestId('field-paycheck-rule').fill('MADE UP EMPLOYER PAYROLL');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    await untilQuiet(page);
    await page.getByTestId('row-split').click();
    await page.getByTestId('field-savings').fill('40');
    await page.getByTestId('field-needs').fill('40');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('notice').waitFor();
    await untilQuiet(page);
    expect(errors, errors.join(' | ')).toEqual([]);
    await context.close();
  });
});
