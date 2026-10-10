import { formatDollars, type Cents, type LeftoverAnswer, type Pot, type SortChoice, type SortingRule } from '@budget-app/money';
import type { BrowserContext, Locator, Page } from 'playwright';
import { activityPath, routeOf, routeTitle } from '../../../src/app/routes.js';
import { untilAnswered, untilQuiet, waitOrReport, watchPage } from '../harness.js';
import type { ScreenPath, Views } from './expected.js';
import type { RealServer } from './real-server.js';

// The pay period through the screens, the way a person uses them: every
// answer is taps on the screens, and every screen is read off the page.

// Amounts as a person types them: "1,234.56", a minus sign in front when below zero.
export const typed = (cents: Cents): string => formatDollars(cents).replace('$', '');

// What a person reads on a screen, once its numbers are in: its words and
// numbers, with the spacing squashed. With reload, the app is opened afresh at
// the screen (Home's numbers are read once, when the app opens); otherwise it
// moves there the way its own links do, without reloading, so only that
// screen's numbers are asked for. (Opening the app afresh for every screen of
// every day, on two pages, left about 3,000 connections waiting to close on
// Windows CI, and one page could not open: net::ERR_NO_BUFFER_SPACE, Oct 10.)
export async function readScreen(page: Page, base: string, path: ScreenPath, reload = true): Promise<string> {
  if (reload || !page.url().startsWith(base)) await page.goto(`${base}${path}`);
  else {
    const route = routeOf(path);
    if (route === null) throw new Error(`no screen at ${path}`);
    await page.evaluate((to) => {
      window.history.pushState({ from: window.location.pathname }, '', to);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    // The title changes in the same step as the screen, after it has asked for its numbers.
    await page.waitForFunction((title) => document.title === title, routeTitle(route));
  }
  await waitOrReport(page, 'main[aria-busy="false"]');
  await untilAnswered(page);
  await untilQuiet(page);
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim();
}

// A second page in the same browser whose screens are given the numbers
// worked out from the simulator's book (expected.ts) instead of the real
// server's: the same screen code shows what the screen should say. Its
// own files and the login come from the real server; it never sends an answer.
export class ShouldShow {
  views: Views = {};
  readonly page: Page;

  private constructor(page: Page) {
    this.page = page;
  }

  static async open(context: BrowserContext): Promise<ShouldShow> {
    const page = await context.newPage();
    await watchPage(page);
    const twin = new ShouldShow(page);
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') {
        await route.abort();
        return;
      }
      const view = twin.views[path];
      if (view === undefined) {
        await route.continue();
        return;
      }
      // The login card is the browser's own (Step 2): the real server's.
      if (path === '/api/settings') {
        const real = (await (await route.fetch()).json()) as { readonly login?: unknown };
        await route.fulfill({ json: real.login === undefined ? view : { ...(view as object), login: real.login } });
        return;
      }
      await route.fulfill({ json: view });
    });
    return twin;
  }
}

// The first place two screens' texts differ, as the numbers there and the
// words around them; null when they read the same.
export function screenDifference(real: string, should: string): string | null {
  if (real === should) return null;
  const NUMBER = /[−-]?\+?\$?\d[\d,]*(?:\.\d+)?%?/g;
  const tokens = (text: string): { readonly token: string; readonly at: number }[] => [...text.matchAll(NUMBER)].map((m) => ({ token: m[0], at: m.index }));
  const a = tokens(real);
  const b = tokens(should);
  const around = (text: string, at: number): string => `…${text.slice(Math.max(0, at - 60), at + 40)}…`;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x?.token !== y?.token) {
      return `the screen shows ${x === undefined ? 'nothing more' : `${x.token} (${around(real, x.at)})`}, the simulator's book says ${y === undefined ? 'nothing more' : `${y.token} (${around(should, y.at)})`}`;
    }
  }
  let i = 0;
  while (i < real.length && real[i] === should[i]) i++;
  return `the same numbers, but the words differ: the screen says ${around(real, i)}, the simulator's book ${around(should, i)}`;
}

// ----- Answers, tap by tap -----

export interface Answer {
  readonly method: string;
  readonly args: readonly unknown[];
}

// Waits for whatever the screen sent to be answered and its numbers read again.
async function settled(page: Page): Promise<void> {
  await untilQuiet(page);
}

async function open(page: Page, base: string, path: string): Promise<void> {
  if (new URL(page.url()).pathname !== path || !page.url().startsWith(base)) await page.goto(`${base}${path}`);
  await waitOrReport(page, 'main[aria-busy="false"]');
  await untilAnswered(page);
}

// The notice a screen shows after an answer, in words.
export async function noticeText(page: Page): Promise<string> {
  await page.getByTestId('notice').waitFor();
  return (await page.getByTestId('notice').locator('.notice__text').innerText()).replace(/\s+/g, ' ').trim();
}

// A tap on something on the screen, once it is in the middle of the screen,
// clear of the tab bar, as a person scrolls before tapping. (A card's last
// button could sit under the tab bar, and Playwright's own retry then waited
// out 30 s in WebKit on a busy PC, Oct 10. A button that could never be
// scrolled clear of it would still fail.)
async function tap(target: Locator): Promise<void> {
  await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await target.click();
}

// Taps that make the choice on an item's card or sheet: on the card when it is
// there, otherwise from More choices; and his yes when it asks first.
async function choose(page: Page, card: Locator, sheet: Locator, choice: SortChoice): Promise<void> {
  if ('split' in choice) {
    await tap(card.getByTestId('more'));
    const parts = choice.split;
    const first = parts[0];
    if (first === undefined || parts.length !== 2) throw new Error(`a split into ${parts.length} parts is not in this pay period`);
    await sheet.getByTestId(`split-${first.bucket}`).fill(typed(first.amount));
    await sheet.getByTestId('split-submit').click();
  } else if ('refundOf' in choice) {
    await tap(card.getByTestId(`match-${choice.refundOf}`));
  } else if ('transfer' in choice) {
    await tap(card.getByTestId('more'));
    await sheet.getByTestId(`choice-transfer-${choice.transfer}`).click();
  } else if ('to' in choice) {
    const direct = card.getByTestId(`pick-${choice.to}`);
    if ((await direct.count()) > 0) await tap(direct);
    else {
      await tap(card.getByTestId('more'));
      await sheet.getByTestId(`choice-${choice.to}`).click();
    }
  } else {
    throw new Error(`a choice not in this pay period: ${JSON.stringify(choice)}`);
  }
  // Final choices ask first (B91); his yes.
  const yes = page.getByTestId('confirm-yes');
  await page.waitForFunction(() => document.querySelector('[data-testid="confirm-yes"]') !== null || document.querySelector('[data-testid="notice"]') !== null);
  if ((await yes.count()) > 0 && (await page.getByTestId('notice').count()) === 0) await yes.click();
}

// One answer the simulated person gave its book, given on the screens.
export async function answerOnTheScreens(page: Page, real: RealServer, answer: Answer, ruleText: ReadonlyMap<string, string>): Promise<void> {
  const base = real.base;
  const book = real.keeper.book();
  if (book === null) throw new Error('not tracking yet');
  switch (answer.method) {
    case 'sort': {
      const [id, choice] = answer.args as [string, SortChoice];
      const waiting = book.reviewItems().some((i) => i.id === id);
      if (waiting) {
        // Review: the item's card.
        await open(page, base, '/review');
        const card = page.getByTestId(`item-${id}`);
        await choose(page, card, page.locator('dialog[open]'), choice);
        await card.waitFor({ state: 'detached' });
      } else {
        // 4.7: sorting again, from the list of the bucket it is in now.
        const purchase = book.purchases().find((p) => p.id === id);
        const sorted = purchase?.sortedTo;
        if (sorted === undefined || !('to' in sorted) || (sorted.to !== 'needs' && sorted.to !== 'wants')) throw new Error(`${id} is not waiting and not in one bucket: ${JSON.stringify(sorted)}`);
        if (!('to' in choice)) throw new Error(`sorting ${id} again with ${JSON.stringify(choice)} is not in this pay period`);
        await open(page, base, activityPath(sorted.to));
        await tap(page.getByTestId(`row-${id}`));
        await page.getByTestId('activity-sheet').getByTestId(`choice-${choice.to}`).click();
        await page.getByTestId(`row-${id}`).waitFor({ state: 'detached' });
      }
      await settled(page);
      return;
    }
    case 'answerLeftover': {
      // 3.4: the payday questions, on Payday.
      const [id, choice] = answer.args as [string, LeftoverAnswer];
      await open(page, base, '/payday');
      await tap(page.getByTestId(`item-${id}`).getByTestId(`answer-${choice}`));
      await page.getByTestId('confirm-yes').click();
      await page.getByTestId(`item-${id}`).waitFor({ state: 'detached' });
      await settled(page);
      return;
    }
    case 'moveMoney': {
      // 13.3, from Buckets; 13.4 asks first when it should.
      const [move] = answer.args as [{ readonly from: Pot; readonly to: Pot; readonly amount: Cents }];
      await open(page, base, '/buckets');
      await tap(page.getByTestId('move-open'));
      await page.getByTestId('move-from').selectOption(move.from);
      await page.getByTestId('move-to').selectOption(move.to);
      await page.getByTestId('move-amount').fill(typed(move.amount));
      await page.getByTestId('move-submit').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="move-confirm-yes"]') !== null || document.querySelector('[data-testid="notice"]') !== null);
      if ((await page.getByTestId('move-confirm-yes').count()) > 0) await page.getByTestId('move-confirm-yes').click();
      await noticeText(page);
      await settled(page);
      return;
    }
    case 'changeSettings': {
      const [patch] = answer.args as [Record<string, unknown>];
      const keys = Object.keys(patch);
      if (keys.length !== 1) throw new Error(`one setting at a time on the screens: ${JSON.stringify(patch)}`);
      await open(page, base, '/settings');
      const key = keys[0];
      if (key === 'paycheckRule' || key === 'momRule') {
        // B112: asks first, with what it would do to what is waiting.
        const rule = patch[key] as { readonly contains: string };
        const row = key === 'paycheckRule' ? 'paycheck-rule' : 'mom-rule';
        await sheet(page, `row-${row}`, { [`field-${row}`]: rule.contains });
        await page.getByTestId('confirm-yes').click();
      } else if (key === 'split') {
        const split = patch[key] as { readonly savings: number; readonly needs: number; readonly wants: number };
        await sheet(page, 'row-split', { 'field-savings': String(split.savings), 'field-needs': String(split.needs), 'field-wants': String(split.wants) });
      } else {
        throw new Error(`a setting not in this pay period: ${key}`);
      }
      await noticeText(page);
      await settled(page);
      return;
    }
    case 'addRule': {
      const [rule] = answer.args as [SortingRule];
      if (rule.for !== 'purchase') throw new Error('only purchase rules in this pay period');
      await open(page, base, '/settings');
      await sheet(page, 'row-add-rule', { 'field-rule-kind': 'purchase', 'field-rule-text': rule.contains, 'field-rule-to': rule.bucket });
      await noticeText(page);
      await settled(page);
      return;
    }
    case 'moveRule': {
      // The rule the simulator calls by its own id is the one with the same text.
      const [id, direction] = answer.args as [string, 'up' | 'down'];
      const contains = ruleText.get(id);
      const ours = book.rules().find((r) => r.contains === contains);
      if (ours === undefined) throw new Error(`no rule with the text of ${id}`);
      await open(page, base, '/settings');
      await tap(page.getByTestId(`rule-${ours.id}`));
      await page.getByTestId(direction === 'up' ? 'sheet-move-up' : 'sheet-move-down').click();
      await noticeText(page);
      await settled(page);
      return;
    }
    default:
      throw new Error(`an answer not in this pay period: ${answer.method}`);
  }
}

// Opens a Settings sheet from its row, fills it in, and saves it.
async function sheet(page: Page, row: string, fields: Readonly<Record<string, string>>): Promise<void> {
  await tap(page.getByTestId(row));
  for (const [testId, value] of Object.entries(fields)) {
    const field = page.getByTestId(testId);
    await field.waitFor();
    if ((await field.evaluate((e) => e.tagName)) === 'SELECT') await field.selectOption(value);
    else await field.fill(value);
  }
  await page.getByTestId('sheet-save').click();
}

