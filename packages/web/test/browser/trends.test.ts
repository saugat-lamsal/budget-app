import type { TrendsView } from '@budget-app/server/views';
import { chromium, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { trendsView } from '../../../server/src/trends.js';
import { barWords, paceWords, placeGroupName, usualLines } from '../../src/screens/trends-text.js';
import { addStyle, atRest, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, centsAt, openScenario, phone, textAt, useEngine } from './harness.js';

// The Trends tab on the screens (rulebook section 40, QUESTIONS.md A58):
// every number on it against the server's own Trends for the same made-up
// life, the bars and places opening what is behind them, its states, that it
// only reads, and the design rules. In Chromium (his rule, Oct 14: only the
// screens touched). Every name and number is made up.

type Tracking = Extract<TrendsView, { state: 'tracking' }>;

function serverTrends(life: string): Tracking {
  const scenario = demoScenario(life);
  const input = scenario?.input?.();
  if (scenario === undefined || input === undefined) throw new Error(`no life ${life}`);
  const view = trendsView({ today: input.today, book: input.book, bank: input.bank, madeUpData: input.madeUpData, catchingUp: input.catchingUp ?? false, why: input.bankDetail?.why ?? null, before: scenario.trends?.() ?? null });
  if (view.state !== 'tracking') throw new Error(`${life} is not tracking`);
  return view;
}

const chromiumOnly = ENGINES.filter(([name]) => name === 'chromium');

async function open(page: Page, segment: 'past' | 'now'): Promise<void> {
  if (segment === 'now') await page.getByTestId('trends-segment-now').click();
  await expect.poll(() => page.getByTestId(segment === 'past' ? 'trends-periods' : 'trends-pace').isVisible()).toBe(true);
}

describe.runIf(chromiumOnly.length > 0)('40 the Trends tab, in chromium', () => {
  const { browser, base } = useEngine(chromium);

  it('40.1 Trends is a tab between Review and Settings, at its own address', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'trends');
    const tabs = await page.locator('.tabbar .tab').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(tabs).toEqual(['tab-home', 'tab-buckets', 'tab-review', 'tab-trends', 'tab-settings']);
    await page.getByTestId('tab-trends').click();
    await expect.poll(() => page.url()).toBe(`${base()}/trends`);
    await expect.poll(() => page.getByTestId('trends-hero').isVisible()).toBe(true);
    expect(await page.title()).toBe('Trends · Budget');
    await page.context().close();
  });

  it('40.2 40.4 40.7 the hero and every pay period’s bar are the server’s numbers; a bar lists what is behind it, adding up to it', async () => {
    const view = serverTrends('trends');
    const page = await openScenario(await browser().newContext(phone()), base(), 'trends', '/trends');
    expect(await centsAt(page, 'trends-spent-so-far')).toBe(view.now.spentSoFar);
    expect(await page.getByTestId('trends-since').textContent()).toBe('Since Jun 21');
    // One bar a pay period, each saying all of its amounts.
    const bars = page.getByTestId('trends-periods').locator('.pbar');
    expect(await bars.count()).toBe(view.periods.length);
    expect(await bars.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(view.periods.map(barWords));
    // More bars than fit across the phone: the row opens at the newest, on the right.
    const row = page.getByTestId('period-bar');
    expect(await row.evaluate((e) => e.scrollWidth > e.clientWidth && Math.abs(e.scrollLeft + e.clientWidth - e.scrollWidth) <= 1)).toBe(true);
    // The current pay period is picked to start.
    const last = view.periods[view.periods.length - 1];
    expect(await centsAt(page, 'period-total')).toBe(last?.total);
    for (const part of ['needs', 'wants', 'old-card', 'unsorted'] as const) expect(await centsAt(page, `period-part-${part}`)).toBe(last?.spent[part]);
    // The oldest shown: before setup day, its items read by today's rules.
    const oldest = view.periods[0];
    if (oldest === undefined) throw new Error('no pay periods');
    expect(oldest.beforeSetup).toBe('all');
    await page.getByTestId('period-bar-0').click();
    const sheet = page.getByTestId('period-sheet');
    await expect.poll(() => sheet.isVisible()).toBe(true);
    expect(await centsAt(page, 'sheet-total')).toBe(oldest.total);
    for (const part of ['needs', 'wants', 'old-card', 'unsorted'] as const) expect(await centsAt(page, `sheet-part-${part}`)).toBe(oldest.spent[part]);
    expect(await page.getByTestId('sheet-item').locator('.row').count()).toBe(oldest.items.length);
    let listed = 0;
    for (const item of oldest.items) {
      expect(await textAt(page, `sheet-item-${item.id}-${item.part}`)).toContain('before setup day');
      const amount = await centsAt(page, `sheet-item-amount-${item.id}-${item.part}`);
      expect(amount).toBe(item.amount);
      listed += amount;
    }
    expect(listed).toBe(oldest.total);
    expect(await textAt(page, 'period-note')).toBe("Before setup day: read by today's rules");
    await page.keyboard.press('Escape');
    await expect.poll(() => sheet.isVisible()).toBe(false);
    await page.context().close();
  });

  it('40.5 40.6 savings and the mom reserve now, and where it went: each place, its amount, and what is behind it', async () => {
    const view = serverTrends('trends');
    const page = await openScenario(await browser().newContext(phone()), base(), 'trends', '/trends');
    const now = view.savings[view.savings.length - 1];
    expect(await centsAt(page, 'savings-now')).toBe(now?.savings);
    expect(await centsAt(page, 'mom-now')).toBe(now?.momReserve);
    expect(await page.getByTestId('savings-chart-savings').getAttribute('data-values')).toBe(view.savings.map((s) => s.savings).join(','));
    expect(await centsAt(page, 'places-total')).toBe(view.places.total);
    for (const [i, g] of view.places.groups.entries()) {
      expect(await centsAt(page, `place-amount-${i}`)).toBe(g.amount);
      expect(await textAt(page, `place-${i}`)).toContain(placeGroupName(g));
    }
    await page.getByTestId('place-0').click();
    await expect.poll(() => page.getByTestId('place-sheet').isVisible()).toBe(true);
    expect(await centsAt(page, 'place-sheet-total')).toBe(view.places.groups[0]?.amount);
    expect(await page.getByTestId('place-item').locator('.row').count()).toBe(view.places.groups[0]?.items.length);
    await page.context().close();
  });

  it('40.7 40.8 Now: Wants against an even pace in words, its numbers, and this pay period against your usual', async () => {
    const view = serverTrends('trends');
    const page = await openScenario(await browser().newContext(phone()), base(), 'trends', '/trends');
    await open(page, 'now');
    const w = view.now.wants;
    expect(await textAt(page, 'pace-words')).toBe(paceWords(w.pace).title);
    expect(await centsAt(page, 'pace-left')).toBe(w.left);
    expect(await centsAt(page, 'pace-started')).toBe(w.startedWith);
    if (w.pace.state === 'pace') expect(await centsAt(page, 'pace-today')).toBe(w.pace.today);
    expect(await page.getByTestId('pace-chart-wants').getAttribute('data-values')).toBe(w.line.map((p) => p.left).join(','));
    expect(await centsAt(page, 'usual-so-far')).toBe(view.now.spentSoFar);
    const lines = usualLines(view.now.usual, view.now.day);
    if (view.now.usual.state === 'known') {
      expect(await centsAt(page, 'usual-by-today')).toBe(view.now.usual.byToday);
      expect(await centsAt(page, 'usual-whole')).toBe(view.now.usual.whole);
      expect(await textAt(page, 'usual-note')).toBe(lines[2]);
    } else expect(await textAt(page, 'usual-note')).toBe(`${lines[0]} ${lines[1]}`);
    await page.context().close();
  });

  it('40.7 the hero leaves this pay period’s old card payment out; its bar has it as its own part', async () => {
    const view = serverTrends('on-its-way');
    const here = view.periods[view.periods.length - 1];
    expect(here?.spent['old-card']).toBeGreaterThan(0);
    const page = await openScenario(await browser().newContext(phone()), base(), 'on-its-way', '/trends');
    expect(await centsAt(page, 'trends-spent-so-far')).toBe(view.now.spentSoFar);
    expect(view.now.spentSoFar).toBe((here?.total ?? 0) - (here?.spent['old-card'] ?? 0));
    expect(await centsAt(page, 'period-part-old-card')).toBe(here?.spent['old-card']);
    await page.context().close();
  });

  it('40.7 with no history before setup day: not enough pay periods yet to know your usual', async () => {
    const view = serverTrends('normal');
    expect(view.now.usual.state).toBe('not-enough');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/trends');
    await open(page, 'now');
    expect(await textAt(page, 'usual-note')).toContain('Not enough pay periods yet to know your usual.');
    expect(await page.getByTestId('usual-by-today').count()).toBe(0);
    await page.context().close();
  });

  it('40.9 when the totals do not match the bank, the same banner as Buckets; the numbers still come from the books', async () => {
    const view = serverTrends('mismatch');
    const page = await openScenario(await browser().newContext(phone()), base(), 'mismatch', '/trends');
    expect(await textAt(page, 'mismatch')).toContain('Totals do not match the bank');
    expect(await centsAt(page, 'mismatch-amount')).toBe(view.check.state === 'does-not-match' ? Math.abs(view.check.difference) : -1);
    expect(await centsAt(page, 'trends-spent-so-far')).toBe(view.now.spentSoFar);
    await page.context().close();
  });

  it('40.1 its states: before setup day, loading, and when it cannot load (with Try again)', async () => {
    const notSetUp = await openScenario(await browser().newContext(phone()), base(), 'not-set-up', '/trends');
    expect(await textAt(notSetUp, 'trends-not-set-up')).toContain('Trends starts after setup day');
    await notSetUp.context().close();
    // The slow life takes 3 seconds before any numbers arrive.
    const slow = await (await browser().newContext(phone())).newPage();
    await slow.goto(`${base()}/demo/slow`);
    await slow.goto(`${base()}/trends`);
    await expect.poll(() => slow.getByTestId('trends-loading').isVisible()).toBe(true);
    await expect.poll(() => slow.getByTestId('trends-hero').isVisible(), { timeout: 15_000 }).toBe(true);
    await atRest(slow);
    await slow.context().close();
    const failing = await openScenario(await browser().newContext(phone()), base(), 'error', '/trends');
    expect(await textAt(failing, 'trends-error')).toContain("Couldn't load Trends");
    expect(await failing.getByTestId('retry').isVisible()).toBe(true);
    await failing.context().close();
  });

  it('40.1 Trends only reads: using it sends nothing but reads', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'trends', '/trends');
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`);
    });
    await page.getByTestId('period-bar-0').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('place-0').click();
    await page.keyboard.press('Escape');
    await open(page, 'now');
    await atRest(page);
    expect(sent).toEqual([]);
    await page.context().close();
  });

  for (const [what, setUp] of [
    ['Past', async (_page: Page) => {}],
    ['Now', async (page: Page) => open(page, 'now')],
    ['a pay period’s sheet', async (page: Page) => page.getByTestId('period-bar-0').click()],
    ['a place’s sheet', async (page: Page) => page.getByTestId('place-0').click()],
  ] as const) {
    it(`40.4 design rules on ${what}: contrast, 44-point taps, money written one way, the notch and home bar, the largest text size`, async () => {
      const problems: string[] = [];
      const context = await browser().newContext(phone({ bypassCSP: true }));
      const page = await openScenario(context, base(), 'trends', '/trends');
      await setUp(page);
      await atRest(page);
      problems.push(...(await axeViolations(page)));
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) problems.push(`${t.what} is ${t.width}x${t.height}`);
      for (const m of await page.locator('main [data-money], dialog[open] [data-money]').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', numbers: getComputedStyle(e).fontVariantNumeric })))) {
        expect(m.text).toMatch(/^[−+]?\$\d{1,3}(,\d{3})*\.\d{2}/);
        expect(m.numbers).toContain('tabular-nums');
      }
      // The notch and the home bar: the first thing on the screen is below the
      // notch; an open sheet's end is above the bottom of the screen.
      await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
      const sheet = page.locator('dialog[open]');
      if ((await sheet.count()) === 0) {
        await page.evaluate(() => window.scrollTo(0, 0));
        const top = await page.locator('.screen > .eyebrow').boundingBox();
        expect(top!.y).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
      } else {
        await sheet.evaluate((e) => e.scrollTo(0, e.scrollHeight));
        const inner = await sheet.locator('.sheet__inner').boundingBox();
        expect(inner!.y + inner!.height).toBeLessThanOrEqual(IPHONE.height + 0.5);
      }
      // The largest text size: nothing runs off the side of the screen (the bars scroll inside their card).
      await addStyle(page, 'html { font-size: 36px !important; }');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
      await context.close();
      expect(problems).toEqual([]);
    });
  }

  it('40.4 reduced motion: nothing on Trends moves', async () => {
    const context = await browser().newContext(phone({ reducedMotion: 'reduce' }));
    const page = await openScenario(context, base(), 'trends', '/trends');
    const moving = async (): Promise<number> => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length);
    expect(await moving()).toBe(0);
    await open(page, 'now');
    expect(await moving()).toBe(0);
    await context.close();
  });

  it('40.4 with motion: the bars grow in and the lines draw in, quickly', async () => {
    const context = await browser().newContext(phone({ reducedMotion: 'no-preference' }));
    const page = await openScenario(context, base(), 'trends', '/trends');
    const timings = await page.locator('.pbar__stack').first().evaluate((e) => e.getAnimations().map((a) => a.effect?.getComputedTiming().duration));
    expect(timings).toEqual([600]);
    await context.close();
  });
});
