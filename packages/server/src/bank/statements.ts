import { MoneyError, addDays, assertIsoDate, daysBetween, type CardStatement } from '@budget-app/money';
import { BankDataError } from '../errors.js';
import type { PlaidCreditCard } from '../plaid/types.js';
import { centsFromPlaid } from './amounts.js';

// Section 9: what the card reminders need, from Plaid's Liabilities answer.
// The statement date is the day the last statement was issued; payments the
// card gets after it count toward that statement (9.3).
// 9.8 (A52): Bank of America sends no statement date; it is then the due
// date less statementDays, the days set for that card (null: not set yet,
// and there is no statement). The bank's own date wins when it sends one.
export type StatementResult = { readonly ok: true; readonly statement: CardStatement } | { readonly ok: false; readonly why: string };

export function cardStatement(card: 'everyday-card' | 'old-card', raw: PlaidCreditCard, statementDays: number | null = null): StatementResult {
  try {
    const dueDate = date(raw.next_payment_due_date, 'due date');
    const closingDate = raw.last_statement_issue_date === null && statementDays !== null ? addDays(dueDate, -statementDays) : date(raw.last_statement_issue_date, 'statement date');
    if (daysBetween(closingDate, dueDate) < 0) throw new BankDataError('the due date is before the statement date');
    if (raw.last_statement_balance === null) throw new BankDataError('the bank did not give the statement balance');
    if (raw.minimum_payment_amount === null) throw new BankDataError('the bank did not give the minimum payment');
    const statementBalance = centsFromPlaid(raw.last_statement_balance, 'statement balance');
    const minimumPayment = centsFromPlaid(raw.minimum_payment_amount, 'minimum payment');
    if (minimumPayment < 0) throw new BankDataError('the minimum payment is below zero');
    return { ok: true, statement: { card, closingDate, dueDate, statementBalance, minimumPayment } };
  } catch (error) {
    if (error instanceof BankDataError || error instanceof MoneyError) return { ok: false, why: error.message };
    throw error;
  }
}

function date(value: string | null, what: string): string {
  if (value === null) throw new BankDataError(`the bank did not give the ${what}`);
  assertIsoDate(value, what);
  return value;
}
