import type { Book } from '@budget-app/money';
import type { Locator, Page, Request } from 'playwright';
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
