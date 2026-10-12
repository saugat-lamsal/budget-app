import type { Book } from '@budget-app/money';
import type { BrowserContext, Locator, Page, Request } from 'playwright';
import { centsAt } from './harness.js';

// Reading Buckets and Review off the screen, for the tests that compare what
// the screens show with the money math.

export const item = (page: Page, id: string): Locator => page.getByTestId(`item-${id}`);

// The ids of everything listed on Review, in the order shown.
export async function listed(page: Page): Promise<string[]> {
  return page.locator('article[data-testid^="item-"]').evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice('item-'.length)));
}

export interface BucketNumbers {
  readonly total: number;
  readonly needs: number;
  readonly wants: number;
  readonly savings: number;
  readonly momReserve: number;
  readonly heldForOthers: number;
  readonly waitingOut: number;
  readonly waitingIn: number;
}

// What the Buckets screen shows, read off it (the page must be on Buckets).
export async function readBuckets(page: Page): Promise<BucketNumbers> {
  const optional = async (testId: string): Promise<number> => ((await page.getByTestId(testId).count()) === 0 ? 0 : centsAt(page, testId));
  return {
    total: await centsAt(page, 'buckets-total'),
    needs: await centsAt(page, 'bucket-needs-left'),
    wants: await centsAt(page, 'bucket-wants-left'),
    savings: await centsAt(page, 'savings'),
    momReserve: await centsAt(page, 'mom-reserve'),
    heldForOthers: await centsAt(page, 'held-for-others'),
    waitingOut: await optional('waiting-out'),
    waitingIn: await optional('waiting-in'),
  };
}

// The same, going there with the tab bar and coming back to Review.
export async function bucketsOnScreen(page: Page): Promise<BucketNumbers> {
  await page.getByTestId('tab-buckets').click();
  await page.getByTestId('buckets-total').waitFor();
  const numbers = await readBuckets(page);
  await page.getByTestId('tab-review').click();
  await page.getByTestId('review-count').waitFor();
  return numbers;
}

// The same numbers, from the money math.
export function bucketsOf(book: Book): BucketNumbers {
  const p = book.pots();
  return { total: book.appSide(), needs: p.needs, wants: p.wants, savings: p.savings, momReserve: p.momReserve, heldForOthers: p.heldForOthers, waitingOut: p.unsortedOut, waitingIn: p.unsortedIn };
}

// Counts what the page sends to /api/choice, and the decision numbers used.
export function watchChoices(page: Page): { readonly posts: Request[]; readonly ids: () => string[] } {
  const posts: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/choice') posts.push(r);
  });
  return { posts, ids: () => posts.map((p) => (JSON.parse(p.postData() ?? '{}') as { id: string }).id) };
}

// A second tap got through on CI (Oct 8, WebKit on Linux): a choice had gone
// through, the screen was redrawn with the sheet's send button enabled again,
// and the sheet itself only closed a moment later. A tap in that moment sends
// the choice again. This watches for exactly that moment, whatever the timing
// of any tap: after an answer that said ok, a sheet that is still open must
// not show an enabled button matching `sendButtons` (a CSS selector for the
// buttons that send). Set it up on the context before the page opens.
export async function watchSheetsAfterAnAnswer(context: BrowserContext, sendButtons: string): Promise<void> {
  await context.addInitScript((selector: string) => {
    const w = window as unknown as { __answeredOk: boolean; __sheetGaps: string[] };
    w.__answeredOk = false;
    w.__sheetGaps = [];
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await real(input, init);
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/choice') && init?.method === 'POST') {
        const json = response.json.bind(response);
        response.json = async () => {
          const body = (await json()) as { ok?: boolean };
          if (body.ok === true) w.__answeredOk = true;
          return body;
        };
      }
      return response;
    };
    new MutationObserver(() => {
      if (!w.__answeredOk) return;
      for (const dialog of document.querySelectorAll('dialog[open]')) {
        for (const button of dialog.querySelectorAll(selector)) {
          if (!(button as HTMLButtonElement).disabled) w.__sheetGaps.push(`${dialog.getAttribute('data-testid') ?? 'sheet'}: ${button.getAttribute('data-testid') ?? button.tagName} is enabled in an open sheet`);
        }
      }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  }, sendButtons);
}

// The rest of a double tap (settings.test.ts "B92 a double tap on Save", CI
// Oct 11, WebKit): the first tap's answer closed the sheet at once, and the
// second tap landed on the screen under it. This taps the button, and the
// moment its sheet has closed taps again where the button was, as the second
// tap of a double tap would: inside the page, at the spot, whatever is there
// then (the browser's own hit test), so how fast the machine is makes no
// difference. Returns what of the screen that tap reached: 'nothing' while
// the screen holds taps.
export async function tapThenTapWhereItWas(page: Page, button: Locator, sheet: string): Promise<string> {
  // Where it is once on the screen (a tap scrolls the sheet to it first).
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (box === null) throw new Error(`no ${sheet} button on the screen to tap`);
  const at = [sheet, box.x + box.width / 2, box.y + box.height / 2] as const;
  const second = page.waitForFunction(
    ([id, x, y]) => {
      if (document.querySelector(`dialog[data-testid="${id}"][open]`) !== null) return false;
      const hit = document.elementFromPoint(x, y);
      const screen = document.getElementById('root');
      const reached = hit !== null && screen !== null && screen.contains(hit) ? (hit.closest('[data-testid]')?.getAttribute('data-testid') ?? hit.tagName) : 'nothing';
      if (hit instanceof HTMLElement) hit.click();
      return reached;
    },
    at,
    { polling: 5, timeout: 15_000 },
  );
  await button.click();
  const reached = await (await second).jsonValue();
  if (typeof reached !== 'string') throw new Error(`the second tap on ${sheet} reached ${String(reached)}`);
  return reached;
}

// What watchSheetsAfterAnAnswer saw: whether a choice went through at all, and the moments it found.
export async function sheetGapsAfterAnAnswer(page: Page): Promise<{ readonly answered: boolean; readonly gaps: string[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __answeredOk: boolean; __sheetGaps: string[] };
    return { answered: w.__answeredOk, gaps: [...new Set(w.__sheetGaps)] };
  });
}
