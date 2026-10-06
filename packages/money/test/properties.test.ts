// Random-scenario tests (testing bar point 4): things that must always be
// true, checked against many made-up histories.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, addDays, changeSettings, splitPaycheck, type Book, type LeftoverChoice } from '../src/index.js';
import { TestBank, appSide, deposit, openTestBook, paycheck, START_DATE } from './helpers.js';

const splitArb = fc
  .integer({ min: 0, max: 100 })
  .chain((savings) => fc.integer({ min: 0, max: 100 - savings }).map((needs) => ({ savings, needs, wants: 100 - savings - needs })));

const paycheckAmountArb = fc.oneof(
  fc.integer({ min: 1, max: 1_000_000 }),
  fc.integer({ min: 1, max: 1_000_000_000_000 }),
  fc.constantFrom(1, 149_999, 150_000, 150_001, 300_000),
);

const leftoverChoiceArb = fc.constantFrom<LeftoverChoice>('ask', 'roll-over', 'move-to-savings');

describe('random scenarios: payday (section 3)', () => {
  it('3.3 the paycheck parts always add up to the paycheck exactly, and each part is right', () => {
    fc.assert(
      fc.property(
        paycheckAmountArb,
        fc.integer({ min: -1_000_000, max: 1_000_000_000 }),
        splitArb,
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (amount, reserveNow, split, perPaycheck, cap) => {
          const rules = changeSettings(DEFAULT_SETTINGS, { split, momReservePerPaycheck: perPaycheck, momReserveCap: cap });
          const s = splitPaycheck(amount, reserveNow, rules);
          expect(s.momReserve + s.savings + s.needs + s.wants).toBe(amount);
          for (const part of [s.momReserve, s.savings, s.needs, s.wants]) {
            expect(Number.isSafeInteger(part) && part >= 0).toBe(true);
          }
          const reserveTaken = Math.min(perPaycheck, amount);
          expect(s.momReserve).toBe(Math.min(reserveTaken, Math.max(0, cap - reserveNow)));
          expect(s.momReserve + s.detail.overflowToSavings).toBe(reserveTaken);
          const rest = BigInt(amount - reserveTaken);
          expect(s.needs).toBe(Number((rest * BigInt(split.needs)) / 100n));
          expect(s.wants).toBe(Number((rest * BigInt(split.wants)) / 100n));
          expect(s.detail.roundingToSavings).toBeGreaterThanOrEqual(0);
          expect(s.detail.roundingToSavings).toBeLessThan(3);
        },
      ),
      { numRuns: 2_000 },
    );
  });
});

// One step in a made-up money life. Steps that need something to exist
// (like a question to answer) pick it by index, so every step can run.
type Step =
  | { type: 'paycheck'; gap: number; amount: number }
  | { type: 'deposit'; gap: number; amount: number }
  | { type: 'answer-leftover'; pick: number; choice: 'roll-over' | 'move-to-savings' }
  | { type: 'repeat'; pick: number };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ type: fc.constant('paycheck' as const), gap: fc.integer({ min: 0, max: 20 }), amount: paycheckAmountArb }),
  fc.record({ type: fc.constant('deposit' as const), gap: fc.integer({ min: 0, max: 20 }), amount: fc.integer({ min: 1, max: 1_000_000 }) }),
  fc.record({ type: fc.constant('answer-leftover' as const), pick: fc.nat(), choice: fc.constantFrom('roll-over' as const, 'move-to-savings' as const) }),
  fc.record({ type: fc.constant('repeat' as const), pick: fc.nat() }),
);

const potArb = fc.integer({ min: -1_000_000, max: 10_000_000 });
const openingArb = fc.record({ savings: potArb, needs: potArb, wants: potArb, momReserve: fc.integer({ min: 0, max: 400_000 }), heldForOthers: potArb });

function runLife(book: Book, bank: TestBank, steps: Step[]): void {
  let date = START_DATE;
  let n = 0;
  const received: Parameters<Book['receive']>[0][] = [];
  for (const step of steps) {
    switch (step.type) {
      case 'paycheck':
      case 'deposit': {
        date = addDays(date, step.gap);
        const id = `t${n++}`;
        const txn = step.type === 'paycheck' ? paycheck(id, date, step.amount) : deposit(id, date, step.amount);
        book.receive(txn);
        bank.apply(txn);
        received.push(txn);
        break;
      }
      case 'answer-leftover': {
        const open = book.reviewItems().filter((i) => i.type === 'leftover');
        const item = open[step.pick % Math.max(1, open.length)];
        if (item) book.answerLeftover(item.id, step.choice, date);
        break;
      }
      case 'repeat': {
        // Nothing is counted twice: the bank sending the same thing again changes nothing.
        const txn = received[step.pick % Math.max(1, received.length)];
        if (txn) expect(book.receive(txn).outcome).toBe('duplicate');
        break;
      }
    }
    // No cent is created or lost: the buckets always match the bank.
    expect(appSide(book.pots())).toBe(bank.side());
    // The running totals always equal a recount from scratch.
    expect(book.recountPots()).toEqual(book.pots());
    for (const value of Object.values(book.pots())) expect(Number.isSafeInteger(value)).toBe(true);
  }
}

describe('random scenarios: the whole book', () => {
  it('no cent is created or lost, and nothing is counted twice, through any mix of paydays and deposits', () => {
    fc.assert(
      fc.property(openingArb, leftoverChoiceArb, leftoverChoiceArb, splitArb, fc.array(stepArb, { maxLength: 40 }), (pots, needs, wants, split, steps) => {
        const book = openTestBook({ pots, settings: { split, leftoverAtPayday: { needs, wants } } });
        const bank = new TestBank({ checking: appSide(book.pots()) });
        runLife(book, bank, steps);
      }),
      { numRuns: 300 },
    );
  });
});
