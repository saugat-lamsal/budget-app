import type { TrendsView } from '@budget-app/server/views';
import { chromium, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { trendsView } from '../../../server/src/trends.js';
import { landingWords, mostWords, oldCardWords, paydayEffectWords, repeatWords, savingsWords, streakWords, waitingWords } from '../../src/screens/trends-text.js';
import { addStyle, atRest, axeViolations, tappable } from './design-helpers.js';
import { ENGINES, IPHONE, IPHONE_INSETS, centsAt, openScenario, phone, textAt, useEngine } from './harness.js';

// Trends, Future and Habits on the screens (rulebook 40.10 to 40.17,
// QUESTIONS.md A59): every number against the server's own Trends for the
// same made-up life, every estimate marked "Estimate", what a habit opens,
// that it only reads, the design rules, and the motion. In Chromium (his
// rule, Oct 14: only the screens touched). Every name and number is made up.

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
const LIFE = 'trends-future';

async function show(page: Page, segment: 'future' | 'habits'): Promise<void> {
  await page.getByTestId(`trends-segment-${segment}`).click();
  await page.getByTestId(segment === 'future' ? 'future-landing' : 'habit-payday').waitFor();
}

describe.runIf(chromiumOnly.length > 0)('40.10 to 40.17 Trends, Future and Habits, in chromium', () => {
  const { browser, base } = useEngine(chromium);

  it('40.10 Trends has four parts: Past, Now, Future and Habits', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), LIFE, '/trends');
    const parts = await page.getByTestId('trends-segment').locator('button').allInnerTexts();
    expect(parts).toEqual(['Past', 'Now', 'Future', 'Habits']);
    await page.context().close();
  });

  it('40.11 where Needs and Wants land by payday: the server\'s numbers and words, marked Estimate', async () => {
    const view = serverTrends(LIFE);
    const { landing } = view.future;
    expect(landing.needs.state).toBe('estimate');
    const page = await openScenario(await browser().newContext(phone()), base(), LIFE, '/trends');
    await show(page, 'future');
    for (const [name, key] of [['Needs', 'needs'], ['Wants', 'wants']] as const) {
      const l = landing[key];
      expect(await textAt(page, `landing-${key}-words`)).toBe(landingWords(name, l).title);
      if (l.state === 'estimate') {
        expect(await centsAt(page, `landing-${key}-holds`)).toBe(l.holds);
        expect(await centsAt(page, `landing-${key}-lands`)).toBe(l.lands);
      }
    }
    expect(await page.getByTestId('landing-waiting').count()).toBe(waitingWords(landing.waitingInReview) === null ? 0 : 1);
    expect(await page.getByTestId('future-landing').getByText('Estimate', { exact: true }).isVisible()).toBe(true);
    await page.context().close();
  });

  it('40.12 savings a year out: the range, its points on the chart, and the words, marked Estimate', async () => {
    const view = serverTrends(LIFE);
    const s = view.future.savings;
    if (s.state !== 'estimate') throw new Error('the made-up life has a range');
    const page = await openScenario(await browser().newContext(phone()), base(), LIFE, '/trends');
    await show(page, 'future');
    expect(await centsAt(page, 'savings-low')).toBe(s.low);
    expect(await centsAt(page, 'savings-high')).toBe(s.high);
    expect(await centsAt(page, 'savings-year-now')).toBe(s.now);
    const [title, note] = savingsWords(s);
    expect(await textAt(page, 'savings-range-words')).toBe(title);
    expect(await textAt(page, 'savings-range-note')).toBe(note);
    // The range drawn is the server's: from now, then each payday.
    expect(await page.getByTestId('savings-range-chart-band').getAttribute('data-values')).toBe([`${s.now}:${s.now}`, ...s.points.map((p) => `${p.low}:${p.high}`)].join(','));
    expect(await page.getByTestId('savings-range-chart-savings').getAttribute('data-values')).toBe(view.savings.map((p) => p.savings).join(','));
    expect(await page.getByTestId('future-savings').getByText('Estimate', { exact: true }).isVisible()).toBe(true);
    await page.context().close();
  });

  it('40.12 not enough pay periods yet: said in words, with no range', async () => {
    const view = serverTrends('trends');
    expect(view.future.savings.state).toBe('not-enough');
    const page = await openScenario(await browser().newContext(phone()), base(), 'trends', '/trends');
    await show(page, 'future');
    expect(await textAt(page, 'savings-range-words')).toBe(savingsWords(view.future.savings)[0]);
    expect(await page.getByTestId('savings-low').count()).toBe(0);
    await page.context().close();
  });

  it('40.13 the old card: what it owes, its share a payday, the paydays left, the plan on the chart and in words', async () => {
    const view = serverTrends(LIFE);
    const { owed, plan } = view.future.oldCard;
    if (plan.state !== 'plan') throw new Error('the made-up life has a plan');
    const page = await openScenario(await browser().newContext(phone()), base(), LIFE, '/trends');
    await show(page, 'future');
    expect(await centsAt(page, 'old-card-owes')).toBe(owed[owed.length - 1]?.owed);
    expect(await centsAt(page, 'old-card-share')).toBe(plan.perPayday);
    expect(await textAt(page, 'old-card-paydays')).toBe(String(plan.paydaysLeft));
    expect(await textAt(page, 'old-card-words')).toBe(oldCardWords(plan));
    expect(await page.getByTestId('old-card-chart-owed').getAttribute('data-values')).toBe(owed.map((p) => p.owed).join(','));
    expect(await page.getByTestId('old-card-chart-plan').getAttribute('data-values')).toBe(plan.points.map((p) => p.owed).join(','));
    await page.context().close();
  });

  it('40.14 the payday effect: per day each side, in words, and a tap lists what is behind it, adding up', async () => {
    const view = serverTrends(LIFE);
    const effect = view.habits.paydayEffect;
    if (effect.state !== 'known') throw new Error('the made-up life has enough pay periods');
    const page = await openScenario(await browser().newContext(phone()), base(), LIFE, '/trends');
    await show(page, 'habits');
    expect(await centsAt(page, 'payday-first')).toBe(effect.first.perDay);
    expect(await centsAt(page, 'payday-rest')).toBe(effect.rest.perDay);
    expect(await textAt(page, 'payday-effect-words')).toBe(paydayEffectWords(effect)[2]);
    await page.getByTestId('payday-effect-first').click();
    const sheet = page.getByTestId('habit-sheet');
    await expect.poll(() => sheet.isVisible()).toBe(true);
    expect(await centsAt(page, 'habit-sheet-total')).toBe(effect.first.total);
    expect(await page.getByTestId('habit-item').locator('.row').count()).toBe(effect.first.items.length);
    let listed = 0;
    for (const item of effect.first.items) listed += await centsAt(page, `habit-item-amount-${item.id}-${item.part}`);
    expect(listed).toBe(effect.first.total);
    await page.context().close();
  });

  it('40.15 day of the week: an average one each, the most named, and a tap lists its items', async () => {
    const view = serverTrends(LIFE);
    const w = view.habits.weekdays;
    const page = await openScenario(await browser().newContext(phone()), base(), LIFE, '/trends');
    await show(page, 'habits');
    for (const d of w.days) expect(await centsAt(page, `weekday-average-${d.weekday}`)).toBe(d.average);
    expect(await textAt(page, 'weekday-most')).toBe(mostWords(w));
    const most = w.days.find((d) => d.weekday === w.most);
    if (most === undefined) throw new Error('a most');
    // The most says so in words on its row, not only in its color.
    expect(await textAt(page, `weekday-${most.weekday}`)).toContain('the most');
    await page.getByTestId(`weekday-${most.weekday}`).click();
    await expect.poll(() => page.getByTestId('habit-sheet').isVisible()).toBe(true);
    expect(await centsAt(page, 'habit-sheet-total')).toBe(most.total);
    expect(await page.getByTestId('habit-item').locator('.row').count()).toBe(most.items.length);
    await page.context().close();
  });

  it('40.16 40.17 repeat charges with their estimates, and the Wants streak in words', async () => {
    const view = serverTrends(LIFE);
    const { repeats, streak } = view.habits;
    expect(repeats.length).toBeGreaterThan(0);
    const page = await openScenario(await browser().newContext(phone()), base(), LIFE, '/trends');
    await show(page, 'habits');
    for (const [i, r] of repeats.entries()) {
      const words = repeatWords(r);
      const row = await textAt(page, `repeat-${i}`);
      expect(row).toContain(r.name);
      expect(row).toContain(words.often);
      expect(row).toContain(words.next);
      expect(await textAt(page, `repeat-year-${i}`)).toBe(words.year);
      expect(await centsAt(page, `repeat-amount-${i}`)).toBe(r.newestAmount);
    }
    await page.getByTestId('repeat-0').click();
    await expect.poll(() => page.getByTestId('habit-sheet').isVisible()).toBe(true);
    expect(await page.getByTestId('habit-item').locator('.row').count()).toBe(repeats[0]?.items.length);
    await page.keyboard.press('Escape');
    expect(await textAt(page, 'streak-words')).toBe(streakWords(streak));
    await page.context().close();
  });

  it('40.16 with none spotted, it says so', async () => {
    const view = serverTrends('trends');
    expect(view.habits.repeats).toEqual([]);
    const page = await openScenario(await browser().newContext(phone()), base(), 'trends', '/trends');
    await show(page, 'habits');
    expect(await textAt(page, 'repeats-empty')).toContain('No repeat charges spotted');
    await page.context().close();
  });

  it('40.10 Future and Habits only read: using them sends nothing but reads', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), LIFE, '/trends');
    const sent: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`);
    });
    await show(page, 'future');
    await show(page, 'habits');
    await page.getByTestId('payday-effect-rest').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('repeat-0').click();
    await page.keyboard.press('Escape');
    await atRest(page);
    expect(sent).toEqual([]);
    await page.context().close();
  });

  for (const [what, setUp] of [
    ['Future', async (page: Page) => show(page, 'future')],
    ['Habits', async (page: Page) => show(page, 'habits')],
    ['a habit’s sheet', async (page: Page) => (await show(page, 'habits'), page.getByTestId('repeat-0').click())],
  ] as const) {
    it(`40.10 design rules on ${what}: contrast, 44-point taps, money written one way, the notch and home bar, the largest text size`, async () => {
      const problems: string[] = [];
      const context = await browser().newContext(phone({ bypassCSP: true }));
      const page = await openScenario(context, base(), LIFE, '/trends');
      await setUp(page);
      await atRest(page);
      problems.push(...(await axeViolations(page)));
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) problems.push(`${t.what} is ${t.width}x${t.height}`);
      for (const m of await page.locator('main [data-money], dialog[open] [data-money]').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', numbers: getComputedStyle(e).fontVariantNumeric })))) {
        expect(m.text).toMatch(/^[−+]?\$\d{1,3}(,\d{3})*\.\d{2}/);
        expect(m.numbers).toContain('tabular-nums');
      }
      await addStyle(page, `:root { --safe-top: ${IPHONE_INSETS.top}px !important; --safe-bottom: ${IPHONE_INSETS.bottom}px !important; }`);
      const sheet = page.locator('dialog[open]');
      if ((await sheet.count()) > 0) {
        await sheet.evaluate((e) => e.scrollTo(0, e.scrollHeight));
        const inner = await sheet.locator('.sheet__inner').boundingBox();
        expect(inner!.y + inner!.height).toBeLessThanOrEqual(IPHONE.height + 0.5);
      }
      // The largest text size: nothing runs off the side of the screen, and the four parts stay whole.
      await addStyle(page, 'html { font-size: 36px !important; }');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(IPHONE.width);
      const clipped = await page.getByTestId('trends-segment').locator('button').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
      expect(clipped).toEqual([]);
      await context.close();
      expect(problems).toEqual([]);
    });
  }

  it('40.10 reduced motion: nothing on Future or Habits moves', async () => {
    const page = await openScenario(await browser().newContext(phone({ reducedMotion: 'reduce' })), base(), LIFE, '/trends');
    const moving = async (): Promise<number> => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    await show(page, 'future');
    expect(await moving()).toBe(0);
    await show(page, 'habits');
    expect(await moving()).toBe(0);
    await page.context().close();
  });

  it('40.10 with motion: lines draw in, areas and the range wipe in, line ends ping once, bars grow, all quick and expo-out, and the screen comes to rest', async () => {
    const page = await openScenario(await browser().newContext(phone({ reducedMotion: 'no-preference' })), base(), LIFE, '/trends');
    await show(page, 'future');
    // The light behind the page floats for ever (PR 1); it is not a chart.
    const timing = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => ((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest('.ambient') == null)
        .map((a) => {
          const t = a.effect?.getComputedTiming();
          const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
          // A CSS animation keeps its easing on its keyframes: the element's own animation-timing-function.
          return { name: (a as CSSAnimation).animationName ?? '', what: target?.getAttribute('class') ?? '', duration: Number(t?.duration ?? 0), iterations: t?.iterations ?? 1, easing: target === null ? '' : getComputedStyle(target).animationTimingFunction };
        }),
    );
    const names = new Set(timing.map((t) => t.name));
    for (const name of ['chart-reveal', 'line-draw', 'chart-ping', 'landing-drain']) expect(names.has(name), name).toBe(true);
    for (const t of timing) {
      expect(t.iterations, `${t.name} on ${t.what}`).toBe(1);
      expect(t.duration, `${t.name} on ${t.what}`).toBeLessThanOrEqual(600);
    }
    for (const t of timing.filter((x) => ['chart-reveal', 'line-draw', 'chart-ping', 'landing-drain', 'place-grow'].includes(x.name))) expect(t.easing, t.name).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
    await atRest(page);
    await show(page, 'habits');
    await atRest(page);
    expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && ((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest('.ambient') == null).length)).toBe(0);
    await page.context().close();
  });
});
