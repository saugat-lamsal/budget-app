import type { Book, IsoDate, ReviewDetail } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { ENGINES, openScenario, phone, textAt, useEngine } from './harness.js';
import { bucketsOf, bucketsOnScreen, item, listed, watchChoices } from './screens.js';

// QUESTIONS.md A29, his answer (option 2), on the Review screen: the bank
// shows a store's refund to the debit card as money in to checking, so it
// also offers "this refund is for this one", with the likely purchases on
// checking, the same as a card refund. Compared with a twin of the made-up
// life given the same answer directly. Every name and number is made up.

function life(name: string): { readonly book: Book; readonly today: IsoDate } {
  const input = demoScenario(name)?.input?.();
  if (input?.book === undefined || input.book === null) throw new Error(`no book in ${name}`);
  return { book: input.book, today: input.today };
}

function detailOf(book: Book, id: string): ReviewDetail {
  const found = book.reviewDetails().find((d) => d.item.id === id);
  if (found === undefined) throw new Error(`${id} is not waiting`);
  return found;
}

describe.each(ENGINES)('A29 a store refund to the debit card in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('A29 4.5 money in to checking shows its likely purchases on checking, with "This refund is for this one" for exactly the ones offered', async () => {
    const { book } = life('review-debit-refund');
    const d = detailOf(book, 'debit-refund');
    const offered = d.options.type === 'sort' ? d.options.match : [];
    expect(offered).toHaveLength(1);
    const page = await openScenario(await browser().newContext(phone()), base(), 'review-debit-refund', '/review');
    const card = item(page, 'debit-refund');
    expect(await card.locator('.likely__title').innerText()).toBe('A refund to your debit card?');
    expect(await card.getByTestId('likely-debit').innerText()).toContain("A store's refund to your debit card shows up like a deposit.");
    const buttons = await card.locator('[data-testid^="match-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')?.slice('match-'.length) ?? ''));
    expect(buttons).toEqual(offered);
    // Its usual choices are all still there.
    expect(await card.getByTestId('pick-paycheck').count()).toBe(1);
    await page.context().close();
  });

  it('A29 money in with no likely purchase (a tax refund) shows no such list', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'review-busy', '/review');
    expect(await item(page, 'busy-tax').getByTestId('likely').count()).toBe(0);
    await page.context().close();
  });

  it('A29 4.5 matching it asks first; yes counts it as if the bank had matched it, back into wants', async () => {
    const twin = life('review-debit-refund');
    const of = detailOf(twin.book, 'debit-refund').likelyPurchases[0]!.id;
    const page = await openScenario(await browser().newContext(phone()), base(), 'review-debit-refund', '/review');
    const watch = watchChoices(page);
    await item(page, 'debit-refund').getByTestId(`match-${of}`).click();
    expect(await textAt(page, 'confirm-title')).toBe('Match this refund?');
    await page.getByTestId('confirm-yes').click();
    await item(page, 'debit-refund').waitFor({ state: 'detached' });
    const wantsBefore = twin.book.pots().wants;
    twin.book.sort('debit-refund', { refundOf: of }, twin.today);
    expect(twin.book.pots().wants - wantsBefore).toBe(8_999);
    expect(watch.posts).toHaveLength(1);
    expect(JSON.parse(watch.posts[0]!.postData() ?? '{}')).toMatchObject({ item: 'debit-refund', choice: { refundOf: of }, confirmed: true });
    expect(await bucketsOnScreen(page)).toEqual(bucketsOf(twin.book));
    expect([...(await listed(page))].sort()).toEqual(twin.book.reviewItems().map((i) => i.id).sort());
    await page.context().close();
  });
});
