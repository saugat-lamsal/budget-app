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

// A purchase on the debit card (checking) or the everyday card. A pending
// purchase is later replaced by its posted version, which the bank sends
// with a new id and pendingId pointing at the pending one (rule 4.6).
export interface Purchase {
  readonly kind: 'purchase';
  readonly id: string;
  readonly account: 'checking' | 'everyday-card';
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly pending: boolean;
  readonly pendingId?: string;
}

// Money back from a store. refundOf names the purchase, when the bank
// connection could tell which one it was.
export interface Refund {
  readonly kind: 'refund';
  readonly id: string;
  readonly account: 'checking' | 'everyday-card';
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly refundOf?: string;
}

// A fee or interest charged by a card (rule 4.8).
export interface CardCharge {
  readonly kind: 'card-charge';
  readonly id: string;
  readonly account: 'everyday-card';
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly charge: 'fee' | 'interest';
}

export type BankTransaction = Deposit | Purchase | Refund | CardCharge;

const ACCOUNTS_FOR: Record<BankTransaction['kind'], readonly string[]> = {
  deposit: ['checking', 'savings'],
  purchase: ['checking', 'everyday-card'],
  refund: ['checking', 'everyday-card'],
  'card-charge': ['everyday-card'],
};

// Refuses anything malformed before the book changes at all. Bank ids may
// not contain ":" because the book uses it for the ids of its own questions.
export function checkTransaction(txn: BankTransaction): void {
  const bad = (why: string): never => {
    throw new MoneyError('bad-transaction', `${why}: ${JSON.stringify(txn)}`);
  };
  const isId = (id: unknown): boolean => typeof id === 'string' && id !== '' && !id.includes(':');
  if (typeof txn !== 'object' || txn === null) bad('not a transaction');
  if (!(txn.kind in ACCOUNTS_FOR)) bad('unknown kind');
  if (!isId(txn.id)) bad('id must be non-empty text without ":"');
  if (!ACCOUNTS_FOR[txn.kind].includes(txn.account)) bad(`a ${txn.kind} cannot be on ${String(txn.account)}`);
  if (typeof txn.description !== 'string') bad('description must be text');
  switch (txn.kind) {
    case 'purchase':
      if (typeof txn.pending !== 'boolean') bad('pending must be true or false');
      if (txn.pendingId !== undefined && (txn.pending || !isId(txn.pendingId))) bad('only a posted purchase can replace a pending one');
      break;
    case 'refund':
      if (txn.refundOf !== undefined && !isId(txn.refundOf)) bad('refundOf must be a transaction id');
      break;
    case 'card-charge':
      if (txn.charge !== 'fee' && txn.charge !== 'interest') bad('a card charge is a fee or interest');
      break;
    case 'deposit':
      break;
  }
  assertIsoDate(txn.date, 'transaction date');
  assertPositiveCents(txn.amount, 'transaction amount');
}

// Two transactions are the same when every field matches.
export function sameTransaction(a: BankTransaction, b: BankTransaction): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => (a as unknown as Record<string, unknown>)[key] === (b as unknown as Record<string, unknown>)[key]);
}
