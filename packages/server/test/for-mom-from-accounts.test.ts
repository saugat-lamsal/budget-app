import { describe, expect, it } from 'vitest';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { choose, decision, everything, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Rule 7.9 (QUESTIONS.md A66), through the real server: a Zelle to mom from
// savings that the bank worded so no bank rule read it as a payment to a
// person (its posted words, B276) waits in review as money leaving savings.
// Review offers "for mom"; the reserve pays it, Buckets counts it toward the
// month, and after a restart the books are the same. Every name and number
// is made up.

const S = ACCOUNT_IDS.savings;
const E = ACCOUNT_IDS.everyday;
const TO_MOM = 'Zelle Transfer CONF# AB12CD; MADE UP MOM';

async function sentFromSavings(amount: number): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life, { momReserve: 100_000 });
  life.now = noonInNewYork('2026-11-02');
  life.h.fake.addPosted({ id: 'to-mom', account: S, amount, date: '2026-11-02', description: TO_MOM });
  await life.sync();
  return life;
}

function waiting(life: Life, id: string) {
  const review = life.keeper.review();
  if (review.state !== 'tracking') throw new Error('not tracking');
  const item = review.items.find((d) => d.item.id === id);
  if (item === undefined) throw new Error(`${id} is not waiting`);
  return item;
}

function buckets(life: Life) {
  const view = life.keeper.buckets();
  if (view.state !== 'tracking') throw new Error('not tracking');
  return view;
}

describe('7.9 money leaving savings marked for mom, through the real server', () => {
  it('7.9 it waits as money leaving savings, with for mom among its choices', async () => {
    const life = await sentFromSavings(60_000);
    try {
      const item = waiting(life, 'to-mom');
      expect(item.item).toMatchObject({ type: 'spending', reason: 'from-savings', amount: 60_000 });
      expect(item.options.type === 'sort' ? item.options.picks.map((p) => p.to) : []).toEqual(['needs', 'wants', 'not-mine', 'mom']);
    } finally {
      life.done();
    }
  });

  it('7.9 8.2 for mom: the reserve pays, Buckets counts it toward the month, and a restart finds the books the same', async () => {
    const life = await sentFromSavings(60_000);
    try {
      expect(choose(life.keeper, { item: 'to-mom', choice: { to: 'mom' } })).toMatchObject({ ok: true });
      expect(life.keeper.book()?.pots()).toMatchObject({ momReserve: 40_000, heldForOthers: 0, unsortedOut: 0 });
      expect(buckets(life).momReserve).toMatchObject({ amount: 40_000, month: '2026-11', sent: 60_000 });
      const books = everything(life.keeper.book()!);
      life.restart();
      expect(everything(life.keeper.book()!)).toEqual(books);
      expect(buckets(life).momReserve).toMatchObject({ amount: 40_000, sent: 60_000 });
    } finally {
      life.done();
    }
  });

  it('7.9 4.7 sorted to Other first, then for mom from its list: Other gets it back, the reserve pays, and a restart finds the same', async () => {
    const life = await sentFromSavings(60_000);
    try {
      expect(choose(life.keeper, { item: 'to-mom', choice: { to: 'not-mine' } })).toMatchObject({ ok: true });
      expect(life.keeper.book()?.pots()).toMatchObject({ momReserve: 100_000, heldForOthers: -60_000 });
      expect(choose(life.keeper, { item: 'to-mom', choice: { to: 'mom' }, resort: true })).toMatchObject({ ok: true });
      expect(life.keeper.book()?.pots()).toMatchObject({ momReserve: 40_000, heldForOthers: 0, unsortedOut: 0 });
      // The same again is where it already is (B101), and changes nothing.
      const pots = life.keeper.book()?.pots();
      expect(choose(life.keeper, { item: 'to-mom', choice: { to: 'mom' }, resort: true })).toMatchObject({ ok: false });
      expect(life.keeper.book()?.pots()).toEqual(pots);
      const books = everything(life.keeper.book()!);
      life.restart();
      expect(everything(life.keeper.book()!)).toEqual(books);
    } finally {
      life.done();
    }
  });

  it('7.9 8.3 bigger than the reserve: what the reserve cannot cover waits in review, and a restart finds the same', async () => {
    const life = await sentFromSavings(100_001);
    try {
      expect(choose(life.keeper, { item: 'to-mom', choice: { to: 'mom' } })).toMatchObject({ ok: true });
      expect(life.keeper.book()?.pots()).toMatchObject({ momReserve: 0, unsortedOut: 1 });
      expect(waiting(life, 'to-mom:difference').item).toMatchObject({ reason: 'mom-difference', amount: 1 });
      const books = everything(life.keeper.book()!);
      life.restart();
      expect(everything(life.keeper.book()!)).toEqual(books);
    } finally {
      life.done();
    }
  });

  it('7.9 the desk refuses for mom on a purchase on the everyday card, and nothing changes', async () => {
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life, { momReserve: 100_000 });
      life.now = noonInNewYork('2026-11-02');
      life.h.fake.addPosted({ id: 'shop', account: E, amount: 2_000, date: '2026-11-02', description: 'MADE UP SHOP' });
      await life.sync();
      const pots = life.keeper.book()?.pots();
      expect(life.keeper.choice({ id: decision(), item: 'shop', choice: { to: 'mom' } })).toMatchObject({ ok: false });
      expect(life.keeper.book()?.pots()).toEqual(pots);
    } finally {
      life.done();
    }
  });
});
