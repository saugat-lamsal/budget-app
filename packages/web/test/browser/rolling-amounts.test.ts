import type { Cents } from '@budget-app/money';
import type { TrendsView } from '@budget-app/server/views';
import { chromium, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { trendsView } from '../../../server/src/trends.js';
import { activityView } from '../../../server/src/views/activity.js';
import { bucketsView } from '../../../server/src/views/buckets.js';
import { moneyText } from '../../src/ui/money-format.js';
import { atRest } from './design-helpers.js';
import { ENGINES, openScenario, phone, useEngine } from './harness.js';

// The redesign's finishing pass: the main amounts that did not roll now do
// (Buckets' total and its savings, mom reserve and held for others; a
// bucket's list; Trends' main number and the pay period picked; the Future
// and Habits amounts). Each rolls, ends on exactly the amount, and the page
// still holds the amount as plain text. In Chromium (only the screens
// touched). Every name and number is made up.

const MOVING = { reducedMotion: 'no-preference' } as const;
const chromiumOnly = ENGINES.filter(([name]) => name === 'chromium');

function input(life: string) {
  const scenario = demoScenario(life);
  const made = scenario?.input?.();
  if (scenario === undefined || made === undefined || made.book === null) throw new Error(`no life ${life}`);
  return { scenario, made, book: made.book };
}

type Tracking = Extract<TrendsView, { state: 'tracking' }>;

export function serverTrends(life: string): Tracking {
  const { scenario, made } = input(life);
  const view = trendsView({ today: made.today, book: made.book, bank: made.bank, madeUpData: made.madeUpData, catchingUp: made.catchingUp ?? false, why: made.bankDetail?.why ?? null, before: scenario.trends?.() ?? null });
  if (view.state !== 'tracking') throw new Error(`${life} is not tracking`);
  return view;
}

// It rolls, the plain text is exactly the amount, and each drawn column sits on its digit.
export async function rollsTo(page: Page, testId: string, cents: Cents): Promise<void> {
  const money = page.getByTestId(testId);
  await money.waitFor();
  expect(await money.evaluate((e) => e.classList.contains('money--roll')), `${testId} rolls`).toBe(true);
  expect(await money.locator('.money__text').innerText(), `${testId} plain text`).toBe(moneyText(cents));
  const digits = moneyText(cents).replace(/\D/g, '');
  const drawn = await money.locator('.roll__col').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.getPropertyValue('--digit')).join(''));
  expect(drawn, `${testId} drawn digits`).toBe(digits);
  const moved = await money.locator('.roll__col').evaluateAll((els) =>
    els
      .map((e) => {
        const ty = new DOMMatrix(getComputedStyle(e).transform).m42;
        const line = (e.firstElementChild as HTMLElement).getBoundingClientRect().height;
        return Math.round(-ty / line);
      })
      .join(''),
  );
  expect(moved, `${testId} at rest on its digits`).toBe(digits);
}

describe.runIf(chromiumOnly.length > 0)('the finishing pass: main amounts roll, in chromium', () => {
  const { browser, base } = useEngine(chromium);

  it('PR 5 Buckets: the total, savings, the mom reserve and held for others roll to the server\'s amounts', async () => {
    const { made, book } = input('buckets-busy');
    const view = bucketsView({ today: made.today, book, bank: made.bank, madeUpData: made.madeUpData });
    if (view.state !== 'tracking') throw new Error('tracking');
    const page = await openScenario(await browser().newContext(phone(MOVING)), base(), 'buckets-busy', '/buckets');
    await atRest(page);
    await rollsTo(page, 'buckets-total', view.total);
    await rollsTo(page, 'savings', view.savings);
    await rollsTo(page, 'mom-reserve', view.momReserve.amount);
    await rollsTo(page, 'held-for-others', view.heldForOthers.heldForOthers);
    await page.context().close();
  });

  it('PR 5 a bucket\'s list: what it holds now rolls to the server\'s amount', async () => {
    const { made, book } = input('activity-busy');
    const view = activityView({ today: made.today, book, pot: 'wants', madeUpData: made.madeUpData });
    if (view.state !== 'tracking') throw new Error('tracking');
    const page = await openScenario(await browser().newContext(phone(MOVING)), base(), 'activity-busy', '/buckets/wants');
    await atRest(page);
    await rollsTo(page, 'activity-now', view.activity.closing);
    await page.context().close();
  });

  it('PR 5 Trends: the main number and the pay period picked roll, and roll again to another pay period', async () => {
    const view = serverTrends('trends');
    const page = await openScenario(await browser().newContext(phone(MOVING)), base(), 'trends', '/trends');
    await atRest(page);
    await rollsTo(page, 'trends-spent-so-far', view.now.spentSoFar);
    await rollsTo(page, 'period-total', view.periods[view.periods.length - 1]?.total ?? 0);
    await page.getByTestId('period-bar-0').click();
    await page.getByTestId('period-sheet').getByRole('button', { name: 'Close' }).click();
    await atRest(page);
    await rollsTo(page, 'period-total', view.periods[0]?.total ?? 0);
    await page.context().close();
  });

  it('PR 5 with reduced motion the amounts are there at once, the same text, not moving', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'buckets-busy', '/buckets');
    const total = page.getByTestId('buckets-total');
    await total.waitFor();
    expect(await total.locator('.roll__col').first().evaluate((e) => getComputedStyle(e).transitionDuration)).toBe('0s');
    await page.context().close();
  });
});
