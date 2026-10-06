// Random-scenario tests (testing bar point 4): things that must always be
// true, checked against many made-up histories.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUCKETS,
  DEFAULT_SETTINGS,
  addDays,
  changeSettings,
  splitPaycheck,
  type BankTransaction,
  type Book,
  type Purchase,
  type LeftoverChoice,
  type MoneyInChoice,
  type SortChoice,
  type SortingRule,
} from '../src/index.js';
import { MOM_NAME, TestBank, appSide, cardCharge, deposit, openTestBook, payPerson, paycheck, posted, purchase, refund, transfer, START_DATE } from './helpers.js';

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
  | { type: 'deposit'; gap: number; amount: number; description: string; account: 'checking' | 'savings' }
  | { type: 'answer-leftover'; pick: number; choice: 'roll-over' | 'move-to-savings' }
  | { type: 'repeat'; pick: number }
  | { type: 'purchase'; gap: number; amount: number; account: 'checking' | 'everyday-card' | 'old-card'; pending: boolean; description: string }
  | { type: 'post'; pick: number; change: number }
  | { type: 'refund'; pick: number; amount: number; linked: boolean; account: 'checking' | 'everyday-card' }
  | { type: 'card-charge'; amount: number; charge: 'fee' | 'interest' }
  | { type: 'sort'; pick: number; seed: number }
  | { type: 'resort'; pick: number; seed: number }
  | { type: 'transfer'; amount: number; from: 'checking' | 'savings'; to: 'checking' | 'savings' | 'everyday-card' | 'old-card' }
  | { type: 'old-card'; amount: number; what: 'purchase' | 'pending' | 'fee' | 'interest' | 'refund' }
  | { type: 'acknowledge'; pick: number }
  | { type: 'resort-money-in'; pick: number; seed: number }
  | { type: 'pay-person'; amount: number; payee: string }
  | { type: 'pay-mom'; amount: number };

const gapArb = fc.integer({ min: 0, max: 20 });
const smallAmountArb = fc.oneof(fc.integer({ min: 1, max: 50_000 }), fc.constantFrom(1, 2, 100));

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ type: fc.constant('paycheck' as const), gap: gapArb, amount: paycheckAmountArb }),
  fc.record({
    type: fc.constant('deposit' as const),
    gap: gapArb,
    amount: fc.integer({ min: 1, max: 1_000_000 }),
    description: fc.constantFrom('MADE UP DEPOSIT', 'MADE UP BONUS', 'MADE UP ROOMMATE', 'MADE UP FRIEND'),
    account: fc.constantFrom('checking' as const, 'savings' as const),
  }),
  fc.record({ type: fc.constant('answer-leftover' as const), pick: fc.nat(), choice: fc.constantFrom('roll-over' as const, 'move-to-savings' as const) }),
  fc.record({ type: fc.constant('repeat' as const), pick: fc.nat() }),
  fc.record({
    type: fc.constant('purchase' as const),
    gap: fc.integer({ min: 0, max: 3 }),
    amount: smallAmountArb,
    account: fc.constantFrom('checking' as const, 'everyday-card' as const, 'old-card' as const),
    pending: fc.boolean(),
    description: fc.constantFrom('MADE UP GROCER', 'MADE UP CAFE', 'MADE UP HARDWARE'),
  }),
  fc.record({ type: fc.constant('post' as const), pick: fc.nat(), change: fc.integer({ min: -5_000, max: 5_000 }) }),
  fc.record({
    type: fc.constant('refund' as const),
    pick: fc.nat(),
    amount: smallAmountArb,
    linked: fc.boolean(),
    account: fc.constantFrom('checking' as const, 'everyday-card' as const),
  }),
  fc.record({ type: fc.constant('card-charge' as const), amount: smallAmountArb, charge: fc.constantFrom('fee' as const, 'interest' as const) }),
  fc.record({ type: fc.constant('sort' as const), pick: fc.nat(), seed: fc.nat() }),
  fc.record({ type: fc.constant('resort' as const), pick: fc.nat(), seed: fc.nat() }),
  fc.record({
    type: fc.constant('transfer' as const),
    amount: smallAmountArb,
    from: fc.constantFrom('checking' as const, 'savings' as const),
    to: fc.constantFrom('checking' as const, 'savings' as const, 'everyday-card' as const, 'old-card' as const),
  }),
  fc.record({ type: fc.constant('old-card' as const), amount: smallAmountArb, what: fc.constantFrom('purchase' as const, 'pending' as const, 'fee' as const, 'interest' as const, 'refund' as const) }),
  fc.record({ type: fc.constant('acknowledge' as const), pick: fc.nat() }),
  fc.record({ type: fc.constant('resort-money-in' as const), pick: fc.nat(), seed: fc.nat() }),
  fc.record({ type: fc.constant('pay-person' as const), amount: smallAmountArb, payee: fc.constantFrom('MADE UP FRIEND', 'MADE UP LANDLORD', 'MADE UP ROOMMATE') }),
  fc.record({ type: fc.constant('pay-mom' as const), amount: fc.oneof(smallAmountArb, fc.integer({ min: 100_000, max: 400_000 })) }),
);

const potArb = fc.integer({ min: -1_000_000, max: 10_000_000 });
const openingArb = fc.record({ savings: potArb, needs: potArb, wants: potArb, momReserve: fc.integer({ min: 0, max: 400_000 }), heldForOthers: potArb });

const RULES: SortingRule[] = [
  { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
  { id: 'bonus', for: 'deposit', contains: 'BONUS', choice: { to: 'income' } },
  { id: 'roommate', for: 'deposit', contains: 'ROOMMATE', choice: { to: 'not-mine' } },
  { id: 'friend', for: 'deposit', contains: 'FRIEND', choice: { to: 'wants' } },
  { id: 'landlord', for: 'person', contains: 'LANDLORD', choice: { to: 'needs' } },
  { id: 'roommate-out', for: 'person', contains: 'ROOMMATE', choice: { to: 'not-mine' } },
];

function pick<T>(list: readonly T[], index: number): T | undefined {
  return list[index % Math.max(1, list.length)];
}

// A valid way to sort spending of this amount, chosen by the seed. A
// payment to a person can also be not mine; it and the difference on a mom
// payment cannot be split.
function spendingChoice(amount: number, seed: number, kind: string): SortChoice {
  if (kind === 'person-payment') return { to: (['needs', 'wants', 'not-mine'] as const)[seed % 3] ?? 'needs' };
  if (seed % 3 === 2 && amount >= 2 && kind !== 'mom-difference') {
    const needs = 1 + (seed % (amount - 1));
    return { split: [{ bucket: 'needs', amount: needs }, { bucket: 'wants', amount: amount - needs }] };
  }
  return { to: seed % 3 === 0 ? 'needs' : 'wants' };
}

// A valid choice for money in (6.1). A store refund cannot be income.
function moneyInChoice(seed: number, isRefund: boolean): SortChoice {
  const choices: MoneyInChoice['to'][] = [...BUCKETS, 'not-mine', ...(isRefund ? [] : ['income' as const])];
  return { to: choices[seed % choices.length] ?? 'savings' };
}

function runLife(book: Book, bank: TestBank, steps: Step[]): void {
  let date = START_DATE;
  let n = 0;
  const received: BankTransaction[] = [];
  // Pending purchases the bank has not posted yet, on any account.
  const pending: Purchase[] = [];
  // Money in that can be sorted and re-sorted (not paychecks or matched refunds).
  const moneyIn: { id: string; isRefund: boolean }[] = [];
  const send = (txn: BankTransaction): void => {
    const { outcome } = book.receive(txn);
    bank.apply(txn);
    received.push(txn);
    if (txn.kind === 'purchase' && txn.pending) pending.push(txn);
    if ((txn.kind === 'deposit' && outcome !== 'paycheck') || (txn.kind === 'refund' && outcome === 'review')) {
      moneyIn.push({ id: txn.id, isRefund: txn.kind === 'refund' });
    }
  };
  for (const step of steps) {
    switch (step.type) {
      case 'paycheck':
      case 'deposit': {
        date = addDays(date, step.gap);
        const id = `t${n++}`;
        send(step.type === 'paycheck' ? paycheck(id, date, step.amount) : deposit(id, date, step.amount, step.description, step.account));
        break;
      }
      case 'answer-leftover': {
        const item = pick(book.reviewItems().filter((i) => i.type === 'leftover'), step.pick);
        if (item) book.answerLeftover(item.id, step.choice, date);
        break;
      }
      case 'repeat': {
        // Nothing is counted twice: the bank sending the same thing again changes nothing.
        const txn = pick(received, step.pick);
        if (txn) expect(book.receive(txn).outcome).toBe('duplicate');
        break;
      }
      case 'purchase':
        date = addDays(date, step.gap);
        send(purchase(`t${n++}`, date, step.amount, step.description, { account: step.account, pending: step.pending }));
        break;
      case 'post': {
        const index = step.pick % Math.max(1, pending.length);
        const [target] = pending.splice(index, 1);
        if (target) send(posted(`t${n++}`, target.id, date, Math.max(1, target.amount + step.change), target.description, target.account));
        break;
      }
      case 'refund': {
        // A refund can only name a bank transaction, not one of the book's own entries.
        const target = pick(book.purchases().filter((p) => !p.id.includes(':')), step.pick);
        send(refund(`t${n++}`, date, step.amount, step.linked ? target?.id : undefined, step.account));
        break;
      }
      case 'card-charge':
        send(cardCharge(`t${n++}`, date, step.amount, step.charge));
        break;
      case 'sort': {
        const item = pick(book.reviewItems().filter((i) => i.type !== 'leftover'), step.pick);
        if (item?.type === 'spending') book.sort(item.id, spendingChoice(item.amount, step.seed, item.reason), date);
        if (item?.type === 'money-in') book.sort(item.id, moneyInChoice(step.seed, item.reason === 'refund'), date);
        break;
      }
      case 'resort': {
        const target = pick(book.purchases().filter((p) => p.kind !== 'debt-payoff'), step.pick);
        if (target) book.sort(target.id, spendingChoice(target.amount - target.refunded, step.seed, target.kind), date);
        break;
      }
      case 'transfer': {
        if (step.from === step.to) break;
        const before = book.pots();
        send(transfer(`t${n++}`, date, step.amount, step.from, step.to));
        // A transfer between your own accounts never changes a bucket. A
        // payment to the old card is the exception: it is spending (5.2).
        if (step.to !== 'old-card') expect(book.pots()).toEqual(before);
        break;
      }
      case 'old-card': {
        const id = `t${n++}`;
        if (step.what === 'purchase' || step.what === 'pending') {
          send(purchase(id, date, step.amount, 'MADE UP CAFE', { account: 'old-card', pending: step.what === 'pending' }));
        } else if (step.what === 'refund') {
          send(refund(id, date, step.amount, undefined, 'old-card'));
        } else {
          send(cardCharge(id, date, step.amount, step.what, 'old-card'));
        }
        break;
      }
      case 'resort-money-in': {
        const target = pick(moneyIn, step.pick);
        if (target) book.sort(target.id, moneyInChoice(step.seed, target.isRefund), date);
        break;
      }
      case 'pay-person':
        send(payPerson(`t${n++}`, date, step.amount, step.payee));
        break;
      case 'pay-mom':
        send(payPerson(`t${n++}`, date, step.amount, MOM_NAME));
        break;
      case 'acknowledge': {
        const item = pick(book.reviewItems().filter((i) => i.type === 'old-card-purchase'), step.pick);
        if (item) book.acknowledge(item.id, date);
        break;
      }
    }
    // No cent is created or lost: the buckets always match the bank, and
    // the daily self-check (section 12) agrees.
    expect(appSide(book.pots())).toBe(bank.side());
    expect(book.selfCheck(bank)).toMatchObject({ ok: true, difference: 0 });
    // Safe to spend is always wants left minus unsorted spending (11.1).
    expect(book.safeToSpend(date).amount).toBe(book.pots().wants - book.pots().unsortedOut);
    // The old card debt always matches the bank, and is kept out of the buckets.
    expect(book.oldCardDebt()).toBe(bank.oldCard);
    // The running totals always equal a recount from scratch.
    expect(book.recountPots()).toEqual(book.pots());
    expect(book.recountOldCardDebt()).toBe(book.oldCardDebt());
    for (const value of Object.values(book.pots())) expect(Number.isSafeInteger(value)).toBe(true);
  }
}

describe('random scenarios: the whole book', () => {
  it('no cent is created or lost, and nothing is counted twice, through any mix of bank activity and sorting', () => {
    fc.assert(
      fc.property(openingArb, leftoverChoiceArb, leftoverChoiceArb, splitArb, fc.array(stepArb, { maxLength: 60 }), (pots, needs, wants, split, steps) => {
        const book = openTestBook({ pots, rules: RULES, oldCardDebt: 300_000, settings: { split, leftoverAtPayday: { needs, wants } } });
        const bank = new TestBank({ checking: appSide(book.pots()), oldCard: 300_000 });
        runLife(book, bank, steps);
      }),
      { numRuns: 500 },
    );
  });
});
