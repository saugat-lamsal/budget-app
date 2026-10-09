import type { Pot } from '@budget-app/money';
import type { BrowserContext, Page } from 'playwright';
import { demoSetupDesk } from '../../../server/src/demo/demo-server.js';
import { DEMO_TODAY, demoScenario } from '../../../server/src/demo/scenarios.js';
import type { SetupDesk } from '../../../server/src/setup-desk.js';
import type { SetupResponse, SetupStep } from '../../../server/src/views/choice.js';
import type { SetupReadyView } from '../../../server/src/views/setup.js';
import { centsAt, openScenario, untilQuiet } from './harness.js';

// Helpers for the Setup day screens (rulebook section 14): opening a step,
// a twin of a made-up life's setup desk to compare with, and doing what a
// person does on each step.

export type SetupStepName = 'bank' | 'rules' | 'transfers' | 'paycheck' | 'assign' | 'check';

// Opens one step of a life not set up yet, the life started over.
export async function openSetup(context: BrowserContext, base: string, life: string, step: SetupStepName): Promise<Page> {
  return openScenario(context, base, life, `/setup/${step}`);
}

// A twin of the life's setup desk, as the demo makes it: the same answers
// given to it directly give the numbers the screens must show.
export function twinOf(life: string): SetupDesk {
  const scenario = demoScenario(life);
  const desk = scenario === undefined ? null : demoSetupDesk(scenario, DEMO_TODAY);
  if (desk === null) throw new Error(`${life} is not a life to set up`);
  return desk;
}

export function ready(desk: SetupDesk): SetupReadyView {
  const view = desk.view();
  if (view.state !== 'not-set-up' || !view.ready) throw new Error(`not ready: ${JSON.stringify(view)}`);
  return view;
}

let n = 0;
export function tell(desk: SetupDesk, setup: SetupStep, more: { readonly confirmed?: boolean; readonly seen?: string } = {}): SetupResponse {
  return desk.decide({ id: `twin-decision-${(n += 1)}`, setup, ...more });
}

// Once what the screen sent has been answered and its numbers read again.
export async function settled(page: Page): Promise<void> {
  await untilQuiet(page);
}

// Taps "On its way" or "Not on its way" on one transfer.
export async function answerHalf(page: Page, half: string, onItsWay: boolean): Promise<void> {
  const card = page.getByTestId(`half-${half}`);
  await card.getByTestId(onItsWay ? 'on-its-way' : 'not-on-its-way').click();
  await card.getByTestId('answer').filter({ hasText: onItsWay ? 'on its way' : 'not on its way' }).waitFor();
  await settled(page);
}

// Types an amount for one bucket and saves it. Returns the sheet's problem,
// if it was refused (the sheet stays open), or null once it closed.
export async function typeAmount(page: Page, pot: Pot, text: string): Promise<string | null> {
  await page.getByTestId(`assign-${pot}`).click();
  const sheet = page.getByTestId('amount-sheet');
  await sheet.getByTestId('amount').fill(text);
  await sheet.getByTestId('sheet-save').click();
  return closedOrProblem(page);
}

// "Put what is left here" for one bucket.
export async function putTheRest(page: Page, pot: Pot): Promise<string | null> {
  await page.getByTestId(`assign-${pot}`).click();
  await page.getByTestId('amount-sheet').getByTestId('sheet-rest').click();
  return closedOrProblem(page);
}

// Picks the day of the last paycheck in the sheet and saves it.
export async function pickPaycheck(page: Page, date: string): Promise<string | null> {
  await page.getByTestId('last-paycheck').click();
  const sheet = page.getByTestId('date-sheet');
  await sheet.getByTestId('date').fill(date);
  await sheet.getByTestId('sheet-save').click();
  return closedOrProblem(page);
}

async function closedOrProblem(page: Page): Promise<string | null> {
  const problem = page.locator('dialog[open] [data-testid="sheet-problem"]');
  const open = page.locator('dialog[open]');
  await page.waitForFunction(() => document.querySelector('dialog[open]') === null || document.querySelector('dialog[open] [data-testid="sheet-problem"]') !== null);
  await settled(page);
  if ((await open.count()) > 0 && (await problem.count()) > 0) return (await problem.innerText()).replace(/\s+/g, ' ').trim();
  return null;
}

// The numbers on "Hand out your starting money".
export async function readAssign(page: Page): Promise<{ readonly left: number; readonly assigned: number; readonly startingMoney: number; readonly pots: Readonly<Record<Pot, number>> }> {
  const pots = {} as Record<Pot, number>;
  for (const pot of ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'] as const) pots[pot] = await centsAt(page, `assigned-${pot}`);
  return { left: await centsAt(page, 'left-to-assign'), assigned: await centsAt(page, 'assigned'), startingMoney: await centsAt(page, 'starting-money'), pots };
}

// A25: types how many days back setup day looks and saves it. Returns the
// sheet's problem, if it was refused (the sheet stays open), or null once it closed.
export async function lookBack(page: Page, days: string): Promise<string | null> {
  await page.getByTestId('look-back-row').click();
  const sheet = page.getByTestId('look-back-sheet');
  await sheet.getByTestId('look-back-days').fill(days);
  await sheet.getByTestId('sheet-save').click();
  return closedOrProblem(page);
}
