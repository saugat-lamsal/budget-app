import { describe, expect, it } from 'vitest';
import type { Book, ReviewDetail } from '../src/index.js';
import { codeOf, deposit, openTestBook, payPerson, purchase, refund, takenBack, type TestBookOptions } from './helpers.js';

// His answer to QUESTIONS.md A29 (Oct 10), option 2: the bank shows a store's
// refund to the debit card as money in to checking, so money in to checking
// also offers "this refund is for this one", with the likely purchases on
// checking, the same as a card refund (4.5, 6.1). Picking one matches it
// exactly as if the bank had, and cannot be undone in review. Every name and
// number is made up.

function book(options: TestBookOptions = {}): Book {
  return openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000 }, ...options });
}

function detail(b: Book, id: string): ReviewDetail {
  const found = b.reviewDetails().find((d) => d.item.id === id);
  if (found === undefined) throw new Error(`nothing waiting with id ${id}`);
  return found;
}

function sorting(d: ReviewDetail) {
  if (d.options.type !== 'sort') throw new Error(`${d.item.id} is not something to sort`);
  return d.options;
}

function snapshot(b: Book): string {
  return JSON.stringify({ pots: b.pots(), review: b.reviewItems(), log: b.changeLog(), purchases: b.purchases(), rules: b.rules() });
}

const SHOP = 'MADE UP SHOP';

// Two books with the same purchases on the debit card: in one the store's
// refund arrives as money in to checking and is matched by hand; in the other
// the bank says it is a refund, of which purchase.
function twins(setup: (b: Book) => void, amount: number, of: string, date = '2026-10-06') {
  const byHand = book();
  const byBank = book();
  setup(byHand);
  setup(byBank);
  byHand.receive(deposit('d1', date, amount, `${SHOP} REFUND`));
  byBank.receive({ ...refund('d1', date, amount, of, 'checking'), description: `${SHOP} REFUND` });
  return { byHand, byBank };
}

function same(byHand: Book, byBank: Book): void {
  expect(byHand.pots()).toEqual(byBank.pots());
  expect(byHand.purchases()).toEqual(byBank.purchases());
  expect(byHand.reviewItems()).toEqual(byBank.reviewItems());
  for (const pot of ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'] as const) expect(byHand.activity(pot), pot).toEqual(byBank.activity(pot));
  expect(byHand.recountPots()).toEqual(byHand.pots());
}

describe('4.5 6.1 A29 money in to checking can be a store refund to the debit card', () => {
  it('4.5 6.1 A29 money in to checking offers its likely purchases on checking, with every deposit choice still there', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-01', 2_000, SHOP, { account: 'checking' }));
    b.receive(purchase('p2', '2026-10-02', 5_000, SHOP, { account: 'checking' }));
    b.receive(purchase('card', '2026-10-02', 2_000, SHOP));
    b.receive(deposit('d1', '2026-10-06', 2_000, `${SHOP} REFUND`));
    const d = detail(b, 'd1');
    expect(d.likelyPurchases.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(sorting(d).match).toEqual(['p1', 'p2']);
    // Still money in: the same choices as without a purchase to match (6.1).
    const alone = book();
    alone.receive(deposit('d1', '2026-10-06', 2_000, `${SHOP} REFUND`));
    expect(sorting(d).picks).toEqual(sorting(detail(alone, 'd1')).picks);
    expect(sorting(d).picks.map((p) => p.to)).toEqual(expect.arrayContaining(['paycheck', 'other-income', 'not-mine']));
  });

  it('4.5 A29 the likely purchases are on checking, on or before the money came in, with at least that much left to refund', () => {
    const b = book();
    b.receive(purchase('small', '2026-10-01', 1_999, SHOP, { account: 'checking' }));
    b.receive(purchase('exact', '2026-10-01', 2_000, SHOP, { account: 'checking' }));
    b.receive(purchase('same-day', '2026-10-06', 2_500, SHOP, { account: 'checking' }));
    b.receive(purchase('later', '2026-10-07', 5_000, SHOP, { account: 'checking' }));
    b.receive(purchase('card', '2026-10-01', 5_000, SHOP));
    b.receive(payPerson('friend', '2026-10-01', 5_000, 'MADE UP FRIEND'));
    b.receive(deposit('d1', '2026-10-06', 2_000, `${SHOP} REFUND`));
    expect(sorting(detail(b, 'd1')).match.slice().sort()).toEqual(['exact', 'same-day']);
  });

  it('4.5 A29 money in to savings is not a debit card refund: it has nothing to match', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-01', 2_000, SHOP, { account: 'checking' }));
    b.receive(deposit('d1', '2026-10-06', 2_000, `${SHOP} REFUND`, 'savings'));
    expect(sorting(detail(b, 'd1')).match).toEqual([]);
    expect(codeOf(() => b.sort('d1', { refundOf: 'p1' }, '2026-10-07'))).toBe('bad-choice');
  });

  it('4.5 3.7 A29 a paycheck-looking deposit held back as too early can be matched too', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-01', 2_000, SHOP, { account: 'checking' }));
    b.receive({ ...deposit('d1', '2026-10-02', 2_000), description: 'ACME PAYROLL' });
    const d = detail(b, 'd1');
    expect(d.item).toMatchObject({ type: 'money-in', reason: 'early-paycheck' });
    expect(sorting(d).match).toEqual(['p1']);
  });

  it('4.5 A29 matched to a purchase in wants, its money goes back into wants, as if the bank had matched it', () => {
    const { byHand, byBank } = twins((b) => {
      b.receive(purchase('p1', '2026-10-01', 2_000, SHOP, { account: 'checking' }));
      b.sort('p1', { to: 'wants' }, '2026-10-01');
    }, 2_000, 'p1');
    expect(byHand.pots()).toMatchObject({ unsortedIn: 2_000 });
    byHand.sort('d1', { refundOf: 'p1' }, '2026-10-07');
    same(byHand, byBank);
    expect(byHand.pots()).toMatchObject({ wants: 30_000, unsortedIn: 0 });
    expect(byHand.reviewItems()).toEqual([]);
  });

  it('4.5 A29 a partial refund of a purchase in needs gives needs that much back', () => {
    const { byHand, byBank } = twins((b) => {
      b.receive(purchase('p1', '2026-10-01', 5_000, SHOP, { account: 'checking' }));
      b.sort('p1', { to: 'needs' }, '2026-10-01');
    }, 1_250, 'p1');
    byHand.sort('d1', { refundOf: 'p1' }, '2026-10-07');
    same(byHand, byBank);
    expect(byHand.pots()).toMatchObject({ needs: 50_000 - 5_000 + 1_250 });
    expect(byHand.purchases()).toMatchObject([{ id: 'p1', refunded: 1_250 }]);
  });

  it('4.5 A1 A29 a full refund of a split purchase goes back to each bucket as it was split', () => {
    const { byHand, byBank } = twins((b) => {
      b.receive(purchase('p1', '2026-10-01', 9_000, SHOP, { account: 'checking' }));
      b.sort('p1', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-01');
    }, 9_000, 'p1');
    byHand.sort('d1', { refundOf: 'p1' }, '2026-10-07');
    same(byHand, byBank);
    expect(byHand.pots()).toMatchObject({ needs: 50_000, wants: 30_000, unsortedIn: 0 });
    expect(byHand.reviewItems()).toEqual([]);
  });

  it('4.5 A1 A29 a partial refund of a split purchase sends the purchase back to review to be split again', () => {
    const { byHand, byBank } = twins((b) => {
      b.receive(purchase('p1', '2026-10-01', 9_000, SHOP, { account: 'checking' }));
      b.sort('p1', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-01');
    }, 1_000, 'p1');
    byHand.sort('d1', { refundOf: 'p1' }, '2026-10-07');
    same(byHand, byBank);
    expect(byHand.reviewItems()).toMatchObject([{ id: 'p1', reason: 'split-changed', amount: 8_000 }]);
  });

  it('4.5 A29 matched to a purchase still waiting in review, it lowers what waits to be sorted', () => {
    const { byHand, byBank } = twins((b) => b.receive(purchase('p1', '2026-10-01', 5_000, SHOP, { account: 'checking' })), 2_000, 'p1');
    byHand.sort('d1', { refundOf: 'p1' }, '2026-10-07');
    same(byHand, byBank);
    expect(byHand.reviewItems()).toMatchObject([{ id: 'p1', amount: 3_000 }]);
  });

  it('4.5 A26 A29 a refund of all of a purchase still waiting in review takes it out of review, as a record', () => {
    const { byHand, byBank } = twins((b) => b.receive(purchase('p1', '2026-10-01', 2_000, SHOP, { account: 'checking' })), 2_000, 'p1');
    byHand.sort('d1', { refundOf: 'p1' }, '2026-10-07');
    same(byHand, byBank);
    expect(byHand.reviewItems()).toEqual([]);
  });

  it('4.5 A29 one cent, and an amount far too large to be real, both match to the cent', () => {
    for (const amount of [1, 9_000_000_000_00]) {
      const { byHand, byBank } = twins((b) => {
        b.receive(purchase('p1', '2026-10-01', amount, SHOP, { account: 'checking' }));
        b.sort('p1', { to: 'wants' }, '2026-10-01');
      }, amount, 'p1');
      byHand.sort('d1', { refundOf: 'p1' }, '2026-10-07');
      same(byHand, byBank);
    }
  });

  it('4.5 A29 a match is final: it cannot be sorted another way afterwards, and asking again is refused', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-01', 2_000, SHOP, { account: 'checking' }));
    b.receive(deposit('d1', '2026-10-06', 2_000, `${SHOP} REFUND`));
    b.sort('d1', { refundOf: 'p1' }, '2026-10-07');
    // Refused exactly as a matched card refund is (A18).
    const card = book();
    card.receive(purchase('p1', '2026-10-01', 2_000, SHOP));
    card.receive({ ...refund('d1', '2026-10-06', 2_000, undefined, 'everyday-card'), description: `${SHOP} REFUND` });
    card.sort('d1', { refundOf: 'p1' }, '2026-10-07');
    const before = snapshot(b);
    for (const choice of [{ to: 'wants' }, { to: 'paycheck' }, { refundOf: 'p1' }] as const) {
      const code = codeOf(() => b.sort('d1', choice, '2026-10-08'));
      expect(code, JSON.stringify(choice)).toBe(codeOf(() => card.sort('d1', choice, '2026-10-08')));
      expect(code, JSON.stringify(choice)).not.toBe('no error');
    }
    expect(codeOf(() => b.sort('d1', { to: 'wants' }, '2026-10-08'))).toBe('not-sortable');
    expect(snapshot(b)).toBe(before);
    expect(b.resortDetail('d1')).toMatchObject({ resortable: false });
  });

  it('4.5 A29 a purchase it cannot belong to is refused, and nothing changes', () => {
    const b = book();
    b.receive(purchase('one-cent-short', '2026-10-01', 1_999, SHOP, { account: 'checking' }));
    b.receive(purchase('card', '2026-10-01', 5_000, SHOP));
    b.receive(purchase('later', '2026-10-09', 5_000, SHOP, { account: 'checking' }));
    b.receive(payPerson('friend', '2026-10-01', 5_000, 'MADE UP FRIEND'));
    b.receive(purchase('gone', '2026-10-01', 5_000, SHOP, { account: 'checking' }));
    b.receive(takenBack('tb', 'gone', '2026-10-02'));
    b.receive(deposit('d1', '2026-10-06', 2_000, `${SHOP} REFUND`));
    const before = snapshot(b);
    for (const of of ['one-cent-short', 'card', 'later', 'friend', 'gone', 'nothing-like-this', 'd1']) expect(codeOf(() => b.sort('d1', { refundOf: of }, '2026-10-07')), of).toBe('bad-choice');
    expect(snapshot(b)).toBe(before);
  });

  it('4.5 A18 A29 money in already sorted as payback can be matched instead, from its bucket\'s list, and the bucket gives it back', () => {
    const { byHand, byBank } = twins((b) => {
      b.receive(purchase('p1', '2026-10-01', 2_000, SHOP, { account: 'checking' }));
      b.sort('p1', { to: 'needs' }, '2026-10-01');
    }, 2_000, 'p1');
    byHand.sort('d1', { to: 'wants' }, '2026-10-07');
    const again = byHand.resortDetail('d1');
    if (again === null || !again.resortable) throw new Error('the payback cannot be sorted again');
    expect(again.options.match).toEqual(['p1']);
    expect(again.likelyPurchases.map((p) => p.id)).toEqual(['p1']);
    byHand.sort('d1', { refundOf: 'p1' }, '2026-10-08');
    expect(byHand.pots()).toEqual(byBank.pots());
    expect(byHand.purchases()).toEqual(byBank.purchases());
  });

  it('4.10 A29 the bank taking the money back after it was matched undoes the refund, as for a refund the bank had matched', () => {
    const { byHand, byBank } = twins((b) => {
      b.receive(purchase('p1', '2026-10-01', 2_000, SHOP, { account: 'checking' }));
      b.sort('p1', { to: 'wants' }, '2026-10-01');
    }, 2_000, 'p1');
    byHand.sort('d1', { refundOf: 'p1' }, '2026-10-07');
    for (const b of [byHand, byBank]) b.receive(takenBack('tb', 'd1', '2026-10-09'));
    expect(byHand.pots()).toEqual(byBank.pots());
    expect(byHand.purchases()).toEqual(byBank.purchases());
    expect(byHand.pots()).toMatchObject({ wants: 30_000 - 2_000 });
    expect(byHand.recountPots()).toEqual(byHand.pots());
  });
});
