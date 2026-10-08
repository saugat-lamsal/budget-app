import type { ActivityRow, Book, Cents, Pot } from '@budget-app/money';
import type { Page } from 'playwright';
import { activityPath } from '../../src/app/routes.js';
import { readCents } from './harness.js';

// Reading the bucket lists and Payday off the screen, for the tests that
// compare what the screens show with the money math. A "+" in front of money
// that came in is read as nothing: the amount is what follows it.

export const cents = (text: string): Cents => readCents(text.trim().replace(/^\+/, ''));

export const amountAt = async (page: Page, testId: string): Promise<Cents> => cents(await page.getByTestId(testId).innerText());

export interface RowOnScreen {
  readonly id: string;
  readonly amount: Cents;
  readonly text: string;
}

export interface ActivityOnScreen {
  readonly now: Cents;
  readonly opening: Cents;
  readonly in: Cents;
  readonly out: Cents;
  readonly closing: Cents;
  readonly rows: readonly RowOnScreen[];
}

// What the screen of one bucket shows (the page must be on it and loaded).
export async function readActivity(page: Page): Promise<ActivityOnScreen> {
  const rows = await page.locator('.row[data-testid^="row-"]').evaluateAll((els) =>
    els.map((e) => ({
      id: (e.getAttribute('data-testid') ?? '').slice('row-'.length),
      amount: e.querySelector('[data-testid="row-amount"]')?.textContent ?? '',
      text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
    })),
  );
  return {
    now: await amountAt(page, 'activity-now'),
    opening: await amountAt(page, 'activity-opening'),
    in: await amountAt(page, 'activity-in'),
    out: await amountAt(page, 'activity-out'),
    closing: await amountAt(page, 'activity-closing'),
    rows: rows.filter((r) => r.amount !== '').map((r) => ({ id: r.id, amount: cents(r.amount), text: r.text })),
  };
}

// The same, from the money math.
export function activityOf(book: Book, pot: Pot): ActivityOnScreen {
  const a = book.activity(pot);
  return { now: a.closing, opening: a.opening, in: a.in, out: a.out, closing: a.closing, rows: a.rows.map((r) => ({ id: r.id, amount: r.amount, text: '' })) };
}

// Without the words, for comparing numbers only.
export function numbersOf(a: ActivityOnScreen): Omit<ActivityOnScreen, 'rows'> & { readonly rows: readonly { readonly id: string; readonly amount: Cents }[] } {
  return { now: a.now, opening: a.opening, in: a.in, out: a.out, closing: a.closing, rows: a.rows.map((r) => ({ id: r.id, amount: r.amount })) };
}

export function pathOfPot(pot: Pot): string {
  return activityPath(pot);
}

// The row of a bucket's list that is this item.
export function rowOf(book: Book, pot: Pot, match: (row: ActivityRow) => boolean): ActivityRow {
  const found = book.activity(pot).rows.find(match);
  if (found === undefined) throw new Error(`no such row in the list of ${pot}`);
  return found;
}
