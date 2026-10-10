import { describe, expect, it } from 'vitest';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { choose, decision, everything, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// QUESTIONS.md A29, his answer (option 2), through the real server: the bank
// sends a store's refund to the debit card as money in to checking. Review
// offers "this refund is for this one" with the likely purchases on checking,
// it asks first, and the match is kept: after a restart the books are the
// same. Every name and number is made up.

const C = ACCOUNT_IDS.checking;

async function boughtAndRefunded(purchase: number, refund: number, sort: (life: Life) => void): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  life.h.fake.addPosted({ id: 'shoes', account: C, amount: purchase, date: '2026-10-02', description: 'MADE UP SHOE STORE' });
  await life.sync();
  sort(life);
  life.now = noonInNewYork('2026-10-06');
  // Plaid's sign: money in is negative.
  life.h.fake.addPosted({ id: 'shoes-back', account: C, amount: -refund, date: '2026-10-06', description: 'MADE UP SHOE STORE REFUND' });
  await life.sync();
  return life;
}

function waitingRefund(life: Life) {
  const review = life.keeper.review();
  if (review.state !== 'tracking') throw new Error('not tracking');
  const item = review.items.find((d) => d.item.id === 'shoes-back');
  if (item === undefined) throw new Error('the refund is not waiting');
  return item;
}

describe('4.5 6.1 A29 a store refund to the debit card, through the real server', () => {
  it('4.5 A29 it waits in review as money in to checking, with its likely purchase on checking to match', async () => {
    const life = await boughtAndRefunded(8_999, 8_999, (l) => {
      expect(choose(l.keeper, { item: 'shoes', choice: { to: 'wants' } }).ok).toBe(true);
    });
    try {
      const item = waitingRefund(life);
      expect(item.item).toMatchObject({ type: 'money-in', reason: 'deposit' });
      expect(item.account).toBe('checking');
      expect(item.likelyPurchases.map((p) => p.id)).toEqual(['shoes']);
      expect(item.options.type === 'sort' ? item.options.match : []).toEqual(['shoes']);
    } finally {
      life.done();
    }
  });

  it('4.5 A29 matching it asks first; with his yes it goes back into wants, and a restart finds the books the same', async () => {
    const life = await boughtAndRefunded(8_999, 8_999, (l) => {
      expect(choose(l.keeper, { item: 'shoes', choice: { to: 'wants' } }).ok).toBe(true);
    });
    try {
      const wantsBefore = life.keeper.book()?.pots().wants ?? 0;
      const id = decision();
      const asked = life.keeper.choice({ id, item: 'shoes-back', choice: { refundOf: 'shoes' } });
      expect(asked).toMatchObject({ ok: false, code: 'needs-confirmation' });
      expect(life.keeper.choice({ id, item: 'shoes-back', choice: { refundOf: 'shoes' }, confirmed: true })).toMatchObject({ ok: true });
      expect(life.keeper.book()?.pots()).toMatchObject({ wants: wantsBefore + 8_999, unsortedIn: 0 });
      expect(life.keeper.book()?.purchases().find((p) => p.id === 'shoes')).toMatchObject({ refunded: 8_999 });
      const books = everything(life.keeper.book()!);
      life.restart();
      expect(everything(life.keeper.book()!)).toEqual(books);
    } finally {
      life.done();
    }
  });

  it('4.5 A1 A29 a partial refund of a split purchase sends the purchase back to review to be split again; a full one gives each bucket its part', async () => {
    const split = (l: Life): void => {
      expect(choose(l.keeper, { item: 'shoes', choice: { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] } }).ok).toBe(true);
    };
    const partial = await boughtAndRefunded(9_000, 1_000, split);
    try {
      expect(choose(partial.keeper, { item: 'shoes-back', choice: { refundOf: 'shoes' } }).ok).toBe(true);
      const review = partial.keeper.review();
      expect(review.state === 'tracking' ? review.items.map((d) => d.item) : []).toMatchObject([{ id: 'shoes', reason: 'split-changed', amount: 8_000 }]);
    } finally {
      partial.done();
    }
    const full = await boughtAndRefunded(9_000, 9_000, split);
    try {
      const before = full.keeper.book()!.pots();
      expect(choose(full.keeper, { item: 'shoes-back', choice: { refundOf: 'shoes' } }).ok).toBe(true);
      expect(full.keeper.book()!.pots()).toMatchObject({ needs: before.needs + 6_000, wants: before.wants + 3_000, unsortedIn: 0 });
    } finally {
      full.done();
    }
  });
});
