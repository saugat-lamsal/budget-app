import { assertPositiveCents, type Cents } from './cents.js';
import { assertIsoDate, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';

// Bank activity, already sorted into kinds by the bank connection (Phase 3).
// Every amount is positive; the kind says which way the money went.

// Money arriving in checking or savings.
export interface Deposit {
  readonly kind: 'deposit';
  readonly id: string;
  readonly account: 'checking' | 'savings';
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
}

export type BankTransaction = Deposit;

const ACCOUNTS_FOR: Record<BankTransaction['kind'], readonly string[]> = {
  deposit: ['checking', 'savings'],
};

// Refuses anything malformed before the book changes at all. Bank ids may
// not contain ":" because the book uses it for the ids of its own questions.
export function checkTransaction(txn: BankTransaction): void {
  const bad = (why: string): never => {
    throw new MoneyError('bad-transaction', `${why}: ${JSON.stringify(txn)}`);
  };
  if (typeof txn !== 'object' || txn === null) bad('not a transaction');
  if (!(txn.kind in ACCOUNTS_FOR)) bad('unknown kind');
  if (typeof txn.id !== 'string' || txn.id === '' || txn.id.includes(':')) bad('id must be non-empty text without ":"');
  if (!ACCOUNTS_FOR[txn.kind].includes(txn.account)) bad(`a ${txn.kind} cannot be on ${String(txn.account)}`);
  if (typeof txn.description !== 'string') bad('description must be text');
  assertIsoDate(txn.date, 'transaction date');
  assertPositiveCents(txn.amount, 'transaction amount');
}

// Two transactions are the same when every field matches.
export function sameTransaction(a: BankTransaction, b: BankTransaction): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a as unknown as Record<string, unknown>)[key] === (b as unknown as Record<string, unknown>)[key]);
}
