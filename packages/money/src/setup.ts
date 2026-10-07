import { openBook, type Book, type StartingPots } from './book.js';
import { addCents, assertCents, subtractCents, type Cents } from './cents.js';
import type { IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import type { SortingRule } from './rules.js';
import { bankSide, withPendingCharges, type BankBalances } from './self-check.js';
import type { Settings } from './settings.js';
import { checkTransaction, type Purchase, type SavingsWithdrawal, type TransferArrived, type TransferSent } from './transactions.js';

// Rulebook section 14: setup day.

export interface SetupInput {
  readonly date: IsoDate;
  // 14.1: the balances as the bank reports them today (posted), and the
  // charges still pending.
  readonly bankBalances: BankBalances;
  readonly pendingCharges: readonly (Purchase | SavingsWithdrawal)[];
  // Transfers with only one half showing (12.5): money that has left one of
  // your accounts and not arrived yet, such as a card payment made
  // yesterday, or one that has arrived but does not show leaving yet.
  readonly transfersInTransit?: readonly (TransferSent | TransferArrived)[];
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
// included (the same bank side as the self-check, 12.1), allowing for
// money in transit between those accounts (12.5): money that has left and
// not arrived is added; money that arrived before it shows leaving is
// still counted where it left, so it is taken off. Halves going to or
// from the old card do not count: it is outside the starting money.
export function startingMoney(
  posted: BankBalances,
  pendingCharges: readonly (Purchase | SavingsWithdrawal)[],
  inTransit: readonly (TransferSent | TransferArrived)[] = [],
): Cents {
  const travelling = inTransit.map((transfer) => {
    checkTransaction(transfer);
    if (transfer.kind !== 'transfer-sent' && transfer.kind !== 'transfer-arrived') {
      throw new MoneyError('bad-transaction', `${String((transfer as { id?: unknown }).id)} is not half of a transfer`);
    }
    if (transfer.to === 'old-card') return 0;
    return transfer.kind === 'transfer-sent' ? transfer.amount : -transfer.amount;
  });
  return addCents(bankSide(withPendingCharges(posted, pendingCharges)), ...travelling);
}

// 14.3: tracking starts only when the assignment adds up to the starting
// money exactly, so the self-check passes from day one. Charges pending on
// setup day are already in the starting money, so the book counts them as
// spent at setup (QUESTIONS.md A10).
export function startTracking(input: SetupInput): SetupResult {
  const ids = new Set<string>();
  const inTransit = input.transfersInTransit ?? [];
  for (const transfer of inTransit) {
    if (ids.has(transfer.id)) throw new MoneyError('conflicting-id', `two transfers in transit have the id ${transfer.id}`);
    ids.add(transfer.id);
  }
  for (const charge of input.pendingCharges) {
    checkTransaction(charge);
    if ((charge.kind !== 'purchase' && charge.kind !== 'savings-withdrawal') || !charge.pending) throw new MoneyError('bad-transaction', `${charge.id} is not a pending charge`);
    if (ids.has(charge.id)) throw new MoneyError('conflicting-id', `two pending charges have the id ${charge.id}`);
    ids.add(charge.id);
  }
  const money = startingMoney(input.bankBalances, input.pendingCharges, inTransit);
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
    inTransitAtSetup: inTransit,
  });
  if (!book.selfCheck(withPendingCharges(input.bankBalances, input.pendingCharges)).ok) {
    throw new MoneyError('broken-book', 'the self-check failed right after setup');
  }
  return { ok: true, book, startingMoney: money };
}
