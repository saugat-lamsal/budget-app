import { describe, expect, it } from 'vitest';
import type { ChoiceRequest } from '../src/views/choice.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Rule 13.8 (QUESTIONS.md A55, his OK Oct 16, 2026) through the real server:
// the second time he sorts something from the same place the same way by
// hand, the answer offers the rule, with the place's name as its text; "Yes,
// always" makes it from the item already sorted (B101), and the next one
// sorts itself. Review and the bucket lists carry the text "always do this"
// starts from. Every store and number is made up.

const C = ACCOUNT_IDS.checking;

async function shopping(): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  // Other purchases on checking, so the place's own words are not on most of them.
  life.h.fake.addPending({ id: 'o1', account: C, amount: 900, date: '2026-10-02', description: 'PURCHASE 10/02 CORNER BAKERY' });
  life.h.fake.addPending({ id: 'o2', account: C, amount: 1_200, date: '2026-10-02', description: 'PURCHASE 10/02 CITY BOOKS' });
  life.h.fake.addPending({ id: 'o3', account: C, amount: 700, date: '2026-10-02', description: 'PURCHASE 10/02 TACO TOWN' });
  life.h.fake.addPending({ id: 'g1', account: C, amount: 1_500, date: '2026-10-02', description: 'PURCHASE 10/02 GREEN LEAF MARKET' });
  life.h.fake.addPending({ id: 'g2', account: C, amount: 2_000, date: '2026-10-02', description: 'PURCHASE 10/02 GREEN LEAF MARKET' });
  await life.sync();
  return life;
}

function choose(life: Life, request: Omit<ChoiceRequest, 'id'>) {
  return life.keeper.choice({ id: decision(), ...request });
}

function offerOf(answer: ReturnType<typeof choose>) {
  if (!answer.ok) throw new Error(answer.why);
  return answer.done.offer ?? null;
}

describe('13.8 the rule offered with the answer', () => {
  it('13.8 the first hand sort offers nothing; the second of the same place the same way offers the place\'s name', async () => {
    const life = await shopping();
    try {
      expect(offerOf(choose(life, { item: 'g1', choice: { to: 'wants' } }))).toBeNull();
      expect(offerOf(choose(life, { item: 'g2', choice: { to: 'wants' } }))).toEqual({ for: 'purchase', contains: 'GREEN LEAF MARKET', to: 'wants' });
      // Another way: nothing.
      expect(offerOf(choose(life, { item: 'o1', choice: { to: 'needs' } }))).toBeNull();
    } finally {
      life.done();
    }
  });

  it('13.8 a split or "always do this" itself offers nothing', async () => {
    const life = await shopping();
    try {
      choose(life, { item: 'g1', choice: { to: 'wants' } });
      expect(offerOf(choose(life, { item: 'g2', choice: { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 'rest' }] } }))).toBeNull();
      expect(offerOf(choose(life, { item: 'o1', choice: { to: 'wants' }, always: { contains: 'CORNER BAKERY' }, confirmed: true }))).toBeNull();
    } finally {
      life.done();
    }
  });

  it('13.8 0.6 the hand sorts come back with the history: after a restart the next one is offered too, and a repeated decision gets its first answer', async () => {
    const life = await shopping();
    try {
      choose(life, { item: 'g1', choice: { to: 'wants' } });
      const id = decision();
      const first = life.keeper.choice({ id, item: 'g2', choice: { to: 'wants' } });
      life.restart();
      expect(life.keeper.choice({ id, item: 'g2', choice: { to: 'wants' } })).toEqual({ ...first, replayed: true });
      life.now = noonInNewYork('2026-10-09');
      life.h.fake.addPending({ id: 'g3', account: C, amount: 2_500, date: '2026-10-09', description: 'PURCHASE 10/09 GREEN LEAF MARKET' });
      await life.sync();
      expect(offerOf(choose(life, { item: 'g3', choice: { to: 'wants' } }))).toMatchObject({ contains: 'GREEN LEAF MARKET', to: 'wants' });
    } finally {
      life.done();
    }
  });

  it('13.8 13.6 B101 "Yes, always" from the offer makes the rule from the item already sorted; nothing moves, and the next one sorts itself', async () => {
    const life = await shopping();
    try {
      choose(life, { item: 'g1', choice: { to: 'wants' } });
      const offer = offerOf(choose(life, { item: 'g2', choice: { to: 'wants' } }));
      if (offer === null) throw new Error('no offer');
      const before = life.keeper.buckets();
      const yes = choose(life, { item: 'g2', choice: { to: offer.to }, always: { contains: offer.contains }, resort: true, confirmed: true });
      expect(yes).toMatchObject({ ok: true, done: { sticks: true } });
      expect(life.keeper.buckets()).toEqual(before);
      life.now = noonInNewYork('2026-10-09');
      life.h.fake.addPending({ id: 'g3', account: C, amount: 2_500, date: '2026-10-09', description: 'PURCHASE 10/09 GREEN LEAF MARKET' });
      await life.sync();
      const review = life.keeper.review();
      if (review.state !== 'tracking') throw new Error('not tracking');
      expect(review.items.map((d) => d.item.id)).not.toContain('g3');
    } finally {
      life.done();
    }
  });

  it('13.8 13.6 Review and the bucket lists carry what "always do this" starts from', async () => {
    const life = await shopping();
    try {
      const review = life.keeper.review();
      if (review.state !== 'tracking') throw new Error('not tracking');
      expect(review.items.find((d) => d.item.id === 'g1')?.ruleText).toBe('GREEN LEAF MARKET');
      choose(life, { item: 'g1', choice: { to: 'wants' } });
      const wants = life.keeper.activity('wants');
      if (wants.state !== 'tracking') throw new Error('not tracking');
      expect(wants.ruleTexts['g1']).toBe('GREEN LEAF MARKET');
    } finally {
      life.done();
    }
  });
});
