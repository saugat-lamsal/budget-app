import { addCents, assertCents, assertPositiveCents, subtractCents, type Cents } from './cents.js';

// Rulebook section 12, the bank side. Balances as the bank reports them,
// including pending charges. The old card is not here: it is tracked
// separately as debt (12.4).
export interface BankBalances {
  readonly checking: Cents;
  readonly savings: Cents;
  // What you owe on the everyday card.
  readonly everydayCard: Cents;
}

export interface PendingCharge {
  readonly account: 'checking' | 'everyday-card' | 'old-card';
  readonly amount: Cents;
}

// 12.1: posted balances plus the bank's pending charges. A pending debit
// lowers checking; a pending card charge raises what you owe. The old card
// is left out (12.4).
export function withPendingCharges(posted: BankBalances, pending: readonly PendingCharge[]): BankBalances {
  let { checking, everydayCard } = posted;
  for (const charge of pending) {
    assertPositiveCents(charge.amount, 'pending charge');
    if (charge.account === 'checking') checking = subtractCents(checking, charge.amount);
    if (charge.account === 'everyday-card') everydayCard = addCents(everydayCard, charge.amount);
  }
  return { checking, savings: posted.savings, everydayCard };
}

// 12.1: checking + savings - everyday card balance.
export function bankSide(bank: BankBalances): Cents {
  assertCents(bank.checking, 'checking balance');
  assertCents(bank.savings, 'savings balance');
  assertCents(bank.everydayCard, 'everyday card balance');
  return subtractCents(addCents(bank.checking, bank.savings), bank.everydayCard);
}
