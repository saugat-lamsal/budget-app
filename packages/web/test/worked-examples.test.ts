import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../server/src/demo/scenarios.js';
import { homeView } from '../../server/src/views/home.js';
import { EXAMPLE_LIVES, checksOf, exampleNumbers } from './worked-examples.js';

// Every example in packages/web/worked-examples.txt, against what the server
// sends Home for the same made-up life.

function homeOf(number: number) {
  const input = demoScenario(EXAMPLE_LIVES[number] ?? '')?.input?.();
  if (input === undefined || input.book === null || input.bank === null) throw new Error(`example ${number} has no life`);
  const view = homeView(input);
  if (view.state !== 'tracking') throw new Error('not tracking');
  return { view, check: input.book.selfCheck(input.bank) };
}

describe('worked examples: the Home screen', () => {
  it('every example in the file has a made-up life', () => {
    expect(exampleNumbers()).toEqual([1, 2, 3, 4]);
    for (const n of exampleNumbers()) expect(EXAMPLE_LIVES[n], `example ${n}`).toBeDefined();
  });

  it.each(exampleNumbers())('example %i: every Check line is what Home is sent', (n) => {
    const { view, check } = homeOf(n);
    const review = view.attention.find((a) => a.kind === 'review');
    const savings = view.attention.find((a) => a.kind === 'move-to-savings');
    const got: Record<string, number | undefined> = {
      'safe to spend': view.safeToSpend.shown ? view.safeToSpend.amount : undefined,
      needs: view.buckets.needs.left,
      wants: view.buckets.wants.left,
      'needs started with': view.buckets.needs.startedWith,
      'wants started with': view.buckets.wants.startedWith,
      'held back': review?.kind === 'review' ? review.heldBack : undefined,
      waiting: view.waitingInReview,
      'still to move': savings?.kind === 'move-to-savings' ? savings.stillToMove : undefined,
      difference: check.difference,
      'bank side': check.bankSide,
      'app side': check.appSide,
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
});
