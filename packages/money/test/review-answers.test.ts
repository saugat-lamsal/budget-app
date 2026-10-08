import { describe, expect, it } from 'vitest';
import type { Book, ReviewDetail } from '../src/index.js';
import { MOM_NAME, cardCharge, codeOf, deposit, openTestBook, payPerson, purchase, refund, takenBack, withdrawal, type TestBookOptions } from './helpers.js';

// His answers to the Buckets and Review questions (Oct 7):
// A18, option 2: a refund in review can be matched to a purchase it likely
//   belongs to, and then counts exactly as if the bank had matched it (4.5).
// A19, option 2: a new rule sorts the waiting items that can take it and
//   leaves the others waiting, saying which (13.2).
// And what marking something "transfer between my accounts" really does
// (5.6 with 5.1, 5.2, 5.3), so the screen can say so.

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

// Two books with the same purchases: in one the refund waits in review and is
// matched by hand; in the other the bank says which purchase it was for.
function twins(setup: (b: Book) => void, refundAmount: number, of: string) {
  const byHand = book();
  const byBank = book();
  setup(byHand);
  setup(byBank);
  byHand.receive({ ...refund('r1', '2026-10-06', refundAmount, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
  byBank.receive({ ...refund('r1', '2026-10-06', refundAmount, of, 'everyday-card'), description: 'MADE UP SHOP' });
  return { byHand, byBank };
}

describe('4.5 A18 a refund in review matched to the purchase it belongs to', () => {
  it('4.5 A18 the purchases a refund can be matched to are the ones it likely belongs to', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-01', 2_000, 'MADE UP SHOP'));
    b.receive(purchase('p2', '2026-10-02', 5_000, 'MADE UP SHOP'));
    b.receive({ ...refund('r1', '2026-10-06', 2_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
    const d = detail(b, 'r1');
    expect(sorting(d).match).toEqual(d.likelyPurchases.map((p) => p.id));
    expect(sorting(d).match).toEqual(['p1', 'p2']);
  });

  it('4.5 A18 only a refund can be matched: a deposit and spending have nothing to match', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-01', 2_000, 'MADE UP SHOP'));
    b.receive(deposit('d1', '2026-10-06', 2_000, 'MADE UP SHOP'));
    expect(sorting(detail(b, 'd1')).match).toEqual([]);
    expect(sorting(detail(b, 'p1')).match).toEqual([]);
    expect(codeOf(() => b.sort('d1', { refundOf: 'p1' }, '2026-10-07'))).toBe('bad-choice');
    expect(codeOf(() => b.sort('p1', { refundOf: 'p1' }, '2026-10-07'))).toBe('bad-choice');
  });

  it('4.5 A18 matched to a purchase in wants, its money goes back into wants, as if the bank had matched it', () => {
    const { byHand, byBank } = twins((b) => {
      b.receive(purchase('p1', '2026-10-01', 2_000, 'MADE UP SHOP'));
      b.sort('p1', { to: 'wants' }, '2026-10-01');
    }, 2_000, 'p1');
    byHand.sort('r1', { refundOf: 'p1' }, '2026-10-07');
    expect(byHand.pots()).toEqual(byBank.pots());
    expect(byHand.purchases()).toEqual(byBank.purchases());
    expect(byHand.reviewItems()).toEqual([]);
    expect(byHand.pots()).toMatchObject({ wants: 30_000, unsortedIn: 0 });
    expect(byHand.recountPots()).toEqual(byHand.pots());
  });

  it('4.5 B7 matched to a purchase not sorted yet, it lowers what waits to be sorted', () => {
    const { byHand, byBank } = twins((b) => b.receive(purchase('p1', '2026-10-01', 5_000, 'MADE UP SHOP')), 2_000, 'p1');
    byHand.sort('r1', { refundOf: 'p1' }, '2026-10-07');
    expect(byHand.pots()).toEqual(byBank.pots());
    expect(byHand.reviewItems()).toEqual(byBank.reviewItems());
    expect(byHand.reviewItems()).toMatchObject([{ id: 'p1', amount: 3_000 }]);
  });

  it('4.5 A1 a full refund of a split purchase goes back to each bucket as it was split', () => {
    const split = (b: Book) => {
      b.receive(purchase('p1', '2026-10-01', 9_000, 'MADE UP SHOP'));
      b.sort('p1', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-01');
    };
    const { byHand, byBank } = twins(split, 9_000, 'p1');
    byHand.sort('r1', { refundOf: 'p1' }, '2026-10-07');
    expect(byHand.pots()).toEqual(byBank.pots());
    expect(byHand.pots()).toMatchObject({ needs: 50_000, wants: 30_000 });
  });

  it('4.5 A1 a partial refund of a split purchase sends the purchase back to be split again', () => {
    const split = (b: Book) => {
      b.receive(purchase('p1', '2026-10-01', 9_000, 'MADE UP SHOP'));
      b.sort('p1', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-01');
    };
    const { byHand, byBank } = twins(split, 1_000, 'p1');
    byHand.sort('r1', { refundOf: 'p1' }, '2026-10-07');
    expect(byHand.pots()).toEqual(byBank.pots());
    expect(byHand.reviewItems()).toEqual(byBank.reviewItems());
    expect(byHand.reviewItems()).toMatchObject([{ id: 'p1', reason: 'split-changed', amount: 8_000 }]);
  });

  it('4.5 A18 a refund that was put back into a bucket can still be matched instead, and the bucket gives it back', () => {
    const { byHand, byBank } = twins((b) => {
      b.receive(purchase('p1', '2026-10-01', 2_000, 'MADE UP SHOP'));
      b.sort('p1', { to: 'needs' }, '2026-10-01');
    }, 2_000, 'p1');
    byHand.sort('r1', { to: 'wants' }, '2026-10-07');
    byHand.sort('r1', { refundOf: 'p1' }, '2026-10-08');
    expect(byHand.pots()).toEqual(byBank.pots());
  });

  it('4.5 A18 a match is final: the refund cannot be sorted another way afterwards', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-01', 2_000, 'MADE UP SHOP'));
    b.receive({ ...refund('r1', '2026-10-06', 2_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
    b.sort('r1', { refundOf: 'p1' }, '2026-10-07');
    expect(codeOf(() => b.sort('r1', { to: 'wants' }, '2026-10-08'))).toBe('not-sortable');
  });

  it('4.5 A18 a refund that cannot belong to that purchase is refused, and nothing changes', () => {
    const b = book();
    b.receive(purchase('small', '2026-10-01', 1_000, 'MADE UP SHOP'));
    b.receive(purchase('debit', '2026-10-01', 5_000, 'MADE UP SHOP', { account: 'checking' }));
    b.receive(purchase('later', '2026-10-09', 5_000, 'MADE UP SHOP'));
    b.receive(cardCharge('fee', '2026-10-01', 5_000, 'fee'));
    b.receive(payPerson('friend', '2026-10-01', 5_000, 'MADE UP FRIEND'));
    b.receive(purchase('gone', '2026-10-01', 5_000, 'MADE UP SHOP'));
    b.receive(takenBack('tb', 'gone', '2026-10-02'));
    b.receive({ ...refund('r1', '2026-10-06', 2_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
    const before = snapshot(b);
    // Less left than the refund; another account; after the refund; not a purchase; taken back; nothing at all.
    for (const of of ['small', 'debit', 'later', 'fee', 'friend', 'gone', 'nothing-like-this', 'r1']) {
      expect(codeOf(() => b.sort('r1', { refundOf: of }, '2026-10-07')), of).toBe('bad-choice');
    }
    expect(codeOf(() => b.sort('r1', { refundOf: 7 as unknown as string }, '2026-10-07'))).toBe('bad-choice');
    expect(snapshot(b)).toBe(before);
  });

  it('4.5 an earlier refund already took part of it back: only what is left can be matched', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-01', 5_000, 'MADE UP SHOP'));
    b.receive(refund('r0', '2026-10-02', 4_000, 'p1', 'everyday-card'));
    b.receive({ ...refund('r1', '2026-10-06', 2_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
    expect(codeOf(() => b.sort('r1', { refundOf: 'p1' }, '2026-10-07'))).toBe('bad-choice');
    b.receive({ ...refund('r2', '2026-10-06', 1_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
    b.sort('r2', { refundOf: 'p1' }, '2026-10-07');
    expect(b.purchases()).toMatchObject([{ id: 'p1', refunded: 5_000 }]);
  });

  it('4.5 A18 a purchase made the same day as the refund can be matched', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-06', 5_000, 'MADE UP SHOP'));
    b.sort('p1', { to: 'wants' }, '2026-10-06');
    b.receive({ ...refund('r1', '2026-10-06', 5_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
    expect(sorting(detail(b, 'r1')).match).toEqual(['p1']);
    b.sort('r1', { refundOf: 'p1' }, '2026-10-06');
    expect(b.pots()).toMatchObject({ wants: 30_000, unsortedIn: 0 });
  });

  it('4.5 5.2 5.6 A18 a purchase that was really a payment to the old card is not one a refund can be matched to', () => {
    const b = book();
    b.receive(purchase('pay', '2026-10-01', 5_000, 'ONLINE PAYMENT', { account: 'checking' }));
    b.sort('pay', { transfer: 'old-card' }, '2026-10-01');
    b.receive({ ...refund('r1', '2026-10-06', 2_000, undefined, 'checking'), description: 'ONLINE PAYMENT' });
    expect(sorting(detail(b, 'r1')).match).toEqual([]);
    const before = snapshot(b);
    expect(codeOf(() => b.sort('r1', { refundOf: 'pay' }, '2026-10-07'))).toBe('bad-choice');
    expect(snapshot(b)).toBe(before);
  });

  it('4.10 the bank sending the same refund again is a duplicate, and the bank taking it back undoes the match', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-01', 2_000, 'MADE UP SHOP'));
    b.sort('p1', { to: 'wants' }, '2026-10-01');
    const sent = { ...refund('r1', '2026-10-06', 2_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' };
    b.receive(sent);
    b.sort('r1', { refundOf: 'p1' }, '2026-10-07');
    expect(b.receive(sent).outcome).toBe('duplicate');
    b.receive(takenBack('tb', 'r1', '2026-10-08'));
    expect(b.pots()).toMatchObject({ wants: 28_000, unsortedIn: 0 });
    expect(b.purchases()).toMatchObject([{ id: 'p1', refunded: 0 }]);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('0.1 a match that would make a total too large to keep exact is refused, and the refund still waits', () => {
    const big = Number.MAX_SAFE_INTEGER - 1_000;
    const b = book({ pots: { wants: big } });
    b.receive(purchase('p1', '2026-10-01', 2_000, 'MADE UP SHOP'));
    b.sort('p1', { to: 'wants' }, '2026-10-01');
    b.receive({ ...refund('r1', '2026-10-06', 2_000, undefined, 'everyday-card'), description: 'MADE UP SHOP' });
    // Wants fills up again in between, so giving the 2,000 back would overflow it.
    b.receive(deposit('d1', '2026-10-06', 2_500, 'MADE UP GIFT'));
    b.sort('d1', { to: 'wants' }, '2026-10-06');
    const before = snapshot(b);
    expect(codeOf(() => b.sort('r1', { refundOf: 'p1' }, '2026-10-07'))).toBe('not-cents');
    expect(snapshot(b)).toBe(before);
  });
});

describe('13.2 A19 a new rule sorts what can take it, and leaves the rest waiting', () => {
  function friends(): Book {
    const b = book();
    b.receive(payPerson('a', '2026-10-05', 4_000, 'MADE UP FRIEND'));
    b.receive(payPerson('b', '2026-10-05', 4_000, 'MADE UP FRIEND'));
    b.receive(refund('b-part', '2026-10-06', 1_000, 'b', 'checking'));
    b.receive(payPerson('c', '2026-10-05', 2_000, 'MADE UP FRIEND'));
    return b;
  }

  it('13.6 A19 "always for mom": the item and every other one that can be for mom are, and a partly refunded one stays waiting', () => {
    const b = friends();
    const answer = b.sortAlways('a', { to: 'mom' }, { id: 'friend', contains: 'MADE UP FRIEND' }, '2026-10-07');
    expect(answer).toEqual({ sticks: true, stillWaiting: ['b'] });
    expect(b.rules()).toMatchObject([{ id: 'friend', for: 'person', choice: { to: 'mom' } }]);
    expect(b.reviewItems().map((i) => i.id)).toEqual(['b']);
    expect(b.momSentInMonth('2026-10').sent).toBe(6_000);
    expect(b.pots().momReserve).toBe(150_000 - 6_000);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('13.2 A19 a rule added in settings does the same', () => {
    const b = friends();
    expect(b.addRule({ id: 'friend', for: 'person', contains: 'MADE UP FRIEND', choice: { to: 'mom' } }, '2026-10-07')).toEqual({ stillWaiting: ['b'] });
    expect(b.reviewItems().map((i) => i.id)).toEqual(['b']);
  });

  it('13.2 A19 and a rule changed in settings', () => {
    const b = friends();
    b.addRule({ id: 'friend', for: 'person', contains: 'NOBODY AT ALL', choice: { to: 'mom' } }, '2026-10-07');
    expect(b.changeRule({ id: 'friend', for: 'person', contains: 'MADE UP FRIEND', choice: { to: 'mom' } }, '2026-10-08')).toEqual({ stillWaiting: ['b'] });
    expect(b.reviewItems().map((i) => i.id)).toEqual(['b']);
  });

  it('13.2 when every waiting item can take the rule, nothing is left', () => {
    const b = friends();
    expect(b.sortAlways('a', { to: 'needs' }, { id: 'friend', contains: 'MADE UP FRIEND' }, '2026-10-07')).toEqual({ sticks: true, stillWaiting: [] });
    expect(b.reviewItems()).toEqual([]);
  });

  it('13.6 the item he chose for still has to take it: if it cannot, nothing is done at all', () => {
    const b = friends();
    const before = snapshot(b);
    expect(codeOf(() => b.sortAlways('b', { to: 'mom' }, { id: 'friend', contains: 'MADE UP FRIEND' }, '2026-10-07'))).toBe('bad-choice');
    expect(snapshot(b)).toBe(before);
  });
});

describe('5.6 what marking something a transfer between my accounts does', () => {
  it('5.1 5.3 5.2 from checking: to savings or the everyday card no bucket changes; to the old card it comes out of needs', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-05', 2_000, 'ONLINE TRANSFER', { account: 'checking' }));
    expect(sorting(detail(b, 'p1')).transferOutcome).toEqual({ savings: 'no-bucket-change', 'everyday-card': 'no-bucket-change', 'old-card': 'out-of-needs' });
    const toOldCard = book();
    toOldCard.receive(purchase('p1', '2026-10-05', 2_000, 'ONLINE TRANSFER', { account: 'checking' }));
    toOldCard.sort('p1', { transfer: 'old-card' }, '2026-10-06');
    expect(toOldCard.pots()).toMatchObject({ needs: 48_000, unsortedOut: 0 });
    expect(toOldCard.reviewItems()).toEqual([]);
    const toSavings = book();
    toSavings.receive(purchase('p1', '2026-10-05', 2_000, 'ONLINE TRANSFER', { account: 'checking' }));
    toSavings.sort('p1', { transfer: 'savings' }, '2026-10-06');
    expect(toSavings.pots()).toMatchObject({ needs: 50_000, wants: 30_000, savings: 100_000, unsortedOut: 0 });
  });

  it('5.2 A4 from savings to the old card it waits for him to choose savings or needs', () => {
    const b = book();
    b.receive(withdrawal('w1', '2026-10-05', 2_000, 'ONLINE TRANSFER'));
    expect(sorting(detail(b, 'w1')).transferOutcome).toEqual({ checking: 'no-bucket-change', 'everyday-card': 'no-bucket-change', 'old-card': 'savings-or-needs' });
    b.sort('w1', { transfer: 'old-card' }, '2026-10-06');
    expect(b.reviewItems()).toMatchObject([{ id: 'w1', reason: 'old-card-from-savings' }]);
    expect(b.pots()).toMatchObject({ needs: 50_000, savings: 100_000 });
  });

  it('5.6 a payment to a person from checking marked as a payment to the old card comes out of needs too', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-05', 2_000, 'MADE UP FRIEND'));
    expect(sorting(detail(b, 'z1')).transferOutcome['old-card']).toBe('out-of-needs');
    b.sort('z1', { transfer: 'old-card' }, '2026-10-06');
    expect(b.pots().needs).toBe(48_000);
  });

  it('5.6 money in marked as a transfer changes no bucket, from either account', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 2_000, 'MADE UP DEPOSIT', 'checking'));
    b.receive(refund('r1', '2026-10-05', 2_000, undefined, 'everyday-card'));
    expect(sorting(detail(b, 'd1')).transferOutcome).toEqual({ savings: 'no-bucket-change' });
    expect(sorting(detail(b, 'r1')).transferOutcome).toEqual({ checking: 'no-bucket-change', savings: 'no-bucket-change' });
  });

  it('5.6 nothing can be marked a transfer, nothing is said about it', () => {
    const b = book();
    b.receive(purchase('card', '2026-10-05', 2_000, 'MADE UP SHOP'));
    b.receive(payPerson('mom', '2026-10-05', 300_000, MOM_NAME));
    expect(sorting(detail(b, 'card')).transferOutcome).toEqual({});
  });
});
