import type { Book, IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { appSide, openTestBook } from '../../../money/test/helpers.js';
import { axeViolations, tappable } from './design-helpers.js';
import { ENGINES, close, openScenario, phone, textAt, untilQuiet, useEngine } from './harness.js';
import { openLive, startLive } from './live.js';
import { bucketsOf, readBuckets } from './screens.js';

// QUESTIONS.md A21, option 2: a payment marked as going to the old card from
// savings (5.6, A4) has its own choice, "It was not a payment to the old
// card", in Review and on its bucket's list. It brings back what the bank
// sent: money leaving savings, waiting in Review (4.9). The old card owes
// what it did before. Compared with a twin of the book given the same answer.

const TODAY: IsoDate = '2026-10-20';

function marked(sortedTo?: 'savings' | 'needs'): Book {
  const book = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000 }, oldCardDebt: 300_000 });
  book.receive({ kind: 'savings-withdrawal', id: 'w1', account: 'savings', date: '2026-10-05', amount: 20_000, description: 'MADE UP WATER UTILITY', pending: false });
  book.sort('w1', { transfer: 'old-card' }, '2026-10-06');
  if (sortedTo !== undefined) book.sort('w1', { to: sortedTo }, '2026-10-07');
  return book;
}

const bankOf = (book: Book) => ({ checking: appSide(book.pots()) - book.inTransit().total, savings: 0, everydayCard: 0 });

describe.each(ENGINES)('"It was not a payment to the old card" in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('A21 design rules: readable in light and dark, and every tap target at least 44 points, with the choice open', async () => {
    const problems: string[] = [];
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser().newContext(phone({ colorScheme: scheme, bypassCSP: true }));
      const page = await openScenario(context, base(), 'review-marked-savings', '/review');
      await page.getByTestId('item-act-water').getByTestId('more').click();
      await page.getByTestId('choice-unmark').waitFor();
      problems.push(...(await axeViolations(page)).map((p) => `${scheme}: ${p}`));
      for (const t of await tappable(page)) if (t.width < 44 || t.height < 44) problems.push(`${scheme}: ${t.what} is ${t.width}x${t.height}`);
      await context.close();
    }
    expect(problems).toEqual([]);
  });

  it('5.6 A21 4.9 in Review: its own choice, and then it waits as money out of savings, the old card owing what it did', async () => {
    const book = marked();
    const twin = marked();
    const live = await startLive({ book, bank: bankOf(book), today: TODAY });
    const context = await browser().newContext(phone());
    try {
      const page = await openLive(context, live.base, '/review');
      await page.getByTestId('item-w1').getByTestId('more').click();
      await page.getByTestId('choice-unmark').waitFor();
      expect(await textAt(page, 'sheet-unmark')).toContain('It was not a payment to the old card');
      await page.getByTestId('choice-unmark').click();
      await page.getByTestId('notice').waitFor();
      expect(await page.getByTestId('notice').locator('.notice__text').innerText()).toContain('is what the bank sent again, not a payment to the old card');
      await untilQuiet(page);
      twin.sort('w1', { unmark: true }, TODAY);
      expect(book.reviewItems()).toEqual(twin.reviewItems());
      expect(book.reviewItems()).toMatchObject([{ id: 'w1', reason: 'from-savings', amount: 20_000 }]);
      expect(book.oldCardDebt()).toBe(300_000);
      expect(await page.getByTestId('item-w1').innerText()).toContain('Money out of savings');
      await page.getByTestId('tab-buckets').click();
      await page.getByTestId('buckets-total').waitFor();
      expect(await readBuckets(page)).toEqual(bucketsOf(twin));
    } finally {
      await context.close();
      await close(live.server);
    }
  });

  it('5.6 A21 A4 on the Savings list, after it was sorted to savings: Savings gets its money back and it waits in Review', async () => {
    const book = marked('savings');
    const twin = marked('savings');
    const live = await startLive({ book, bank: bankOf(book), today: TODAY });
    const context = await browser().newContext(phone());
    try {
      const page = await openLive(context, live.base, '/buckets/savings');
      await page.getByTestId('row-w1').click();
      await page.getByTestId('activity-sheet').getByTestId('choice-unmark').click();
      await page.getByTestId('notice').waitFor();
      await untilQuiet(page);
      twin.sort('w1', { unmark: true }, TODAY);
      expect(book.pots()).toEqual(twin.pots());
      expect(book.pots().savings).toBe(100_000);
      expect(await page.getByTestId('row-w1').count()).toBe(0);
    } finally {
      await context.close();
      await close(live.server);
    }
  });

  it('A21 nowhere else: a plain purchase or the bank\'s own payment to the old card from savings has no such choice', async () => {
    const book = openTestBook({ pots: { savings: 100_000, needs: 50_000 } });
    book.receive({ kind: 'transfer', id: 't1', from: 'savings', to: 'old-card', date: '2026-10-05', amount: 10_000, description: 'PAYMENT TO OLD CARD' });
    book.receive({ kind: 'purchase', id: 'p1', account: 'checking', date: '2026-10-05', amount: 1_000, description: 'MADE UP CAFE', pending: false });
    const live = await startLive({ book, bank: bankOf(book), today: TODAY });
    const context = await browser().newContext(phone());
    try {
      const page = await openLive(context, live.base, '/review');
      for (const id of ['t1', 'p1']) {
        await page.getByTestId(`item-${id}`).getByTestId('more').click();
        await page.getByTestId('review-sheet').waitFor();
        expect(await page.getByTestId('choice-unmark').count(), id).toBe(0);
        await page.keyboard.press('Escape');
      }
    } finally {
      await context.close();
      await close(live.server);
    }
  });
});
