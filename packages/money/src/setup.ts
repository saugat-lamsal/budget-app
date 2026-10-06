import { openBook, type Book, type StartingPots } from './book.js';
import { addCents, assertCents, subtractCents, type Cents } from './cents.js';
import type { IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import type { SortingRule } from './rules.js';
import { bankSide, withPendingCharges, type BankBalances } from './self-check.js';
import type { Settings } from './settings.js';
import { checkTransaction, type Purchase } from './transactions.js';

// Rulebook section 14: setup day.

export interface SetupInput {
  readonly date: IsoDate;
  // 14.1: the balances as the bank reports them today (posted), and the
  // charges still pending.
  readonly bankBalances: BankBalances;
  readonly pendingCharges: readonly Purchase[];
  // What the old card owes (posted). It becomes the debt (12.4).
  readonly oldCardBalance: Cents;
  // 14.2: where the starting money goes.
  readonly assignment: StartingPots;
  // The pay schedule counts from here until the first paycheck arrives.
  readonly lastPaycheckDate: IsoDate;
  readonly settings: Settings;
  readonly rules?: readonly SortingRule[];
}

export type SetupResult =
  | { readonly ok: true; readonly book: Book; readonly startingMoney: Cents }
  // Tracking has not started. difference is starting money minus what was
  // assigned: positive means some is left to assign.
  | { readonly ok: false; readonly startingMoney: Cents; readonly assigned: Cents; readonly difference: Cents };

// 14.2: checking + savings - everyday card balance, with pending charges
// included (the same bank side as the self-check, 12.1).
export function startingMoney(posted: BankBalances, pendingCharges: readonly Purchase[]): Cents {
  return bankSide(withPendingCharges(posted, pendingCharges));
}

// 14.3: tracking starts only when the assignment adds up to the starting
// money exactly, so the self-check passes from day one. Charges pending on
// setup day are already in the starting money, so the book counts them as
// spent at setup (QUESTIONS.md A10).
export function startTracking(input: SetupInput): SetupResult {
  const ids = new Set<string>();
  for (const charge of input.pendingCharges) {
    checkTransaction(charge);
    if (charge.kind !== 'purchase' || !charge.pending) throw new MoneyError('bad-transaction', `${charge.id} is not a pending charge`);
    if (ids.has(charge.id)) throw new MoneyError('conflicting-id', `two pending charges have the id ${charge.id}`);
    ids.add(charge.id);
  }
  const money = startingMoney(input.bankBalances, input.pendingCharges);
  const a = input.assignment;
  for (const [name, value] of Object.entries(a)) assertCents(value, name);
  const assigned = addCents(a.savings, a.needs, a.wants, a.momReserve, a.heldForOthers);
  if (assigned !== money) return { ok: false, startingMoney: money, assigned, difference: subtractCents(money, assigned) };

  assertCents(input.oldCardBalance, 'old card balance');
  const oldCardPending = input.pendingCharges.filter((c) => c.account === 'old-card').map((c) => c.amount);
  const book = openBook({
    date: input.date,
    pots: a,
    oldCardDebt: addCents(input.oldCardBalance, ...oldCardPending),
    lastPaycheckDate: input.lastPaycheckDate,
    settings: input.settings,
    rules: input.rules ?? [],
    countedAtSetup: input.pendingCharges,
  });
  if (!book.selfCheck(withPendingCharges(input.bankBalances, input.pendingCharges)).ok) {
    throw new MoneyError('broken-book', 'the self-check failed right after setup');
  }
  return { ok: true, book, startingMoney: money };
}
