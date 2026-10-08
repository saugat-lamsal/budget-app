import { describe, expect, it } from 'vitest';
import { ChoiceDesk } from '../../server/src/choices.js';
import { demoScenario } from '../../server/src/demo/scenarios.js';
import { bucketsView } from '../../server/src/views/buckets.js';
import { homeView } from '../../server/src/views/home.js';
import { reviewView } from '../../server/src/views/review.js';
import { activityView } from '../../server/src/views/activity.js';
import { paydayView } from '../../server/src/views/payday.js';
import { ACTIVITY_EXAMPLES, BUCKETS_EXAMPLES, EXAMPLE_LIVES, HOME_EXAMPLES, MOVES_EXAMPLES, PAYDAY_EXAMPLES, REVIEW_EXAMPLES, checksOf, exampleNumbers } from './worked-examples.js';

// Every example in packages/web/worked-examples.txt, against what the server
// sends Home for the same made-up life.

function homeOf(number: number) {
  const input = demoScenario(EXAMPLE_LIVES[number] ?? '')?.input?.();
  if (input === undefined || input.book === null) throw new Error(`example ${number} has no life`);
  const view = homeView(input);
  if (view.state !== 'tracking') throw new Error('not tracking');
  return { view, check: input.bank === null ? null : input.book.selfCheck(input.bank) };
}

describe('worked examples: the Home screen', () => {
  it('every example in the file has a made-up life', () => {
    expect(exampleNumbers()).toEqual([...HOME_EXAMPLES, ...BUCKETS_EXAMPLES, ...REVIEW_EXAMPLES, ...ACTIVITY_EXAMPLES, ...MOVES_EXAMPLES, ...PAYDAY_EXAMPLES]);
    for (const n of exampleNumbers()) expect(EXAMPLE_LIVES[n], `example ${n}`).toBeDefined();
  });

  it.each(HOME_EXAMPLES)('example %i: every Check line is what Home is sent', (n) => {
    const { view, check } = homeOf(n);
    const review = view.attention.find((a) => a.kind === 'review');
    const savings = view.attention.find((a) => a.kind === 'move-to-savings');
    const tookBack = view.attention.find((a) => a.kind === 'bank-took-back');
    const s = view.safeToSpend;
    const got: Record<string, number | undefined> = {
      'safe to spend': view.safeToSpend.shown ? view.safeToSpend.amount : undefined,
      needs: view.buckets.needs.left,
      wants: view.buckets.wants.left,
      'needs started with': view.buckets.needs.startedWith,
      'wants started with': view.buckets.wants.startedWith,
      'held back': review?.kind === 'review' ? review.heldBack : undefined,
      waiting: view.waitingInReview,
      'still to move': savings?.kind === 'move-to-savings' ? savings.stillToMove : undefined,
      difference: check?.difference,
      'bank side': check?.bankSide,
      'app side': check?.appSide,
      'taken back': tookBack?.kind === 'bank-took-back' ? tookBack.amount : undefined,
      'last checked': !s.shown && s.why === 'bank-not-read' ? s.lastChecked?.amount : undefined,
      'days to payday': view.payday.days,
    };
    for (const [label, expected] of checksOf(n)) {
      expect(label in got, `example ${n}: unknown check "${label}"`).toBe(true);
      expect(got[label], `example ${n}: ${label}`).toBe(expected);
    }
  });

  it('example 3 is low and example 4 is empty (10.1, 10.2)', () => {
    expect(homeOf(3).view.buckets.wants.level).toBe('low');
    expect(homeOf(4).view.buckets.wants.level).toBe('empty');
    expect(homeOf(1).view.buckets.wants.level).toBe('ok');
  });

  it('example 2 hides safe to spend (0.5)', () => {
    expect(homeOf(2).view.safeToSpend.shown).toBe(false);
  });

  it("example 6 shows the time it was last checked, not today's number (0.5, B82)", () => {
    expect(homeOf(6).view.safeToSpend).toEqual({ shown: false, why: 'bank-not-read', lastChecked: { amount: 62_869, at: '2026-10-07T07:15:00-05:00' } });
  });
});

function lifeOf(n: number) {
  const input = demoScenario(EXAMPLE_LIVES[n] ?? '')?.input?.();
  if (input === undefined || input.book === null || input.bank === null) throw new Error(`example ${n} has no life`);
  return { book: input.book, bank: input.bank, today: input.today };
}

describe('worked examples: the Buckets screen', () => {
  it.each(BUCKETS_EXAMPLES)('example %i: every Check line is what Buckets is sent', (n) => {
    const { book, bank, today } = lifeOf(n);
    const v = bucketsView({ today, book, bank, madeUpData: true });
    if (v.state !== 'tracking') throw new Error('not tracking');
    const got: Record<string, number> = {
      total: v.total,
      savings: v.savings,
      needs: v.needs.left,
      wants: v.wants.left,
      'mom reserve': v.momReserve.amount,
      'mom sent': v.momReserve.sent,
      'held for others': v.heldForOthers.heldForOthers,
      'old card': v.oldCard,
      'waiting out': v.waiting.spending,
    };
    for (const [label, expected] of checksOf(n)) {
      expect(label in got, `example ${n}: unknown check "${label}"`).toBe(true);
      expect(got[label], `example ${n}: ${label}`).toBe(expected);
    }
  });

  it('example 7 is under the target, example 8 is within it (8.2)', () => {
    const position = (n: number) => {
      const { book, bank, today } = lifeOf(n);
      const v = bucketsView({ today, book, bank, madeUpData: true });
      return v.state === 'tracking' ? v.momReserve.position : null;
    };
    expect(position(7)).toBe('under');
    expect(position(8)).toBe('within');
  });
});

describe('worked examples: the Review screen', () => {
  it('example 9: the early deposit would give all 300.00 to the reserve, and asks first (B1, B52)', () => {
    const { book, today } = lifeOf(9);
    const v = reviewView({ today, book, madeUpData: true });
    if (v.state !== 'tracking') throw new Error('not tracking');
    const early = v.items.find((d) => d.item.id === 'busy-early');
    const p = early?.paycheckPreview;
    const got: Record<string, number | undefined> = {
      'preview mom': p?.momReserve,
      'preview savings': p?.savings,
      'preview needs': p?.needs,
      'preview wants': p?.wants,
      waiting: v.items.length,
    };
    for (const [label, expected] of checksOf(9)) {
      expect(label in got, `example 9: unknown check "${label}"`).toBe(true);
      expect(got[label], `example 9: ${label}`).toBe(expected);
    }
    // Asking first: nothing is done without his OK.
    const desk = new ChoiceDesk(book, () => today);
    const before = JSON.stringify(book.pots());
    expect(desk.decide({ id: 'worked-example-9', item: 'busy-early', choice: { to: 'paycheck' } })).toMatchObject({ ok: false, code: 'needs-confirmation' });
    expect(JSON.stringify(book.pots())).toBe(before);
  });

  it('example 10: the split, with the rest worked out by the money math, and everything in the buckets unchanged', () => {
    const { book, today } = lifeOf(10);
    const before = bucketsView({ today, book, bank: null, madeUpData: true });
    if (before.state !== 'tracking') throw new Error('not tracking');
    const store = book.reviewItems().find((i) => 'description' in i && i.description === 'CORNER STORE');
    if (store === undefined) throw new Error('no CORNER STORE waiting');
    const desk = new ChoiceDesk(book, () => today);
    const answer = desk.decide({ id: 'worked-example-10', item: store.id, choice: { split: [{ bucket: 'needs', amount: 400 }, { bucket: 'wants', amount: 'rest' }] } });
    if (!answer.ok) throw new Error(answer.why);
    const parts = 'split' in answer.done.choice ? answer.done.choice.split : [];
    const after = bucketsView({ today, book, bank: null, madeUpData: true });
    if (after.state !== 'tracking') throw new Error('not tracking');
    const got: Record<string, number | undefined> = {
      'split needs': parts.find((p) => p.bucket === 'needs')?.amount as number,
      'split wants': parts.find((p) => p.bucket === 'wants')?.amount as number,
      'needs after': after.needs.left,
      'wants after': after.wants.left,
      'waiting out after': after.waiting.spending,
      'total after': after.total,
    };
    for (const [label, expected] of checksOf(10)) {
      expect(label in got, `example 10: unknown check "${label}"`).toBe(true);
      expect(got[label], `example 10: ${label}`).toBe(expected);
    }
    expect(after.total).toBe(before.total);
  });

  it('example 11: the refund lists the two purchases it likely belongs to, by name and amount (20d)', () => {
    const { book, today } = lifeOf(11);
    const v = reviewView({ today, book, madeUpData: true });
    if (v.state !== 'tracking') throw new Error('not tracking');
    const refund = v.items.find((d) => d.item.id === 'busy-refund');
    const list = refund?.likelyPurchases ?? [];
    const got: Record<string, number | undefined> = { 'likely count': list.length, 'likely first': list[0]?.amount, 'likely second': list[1]?.amount };
    for (const [label, expected] of checksOf(11)) {
      expect(label in got, `example 11: unknown check "${label}"`).toBe(true);
      expect(got[label], `example 11: ${label}`).toBe(expected);
    }
    expect(list.map((p) => [p.sameName, p.sameAmount])).toEqual([
      [true, true],
      [true, false],
    ]);
  });
});

describe('worked examples: the bucket lists, moving money, and Payday', () => {
  it('example 12: every Check line is what the list of Needs is sent, with the 8 rows in it', () => {
    const { book, today } = lifeOf(12);
    const v = activityView({ today, book, pot: 'needs', madeUpData: true });
    if (v.state !== 'tracking') throw new Error('not tracking');
    const a = v.activity;
    const got: Record<string, number> = { 'carried in': a.opening, 'came in': a.in, 'went out': a.out, now: a.closing, rows: a.rows.length };
    for (const [label, expected] of checksOf(12)) {
      expect(label in got, `example 12: unknown check "${label}"`).toBe(true);
      expect(got[label], `example 12: ${label}`).toBe(expected);
    }
    // The gas station run gave and took the same 41.20, so it is not on Needs' list at all.
    expect(a.rows.some((r) => r.description === 'CORNER GAS STATION')).toBe(false);
    // And what is on Buckets for Needs is the list's "now".
    const buckets = bucketsView({ today, book, bank: lifeOf(12).bank, madeUpData: true });
    expect(buckets.state === 'tracking' && buckets.needs.left).toBe(a.closing);
  });

  it('example 13: the moves, the question out of savings, and the one that would leave Wants below zero', () => {
    const { book, today } = lifeOf(13);
    const desk = new ChoiceDesk(book, () => today);
    const move = (id: string, from: 'wants' | 'needs' | 'savings', to: 'wants' | 'needs' | 'savings', amount: number, confirmed = false) =>
      desk.move({ id: `example-13-${id}-0000`, move: { from, to, amount }, ...(confirmed ? { confirmed } : {}) });
    expect(move('one', 'wants', 'needs', 2_500).ok).toBe(true);
    const asked = move('two', 'savings', 'needs', 10_000);
    expect(asked).toMatchObject({ ok: false, code: 'needs-confirmation', reasons: ['out-of-savings'] });
    expect(book.pots().savings).toBe(955_000);
    expect(move('two', 'savings', 'needs', 10_000, true).ok).toBe(true);
    const typo = move('three', 'wants', 'needs', 70_000);
    expect(typo).toMatchObject({ ok: false, code: 'needs-confirmation', reasons: ['below-zero'] });
    const home = homeView({ ...demoScenario('normal')!.input!(), book, seenTakeBacks: new Set() });
    const buckets = bucketsView({ today, book, bank: lifeOf(13).bank, madeUpData: true });
    if (home.state !== 'tracking' || buckets.state !== 'tracking') throw new Error('not tracking');
    const got: Record<string, number | undefined> = {
      needs: buckets.needs.left,
      wants: buckets.wants.left,
      savings: buckets.savings,
      total: buckets.total,
      'safe to spend': home.safeToSpend.shown ? home.safeToSpend.amount : undefined,
    };
    for (const [label, expected] of checksOf(13)) {
      expect(label in got, `example 13: unknown check "${label}"`).toBe(true);
      expect(got[label], `example 13: ${label}`).toBe(expected);
    }
  });

  it('example 14: every Check line is what Payday is sent', () => {
    const { book, bank, today } = lifeOf(14);
    const v = paydayView({ today, book, bank, madeUpData: true });
    if (v.state !== 'tracking') throw new Error('not tracking');
    const p = v.report.paycheck!;
    const ended = v.report.ended!;
    const got: Record<string, number | undefined> = {
      paycheck: p.amount,
      'reserve before': p.reserveBefore,
      'into reserve': p.split.momReserve,
      'did not fit': p.split.detail.overflowToSavings,
      'to savings': p.split.savings,
      'to needs': p.split.needs,
      'to wants': p.split.wants,
      'still to move': v.toSavings.state === 'known' ? v.toSavings.transfer.stillToMove : undefined,
      'needs spent': ended.byKind.needs.spending,
      'wants spent': ended.byKind.wants.spending,
      'sent to mom': ended.byKind.momReserve.mom,
      'needs left': ended.closing.needs,
      'wants left': ended.closing.wants,
      'needs asked': v.report.leftovers[0]?.amount,
      'wants asked': v.report.leftovers[1]?.amount,
    };
    for (const [label, expected] of checksOf(14)) {
      expect(label in got, `example 14: unknown check "${label}"`).toBe(true);
      expect(got[label], `example 14: ${label}`).toBe(expected);
    }
    // The leftover questions are the ones about what was left at payday.
    expect(v.report.leftovers.map((l) => [l.leftAtPayday, l.outcome])).toEqual([[93_075, 'waiting'], [65_711, 'waiting']]);
  });
});
