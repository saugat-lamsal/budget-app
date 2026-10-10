import type { BankBalances, Book, Cents, IsoDate, PaydayReport, SavingsTransfer } from '@budget-app/money';
import { keyed, type KeyedDetail } from './review.js';

// What the Payday screen shows (QUESTIONS.md B104 to B107), worked out on the
// server from the book: what the last paycheck did (the mom reserve first,
// then the split), how much is still to move into the savings account, what
// became of each bucket's leftover, and how the pay period that just ended
// went. The screen only formats it: every number here comes from the money
// math, in whole cents, and is sent to the phone as JSON.

export interface PaydayInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  // Today's balances as the bank reports them (12.1). Null when the bank
  // could not be read.
  readonly bank: BankBalances | null;
  readonly madeUpData: boolean;
}

export type PaydayView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      // 11.2: negative days when the paycheck is late (B35).
      readonly payday: { readonly next: IsoDate; readonly days: number };
      readonly report: PaydayReport;
      // 3.4: the leftover questions still open, to answer here or in review
      // (B107). The same items review lists.
      readonly questions: readonly KeyedDetail[];
      // 3.8: what the savings account should hold and how much is still to
      // move, and what is already on its way to it, which counts as moved (B46).
      readonly toSavings: { readonly state: 'known'; readonly transfer: SavingsTransfer; readonly onItsWay: Cents } | { readonly state: 'bank-not-read' };
    };

export function paydayView(input: PaydayInput): PaydayView {
  const { today, book, bank, madeUpData } = input;
  if (book === null) return { state: 'not-set-up', madeUpData };
  const plain = book.safeToSpend(today);
  return {
    state: 'tracking',
    madeUpData,
    today,
    payday: { next: plain.nextPayday, days: plain.daysToPayday },
    report: book.paydayReport(),
    questions: book.reviewDetails().filter((d) => d.item.type === 'leftover').map(keyed),
    toSavings: bank === null ? { state: 'bank-not-read' } : { state: 'known', transfer: book.savingsTransfer(bank.savings), onItsWay: onItsWayToSavings(book) },
  };
}

// 12.5, B46: money that has left for the savings account and not landed yet.
export function onItsWayToSavings(book: Book): Cents {
  return book
    .inTransit()
    .items.filter((item) => item.to === 'savings' && item.seen === 'left')
    .reduce((sum, item) => sum + item.amount, 0);
}
