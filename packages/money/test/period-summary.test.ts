import { describe, expect, it } from 'vitest';
import { ACTIVITY_KINDS, type Book, type Pot } from '../src/index.js';
import { activityProblems, summaryProblems } from './activity-helpers.js';
import { MOM_NAME, START_DATE, codeOf, deposit, openTestBook, payPerson, paycheck, purchase } from './helpers.js';

// A whole pay period added up (QUESTIONS.md B105), for the Payday screen's
// short summary of the pay period that just ended. What a bucket held at the
// start, plus what each kind of thing did to it, is what it held at the end.

const RULES = [
  { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
] as const;
const START = { savings: 100_000, needs: 50_000, wants: 20_000, momReserve: 120_000, heldForOthers: 0 } as const;

function aLife(): Book {
  const b = openTestBook({ pots: START, rules: RULES });
  b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
  b.receive(purchase('c1', '2026-10-03', 1_000, 'MADE UP CAFE'));
  b.receive(payPerson('m1', '2026-10-04', 50_000, MOM_NAME));
  b.moveMoney({ from: 'wants', to: 'needs', amount: 500 }, '2026-10-05');
  b.receive(deposit('d1', '2026-10-05', 5_000, 'MADE UP FRIEND'));
  b.sort('d1', { to: 'wants' }, '2026-10-05');
  return b;
}

const none = Object.fromEntries(ACTIVITY_KINDS.map((k) => [k, 0]));
const kinds = (some: Partial<Record<(typeof ACTIVITY_KINDS)[number], number>>) => ({ ...none, ...some });

describe('B105 a pay period is added up by kind of thing, bucket by bucket', () => {
  it('B105 pay period 0 is the stretch from setup day: what each bucket held, what each kind did, what it held at the end', () => {
    const s = aLife().periodSummary(0);
    expect(s).toMatchObject({ number: 0, startDate: START_DATE, endDate: null });
    expect(s.opening).toEqual(START);
    expect(s.closing).toEqual({ savings: 100_000, needs: 47_250, wants: 23_500, momReserve: 70_000, heldForOthers: 0 });
    expect(s.byKind.needs).toEqual(kinds({ spending: -3_250, move: 500 }));
    expect(s.byKind.wants).toEqual(kinds({ spending: -1_000, move: -500, 'money-in': 5_000 }));
    expect(s.byKind.momReserve).toEqual(kinds({ mom: -50_000 }));
    expect(s.byKind.savings).toEqual(kinds({}));
    expect(s.byKind.heldForOthers).toEqual(kinds({}));
  });

  it('B105 3.1 a paycheck ends the pay period it came in, and begins the next one, which starts where it left off', () => {
    const b = aLife();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const old = b.periodSummary(0);
    const fresh = b.periodSummary(1);
    expect(old).toMatchObject({ number: 0, startDate: START_DATE, endDate: '2026-10-09' });
    expect(old.closing).toEqual({ savings: 100_000, needs: 47_250, wants: 23_500, momReserve: 70_000, heldForOthers: 0 });
    expect(fresh).toMatchObject({ number: 1, startDate: '2026-10-09', endDate: null });
    expect(fresh.opening).toEqual(old.closing);
    expect(fresh.byKind.needs).toEqual(kinds({ paycheck: 75_000 }));
    expect(fresh.byKind.wants).toEqual(kinds({ paycheck: 50_000 }));
    expect(fresh.byKind.savings).toEqual(kinds({ paycheck: 125_000 }));
    expect(fresh.byKind.momReserve).toEqual(kinds({ paycheck: 150_000 }));
    // The pay period before is not changed by what came after it.
    expect(b.periodSummary(0)).toEqual(old);
  });

  it('B105 3.4 a leftover moved to savings after payday is in the new pay period, in both buckets', () => {
    const b = aLife();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.answerLeftover('leftover:p1:needs', 'move-to-savings', '2026-10-10');
    const fresh = b.periodSummary(1);
    expect(fresh.byKind.needs).toEqual(kinds({ paycheck: 75_000, leftover: -47_250 }));
    expect(fresh.byKind.savings).toEqual(kinds({ paycheck: 125_000, leftover: 47_250 }));
    expect(fresh.closing.needs).toBe(75_000);
    // What the old pay period ended with is what the question asked about.
    expect(b.periodSummary(0).closing.needs).toBe(47_250);
  });

  it('B105 the current pay period ends with what each bucket holds right now', () => {
    const b = aLife();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(purchase('g2', '2026-10-10', 100, 'MADE UP GROCERY'));
    const current = b.periodSummary();
    expect(current).toEqual(b.periodSummary(1));
    for (const pot of ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'] as Pot[]) expect(current.closing[pot]).toBe(b.pots()[pot]);
  });

  it('B105 a bucket that went below zero shows it: the pay period ends negative', () => {
    const b = openTestBook({ pots: { needs: 1_000 }, rules: RULES });
    b.receive(purchase('g1', '2026-10-02', 2_500, 'MADE UP GROCERY'));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const s = b.periodSummary(0);
    expect(s.byKind.needs).toEqual(kinds({ spending: -2_500 }));
    expect(s.closing.needs).toBe(-1_500);
  });

  it('12.2 B105 every pay period of every bucket adds up, on a long mixed history', () => {
    const b = aLife();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.answerLeftover('leftover:p1:needs', 'move-to-savings', '2026-10-10');
    b.answerLeftover('leftover:p1:wants', 'roll-over', '2026-10-10');
    b.receive(purchase('g2', '2026-10-11', 1_234, 'MADE UP GROCERY'));
    b.receive(paycheck('p2', '2026-10-23', 410_000));
    b.receive(deposit('d2', '2026-10-24', 10_000, 'MADE UP SIDE JOB'));
    b.sort('d2', { to: 'other-income' }, '2026-10-24');
    expect(b.period().number).toBe(2);
    expect(summaryProblems(b)).toEqual([]);
    expect(activityProblems(b, START)).toEqual([]);
  });

  it('B105 a pay period that does not exist is refused', () => {
    const b = aLife();
    expect(codeOf(() => b.periodSummary(1))).toBe('unknown-period');
    expect(codeOf(() => b.periodSummary(-1))).toBe('unknown-period');
    expect(codeOf(() => b.periodSummary(1.5))).toBe('unknown-period');
  });

  it('B105 what the book gives back cannot be used to change it', () => {
    const s = aLife().periodSummary(0);
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.opening)).toBe(true);
    expect(Object.isFrozen(s.closing)).toBe(true);
    expect(Object.isFrozen(s.byKind)).toBe(true);
    expect(Object.isFrozen(s.byKind.needs)).toBe(true);
  });

  it('0.1 B105 a refused change leaves the summary as it was', () => {
    const MAX = Number.MAX_SAFE_INTEGER;
    const b = openTestBook({ pots: { savings: MAX - 100_000, needs: 3_000 }, settings: { leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } } });
    const before = JSON.stringify([b.periodSummary(0)]);
    expect(codeOf(() => b.receive(paycheck('p1', '2026-10-09', 400_000)))).toBe('not-cents');
    expect(JSON.stringify([b.periodSummary()])).toBe(before);
    expect(b.period().number).toBe(0);
  });
});
