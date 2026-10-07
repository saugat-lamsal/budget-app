import type { Book, Cents, IsoDate, ReviewDetail } from '@budget-app/money';

// What the Review screen shows, worked out on the server from the book:
// everything waiting, with the choices the rulebook gives for each kind of
// item (from the money math, so the screen decides nothing).

export interface ReviewInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  readonly madeUpData: boolean;
}

export type ReviewView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      // 4.3: unsorted spending, held back from safe to spend until sorted.
      readonly heldBack: Cents;
      // Payday questions first, then money in, spending, and old card flags;
      // each group oldest first (B32: all of them wait here).
      readonly items: readonly ReviewDetail[];
    };

const GROUPS: readonly ReviewDetail['item']['type'][] = ['leftover', 'money-in', 'spending', 'old-card-purchase'];

export function reviewView(input: ReviewInput): ReviewView {
  const { today, book, madeUpData } = input;
  if (book === null) return { state: 'not-set-up', madeUpData };
  const items = book
    .reviewDetails()
    // Array.prototype.sort is stable, so items of the same group and day stay in the book's order.
    .sort((a, b) => GROUPS.indexOf(a.item.type) - GROUPS.indexOf(b.item.type) || (a.item.date < b.item.date ? -1 : a.item.date > b.item.date ? 1 : 0));
  return { state: 'tracking', madeUpData, today, heldBack: book.pots().unsortedOut, items };
}
