import type { Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { busyBook } from '../../money/test/busy-book.js';
import { START_DATE, cardCharge, deposit, openTestBook, paycheck, purchase, refund } from '../../money/test/helpers.js';
import { reviewView, type ReviewInput, type ReviewView } from '../src/views/review.js';

// The Review screen's list (Phase 4), worked out on the server from the book:
// everything waiting, with the choices the rulebook gives for each. Made-up
// numbers only.

function input(book: Book | null, over: Partial<ReviewInput> = {}): ReviewInput {
  return { today: START_DATE, book, madeUpData: false, ...over };
}

function tracking(view: ReviewView): Extract<ReviewView, { state: 'tracking' }> {
  if (view.state !== 'tracking') throw new Error(`expected tracking, got ${view.state}`);
  return view;
}

describe('14 before setup day', () => {
  it('14 there is nothing to review, and it says so', () => {
    expect(reviewView(input(null, { madeUpData: true }))).toEqual({ state: 'not-set-up', madeUpData: true });
  });
});

describe('10.3 B32 everything waiting in review is listed', () => {
  it('10.3 an empty review is an empty list, and nothing held back', () => {
    const v = tracking(reviewView(input(openTestBook())));
    expect(v.items).toEqual([]);
    expect(v.heldBack).toBe(0);
  });

  it('10.3 B32 money in, spending, leftover questions, and old card flags are all counted', () => {
    const book = busyBook();
    const v = tracking(reviewView(input(book)));
    expect(v.items.map((d) => d.item.id).sort()).toEqual(book.reviewItems().map((i) => i.id).sort());
    expect(v.items.length).toBe(book.reviewItems().length);
  });

  it('4.3 what is held back from safe to spend is the unsorted spending', () => {
    const book = openTestBook();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    book.receive(purchase('p2', START_DATE, 2_317, 'ONLINE MARKETPLACE'));
    book.receive(deposit('d1', START_DATE, 99_999, 'MADE UP GIFT'));
    expect(tracking(reviewView(input(book))).heldBack).toBe(3_467);
  });

  it('each item carries its choices, its account, the likely purchases, and the paycheck preview, as the money math gives them', () => {
    const book = busyBook();
    const v = tracking(reviewView(input(book)));
    expect([...v.items].sort((a, b) => (a.item.id < b.item.id ? -1 : 1))).toEqual([...book.reviewDetails()].sort((a, b) => (a.item.id < b.item.id ? -1 : 1)));
  });
});

describe('the order: payday questions first, then money in, then spending, then old card flags', () => {
  it('3.4 leftover questions come first, then money in, spending, and old card flags; each group oldest first', () => {
    const book = busyBook();
    const order = tracking(reviewView(input(book))).items.map((d) => d.item);
    const rank = (type: string): number => ['leftover', 'money-in', 'spending', 'old-card-purchase'].indexOf(type);
    const ranks = order.map((i) => rank(i.type));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks.every((r) => r >= 0)).toBe(true);
    for (const type of ['money-in', 'spending'] as const) {
      const dates = order.flatMap((i) => (i.type === type ? [i.date] : []));
      expect(dates).toEqual([...dates].sort());
    }
  });

  it('items with the same date keep the order the book has them in', () => {
    const book = openTestBook();
    book.receive(purchase('b', START_DATE, 100, 'SECOND SHOP'));
    book.receive(purchase('a', START_DATE, 200, 'FIRST SHOP'));
    book.receive(cardCharge('c', START_DATE, 300, 'fee'));
    expect(tracking(reviewView(input(book))).items.map((d) => d.item.id)).toEqual(['b', 'a', 'c']);
  });

  it('showing the list changes nothing in the book', () => {
    const book = busyBook();
    const before = JSON.stringify({ pots: book.pots(), review: book.reviewItems(), log: book.changeLog() });
    reviewView(input(book));
    expect(JSON.stringify({ pots: book.pots(), review: book.reviewItems(), log: book.changeLog() })).toBe(before);
  });
});

describe('what the phone is sent', () => {
  it('it is plain data: sent as JSON and read back it is the same', () => {
    const v = reviewView(input(busyBook(), { madeUpData: true }));
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });

  it('20d a refund carries the purchases it likely belongs to', () => {
    const book = openTestBook();
    book.receive(purchase('market', '2026-10-01', 2_317, 'ONLINE MARKETPLACE'));
    book.receive({ ...refund('r1', START_DATE, 2_317, undefined, 'everyday-card'), description: 'ONLINE MARKETPLACE' });
    const v = tracking(reviewView(input(book)));
    const r = v.items.find((d) => d.item.id === 'r1');
    expect(r?.likelyPurchases.map((p) => p.id)).toEqual(['market']);
  });

  it('3.2 a deposit carries the split it would get as my paycheck', () => {
    const book = openTestBook({ pots: { momReserve: 0 } });
    book.receive(deposit('d1', START_DATE, 420_000, 'MADE UP NEW JOB'));
    book.receive(paycheck('early', START_DATE, 100_000));
    const v = tracking(reviewView(input(book)));
    expect(v.items.find((d) => d.item.id === 'd1')?.paycheckPreview).toMatchObject({ momReserve: 150_000, needs: 81_000, wants: 54_000, savings: 135_000 });
  });
});
